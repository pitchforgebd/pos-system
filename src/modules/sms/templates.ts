export const smsVariables = [
  "customer_name",
  "customer_wallet_point",
  "previous_due",
  "todays_bill",
  "total_bill",
  "todays_paid",
  "invoice_number",
  "current_balance",
  "shop_name",
  "paid_amount",
  "due_amount",
] as const;

const allowed = new Set<string>(smsVariables);

export function validateTemplateBody(body: string) {
  const text = body.trim();
  if (!text || text.length > 1000) {
    return "Enter a message of up to 1000 characters.";
  }
  let stripped = text;
  for (const name of smsVariables) {
    stripped = stripped.split(`{${name}}`).join("");
  }
  if (stripped.includes("{") || stripped.includes("}")) {
    return "That variable is not allowed.";
  }
  return null;
}

export function renderTemplate(body: string, values: Record<string, string>) {
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) {
      return { ok: false as const, message: "That variable is not allowed." };
    }
  }
  let rendered = body;
  for (const name of smsVariables) {
    const value = (values[name] ?? "").replace(/[{}]/g, "");
    rendered = rendered.split(`{${name}}`).join(value);
  }
  return { ok: true as const, body: rendered };
}
