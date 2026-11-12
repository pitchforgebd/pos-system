import { redirect } from "next/navigation";

// A quotation is a draft order: its page is the order's page.
export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/orders/${id}`);
}
