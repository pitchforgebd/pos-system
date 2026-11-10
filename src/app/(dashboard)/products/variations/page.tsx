import Link from "next/link";
import { redirect } from "next/navigation";

import { AddHeadForm, HeadCard } from "@/components/catalog/variation-manager";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listVariationHeads } from "@/modules/catalog/variations";

export const metadata = { title: "Variations" };

export default async function VariationsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const canEdit = session.permissions.has("products.edit");
  const heads = await listVariationHeads(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Variations"
        description="A variation (Size, Colour, Pack) has values (5 kg, Red, Sack). A product's variants are described by one value of each. Add the variants on the product's own page."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: "Variations" }]}
      />
      {canEdit ? <AddHeadForm /> : null}
      {heads.length === 0 ? (
        <EmptyState title="No variations yet" description="Add a variation such as Size, then its values." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {heads.map((head) => (
            <HeadCard key={head.id} head={head} canEdit={canEdit} />
          ))}
        </div>
      )}
      <Link href="/products" className="text-sm underline">
        Back to products
      </Link>
    </div>
  );
}
