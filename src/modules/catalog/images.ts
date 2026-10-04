import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";

const root = path.join(process.cwd(), "storage", "product-images");
const maxBytes = 1_500_000;

function detectedType(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" } as const;
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mimeType: "image/png", extension: "png" } as const;
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" } as const;
  }
  return null;
}

function storedPath(storageKey: string) {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(storageKey)) {
    return null;
  }
  const file = path.join(root, storageKey);
  if (path.dirname(file) !== root) {
    return null;
  }
  return file;
}

export async function saveProductImage(input: {
  organizationId: string;
  productId: string;
  userId: string;
  bytes: Buffer;
  ip: string;
  userAgent: string | null;
}) {
  const kind = detectedType(input.bytes);
  if (!kind || input.bytes.length === 0 || input.bytes.length > maxBytes) {
    return { ok: false as const, status: 422 as const, message: "Use a JPEG, PNG, or WebP under 1.5 MB." };
  }
  const product = await prisma.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!product) {
    return { ok: false as const, status: 404 as const, message: "That product was not found." };
  }
  const storageKey = `${randomUUID()}.${kind.extension}`;
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, storageKey), input.bytes);
  try {
    const previous = await prisma.$transaction(async (tx) => {
      const old = await tx.productImage.findMany({
        where: { organizationId: input.organizationId, productId: product.id },
        select: { id: true, fileAssetId: true, fileAsset: { select: { storageKey: true } } },
      });
      const asset = await tx.fileAsset.create({
        data: {
          organizationId: input.organizationId,
          storageKey,
          fileName: `product.${kind.extension}`,
          mimeType: kind.mimeType,
          sizeBytes: input.bytes.length,
          createdById: input.userId,
        },
        select: { id: true },
      });
      await tx.productImage.create({
        data: { organizationId: input.organizationId, productId: product.id, fileAssetId: asset.id },
      });
      if (old.length > 0) {
        await tx.productImage.deleteMany({ where: { id: { in: old.map((row) => row.id) } } });
        await tx.fileAsset.deleteMany({ where: { id: { in: old.map((row) => row.fileAssetId) } } });
      }
      return old.map((row) => row.fileAsset.storageKey);
    });
    await Promise.all(previous.map((key) => unlink(storedPath(key) ?? path.join(root, "missing")).catch(() => undefined)));
    await writeAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "image",
      module: "products",
      entityType: "product",
      entityId: product.id,
      after: { mimeType: kind.mimeType, sizeBytes: input.bytes.length },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: true as const };
  } catch (error) {
    await unlink(path.join(root, storageKey)).catch(() => undefined);
    throw error;
  }
}

export async function readProductImage(organizationId: string, productId: string) {
  const row = await prisma.productImage.findFirst({
    where: { organizationId, productId },
    orderBy: { createdAt: "desc" },
    select: { fileAsset: { select: { storageKey: true, mimeType: true } } },
  });
  const file = row ? storedPath(row.fileAsset.storageKey) : null;
  if (!row || !file) {
    return null;
  }
  try {
    return { bytes: await readFile(file), mimeType: row.fileAsset.mimeType };
  } catch {
    return null;
  }
}
