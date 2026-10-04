export async function deliverSms(input: { to: string; body: string }) {
  const endpoint = process.env.SMS_PROVIDER_URL?.trim();
  if (!endpoint) {
    return { ok: false as const, result: "Provider is not configured." };
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: input.to, body: input.body }),
    });
    const text = (await response.text()).slice(0, 200);
    if (!response.ok) {
      return { ok: false as const, result: text || `Provider returned ${response.status}.` };
    }
    return { ok: true as const, result: text || "Sent." };
  } catch {
    return { ok: false as const, result: "Provider did not respond." };
  }
}
