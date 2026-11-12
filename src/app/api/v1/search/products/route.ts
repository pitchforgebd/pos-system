import { RuleError } from "@/core/errors/rule-error";
import { defineRoute } from "@/core/http/define-route";
import { jsonError, jsonOk } from "@/lib/api/http";
import { searchProducts } from "@/modules/catalog/search";

// GET /api/v1/search/products?q=&level=&customerTypeId=&qty=: up to 20 products, with the price at the level and what is available.
// Never carries what a product cost.
export const GET = defineRoute({
  permission: "products.view",
  handler: async ({ request, session }) => {
    const url = new URL(request.url);
    const qty = url.searchParams.get("qty") ?? undefined;
    if (qty !== undefined && !/^\d{1,14}(\.\d{1,4})?$/.test(qty)) {
      return jsonError("VALIDATION_ERROR", "Enter a quantity greater than zero.", 400);
    }
    const customerTypeId = url.searchParams.get("customerTypeId") ?? undefined;
    if (customerTypeId !== undefined && !/^[0-9a-f-]{36}$/i.test(customerTypeId)) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    try {
      const rows = await searchProducts({
        organizationId: session.organizationId,
        branchId: session.branchId,
        q: (url.searchParams.get("q") ?? "").slice(0, 100),
        categoryId: /^[0-9a-f-]{36}$/i.test(url.searchParams.get("categoryId") ?? "") ? (url.searchParams.get("categoryId") as string) : undefined,
        level: url.searchParams.get("level") ?? undefined,
        customerTypeId,
        quantity: qty,
      });
      return jsonOk(rows);
    } catch (error) {
      if (error instanceof RuleError) {
        return jsonError("BUSINESS_RULE", error.message, error.status);
      }
      throw error;
    }
  },
});
