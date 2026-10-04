import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";

export async function getOrganizationProfile(organizationId: string) {
  const row = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, slug: true, phone: true, address: true, status: true, bin: true, tin: true, logoUrl: true, pointsPerHundred: true, takaPerPoint: true },
  });
  if (!row) {
    return null;
  }
  return {
    name: row.name,
    slug: row.slug,
    phone: row.phone ?? "",
    address: row.address ?? "",
    status: row.status,
    bin: row.bin ?? "",
    tin: row.tin ?? "",
    logoUrl: row.logoUrl ?? "",
    pointsPerHundred: row.pointsPerHundred === null ? "" : new Prisma.Decimal(row.pointsPerHundred).toFixed(4),
    takaPerPoint: row.takaPerPoint === null ? "" : new Prisma.Decimal(row.takaPerPoint).toFixed(4),
  };
}

export async function saveOrganizationProfile(input: {
  organizationId: string;
  actorId: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  bin?: string | null;
  tin?: string | null;
  logoUrl?: string | null;
  pointsPerHundred?: string | null;
  takaPerPoint?: string | null;
  ip: string;
  userAgent: string | null;
}) {
  const name = input.name.trim();
  if (!name || name.length > 191) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a shop name of up to 191 characters." };
  }
  const phone = input.phone?.trim() || null;
  if (phone && phone.length > 32) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a phone of up to 32 characters." };
  }
  const address = input.address?.trim() || null;
  if (address && address.length > 255) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter an address of up to 255 characters." };
  }
  const bin = input.bin?.trim() || null;
  const tin = input.tin?.trim() || null;
  if ((bin && bin.length > 32) || (tin && tin.length > 32)) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a BIN or TIN of up to 32 characters." };
  }
  const logoUrl = input.logoUrl?.trim() || null;
  if (logoUrl && (logoUrl.length > 255 || !/^https?:\/\/\S+$/.test(logoUrl))) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a logo address that starts with http:// or https://." };
  }
  const pointsPerHundred = rate(input.pointsPerHundred);
  const takaPerPoint = rate(input.takaPerPoint);
  if (pointsPerHundred === "invalid" || takaPerPoint === "invalid") {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter point rates as amounts, or leave them blank." };
  }
  const current = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { name: true, phone: true, address: true },
  });
  if (!current) {
    return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const, message: "That shop was not found." };
  }
  await prisma.organization.update({
    where: { id: input.organizationId },
    data: { name, phone, address, bin, tin, logoUrl, pointsPerHundred, takaPerPoint },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "settings",
    module: "settings",
    entityType: "organization",
    entityId: input.organizationId,
    before: current,
    after: { name, phone, address, bin, tin, logoUrl, pointsPerHundred: pointsPerHundred?.toFixed(4) ?? null, takaPerPoint: takaPerPoint?.toFixed(4) ?? null },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const };
}

function rate(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  if (!text) {
    return null;
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(text)) {
    return "invalid" as const;
  }
  const parsed = new Prisma.Decimal(text);
  return parsed.isNeg() ? ("invalid" as const) : parsed;
}
