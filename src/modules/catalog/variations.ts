import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";

// Variation heads (Size, Colour, Pack) and their values (5 kg, Red, Sack). A product's variant is described by one value of each head
// it uses (P04 task 5, H10).

type Db = Prisma.TransactionClient;
type Failure = { ok: false; status: 404 | 409 | 422; message: string };

const fail = (status: Failure["status"], message: string): Failure => ({ ok: false, status, message });

export async function listVariationHeads(organizationId: string) {
  const heads = await prisma.variationHead.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, values: { orderBy: { value: "asc" }, select: { id: true, value: true, _count: { select: { assignments: true } } } } },
  });
  return heads.map((head) => ({ id: head.id, name: head.name, values: head.values.map((value) => ({ id: value.id, value: value.value, variants: value._count.assignments })) }));
}

function clean(value: string) {
  const text = value.trim();
  return text.length >= 1 && text.length <= 191 ? text : null;
}

export async function createVariationHead(input: { organizationId: string; name: string }): Promise<{ ok: true; id: string } | Failure> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 191) {
    return fail(422, "Enter a name for the variation (for example Size).");
  }
  try {
    const head = await prisma.variationHead.create({ data: { organizationId: input.organizationId, name }, select: { id: true } });
    return { ok: true, id: head.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail(409, "That variation already exists.");
    }
    throw error;
  }
}

export async function addVariationValue(input: { organizationId: string; headId: string; value: string }): Promise<{ ok: true; id: string } | Failure> {
  const value = clean(input.value);
  if (!value) {
    return fail(422, "Enter a value (for example 5 kg).");
  }
  const head = await prisma.variationHead.findFirst({ where: { id: input.headId, organizationId: input.organizationId }, select: { id: true } });
  if (!head) {
    return fail(404, "That record was not found.");
  }
  try {
    const row = await prisma.variationValue.create({ data: { organizationId: input.organizationId, headId: head.id, value }, select: { id: true } });
    return { ok: true, id: row.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail(409, "That value already exists.");
    }
    throw error;
  }
}

/** A value that a variant uses cannot be removed. */
export async function removeVariationValue(input: { organizationId: string; valueId: string }): Promise<{ ok: true } | Failure> {
  const value = await prisma.variationValue.findFirst({ where: { id: input.valueId, organizationId: input.organizationId }, select: { id: true, _count: { select: { assignments: true } } } });
  if (!value) {
    return fail(404, "That record was not found.");
  }
  if (value._count.assignments > 0) {
    return fail(422, "A variant uses that value, so it stays.");
  }
  await prisma.variationValue.delete({ where: { id: value.id } });
  return { ok: true };
}

/** A head goes with its values, if none of them is in use. */
export async function removeVariationHead(input: { organizationId: string; headId: string }): Promise<{ ok: true } | Failure> {
  const head = await prisma.variationHead.findFirst({ where: { id: input.headId, organizationId: input.organizationId }, select: { id: true } });
  if (!head) {
    return fail(404, "That record was not found.");
  }
  if ((await prisma.productVariantValue.count({ where: { organizationId: input.organizationId, headId: head.id } })) > 0) {
    return fail(422, "A variant uses a value of that variation, so it stays.");
  }
  await prisma.variationHead.delete({ where: { id: head.id } });
  return { ok: true };
}

/** Describes a variant by one value of each head named. Refuses two values of one head, or a value that belongs to another head. */
export async function setVariantValues(tx: Db, input: { organizationId: string; variantId: string; values: Array<{ headId: string; valueId: string }> }): Promise<Failure | null> {
  if (new Set(input.values.map((entry) => entry.headId)).size !== input.values.length) {
    return fail(422, "A variant takes one value of each variation.");
  }
  for (const entry of input.values) {
    const value = await tx.variationValue.findFirst({ where: { id: entry.valueId, headId: entry.headId, organizationId: input.organizationId }, select: { id: true } });
    if (!value) {
      return fail(422, "Choose a value of that variation.");
    }
    await tx.productVariantValue.create({ data: { organizationId: input.organizationId, variantId: input.variantId, headId: entry.headId, valueId: entry.valueId } });
  }
  return null;
}
