import type { PermissionCode } from "@/lib/permissions/codes";

type Rule = { prefix: string; permission: PermissionCode | "closed" };

const rules: Rule[] = [
  { prefix: "/customers/loyalty", permission: "loyalty.manage" },
  { prefix: "/dashboard", permission: "dashboard.view" },
  { prefix: "/pos", permission: "sales.view" },
  { prefix: "/sales", permission: "sales.view" },
  { prefix: "/purchases", permission: "purchase.view" },
  { prefix: "/products", permission: "products.view" },
  { prefix: "/inventory", permission: "inventory.view" },
  { prefix: "/customers", permission: "customers.view" },
  { prefix: "/suppliers", permission: "suppliers.view" },
  { prefix: "/accounting", permission: "accounting.view" },
  { prefix: "/reports", permission: "reports.view" },
  { prefix: "/quotations", permission: "quotations.manage" },
  { prefix: "/orders", permission: "orders.view" },
  { prefix: "/shipments", permission: "shipments.view" },
  { prefix: "/couriers", permission: "shipments.view" },
  { prefix: "/requisitions", permission: "requisitions.manage" },
  { prefix: "/shifts", permission: "shifts.manage" },
  { prefix: "/sms", permission: "sms.manage" },
  { prefix: "/crm", permission: "crm.manage" },
  { prefix: "/branches", permission: "branches.manage" },
  { prefix: "/warehouses", permission: "branches.manage" },
  { prefix: "/racks", permission: "branches.manage" },
  { prefix: "/users", permission: "users.view" },
  { prefix: "/roles", permission: "roles.manage" },
  { prefix: "/permissions", permission: "roles.manage" },
  { prefix: "/audit-logs", permission: "audit.view" },
  { prefix: "/api-logs", permission: "closed" },
  { prefix: "/settings", permission: "settings.manage" },
];
rules.sort((left, right) => right.prefix.length - left.prefix.length);

export function pagePermission(pathname: string): PermissionCode | "closed" | "session" {
  if (pathname === "/missing") {
    return "session";
  }
  const match = rules.find((rule) => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`));
  return match?.permission ?? "closed";
}

export function decidePageAccess(pathname: string, permissions: ReadonlySet<string> | null) {
  if (!permissions) {
    return "login" as const;
  }
  const required = pagePermission(pathname);
  if (required === "session") {
    return "allow" as const;
  }
  if (required === "closed" || !permissions.has(required)) {
    return "forbidden" as const;
  }
  return "allow" as const;
}
