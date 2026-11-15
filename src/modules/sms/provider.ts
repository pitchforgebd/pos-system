// The SMS gateway (P10 task 6, D12). The shop opens an account with a Bangladeshi provider; which one is set in the environment, never in code, and
// its keys stay in the environment too. Most providers take a plain HTTP request with the number, the message, the sender id and an API key, so one
// configurable provider covers them:
//
//   SMS_PROVIDER=http
//   SMS_HTTP_URL=https://provider.example/api/send?api_key={api_key}&senderid={sender}&number={to}&message={message}
//   SMS_HTTP_METHOD=GET            (or POST: then SMS_HTTP_BODY is the form body, with the same {placeholders})
//   SMS_API_KEY=...                SMS_SENDER_ID=...
//   SMS_HTTP_SUCCESS=...           (optional: text the answer must contain to count as sent)
//   SMS_NUMBER_FORMAT=880          (880: 8801XXXXXXXXX; 0: 01XXXXXXXXX)
//   SMS_BALANCE_URL=https://provider.example/api/balance?api_key={api_key}   (optional)
//
// SMS_PROVIDER=dry-run records messages as sent without sending anything (for trying the system). Without SMS_PROVIDER nothing is sent: messages
// wait in the outbox until a provider is set.

export type SendResult = { ok: true; ref: string | null; note: string } | { ok: false; error: string };

export interface SmsProvider {
  readonly name: string;
  send(to: string, body: string): Promise<SendResult>;
  /** What is left on the account, as the provider says it; null when it cannot say. */
  balance?(): Promise<string | null>;
}

const OVERRIDE = Symbol.for("meridian.sms.provider");
type Holder = { [OVERRIDE]?: SmsProvider | null };

/** Tests put their own provider in place (null: back to the environment). */
export function setSmsProviderForTests(provider: SmsProvider | null) {
  (globalThis as Holder)[OVERRIDE] = provider;
}

const env = (name: string) => process.env[name]?.trim() || "";

function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{(to|message|sender|api_key)\}/g, (_, key: string) => encodeURIComponent(values[key] ?? ""));
}

function number(to: string) {
  return env("SMS_NUMBER_FORMAT") === "0" ? to : `88${to}`;
}

const dryRun: SmsProvider = {
  name: "dry-run",
  async send() {
    return { ok: true, ref: null, note: "Dry run: recorded, not sent." };
  },
  async balance() {
    return null;
  },
};

function httpProvider(): SmsProvider | null {
  const url = env("SMS_HTTP_URL");
  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    return null;
  }
  return {
    name: "http",
    async send(to, body) {
      const values = { to: number(to), message: body, sender: env("SMS_SENDER_ID"), api_key: env("SMS_API_KEY") };
      const post = env("SMS_HTTP_METHOD").toUpperCase() === "POST";
      try {
        const response = await fetch(fill(url, values), {
          method: post ? "POST" : "GET",
          headers: post ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
          body: post ? fill(env("SMS_HTTP_BODY"), values) : undefined,
          signal: AbortSignal.timeout(15_000),
        });
        const text = (await response.text()).slice(0, 200);
        const expected = env("SMS_HTTP_SUCCESS");
        if (!response.ok || (expected && !text.includes(expected))) {
          return { ok: false, error: `The provider said ${response.status}: ${text || "nothing"}`.slice(0, 250) };
        }
        return { ok: true, ref: text.slice(0, 128) || null, note: "Sent." };
      } catch {
        return { ok: false, error: "The provider did not answer." };
      }
    },
    async balance() {
      const balanceUrl = env("SMS_BALANCE_URL");
      if (!balanceUrl) {
        return null;
      }
      try {
        const response = await fetch(fill(balanceUrl, { to: "", message: "", sender: env("SMS_SENDER_ID"), api_key: env("SMS_API_KEY") }), { signal: AbortSignal.timeout(10_000) });
        const found = (await response.text()).match(/-?\d+(\.\d+)?/);
        return response.ok && found ? found[0] : null;
      } catch {
        return null;
      }
    },
  };
}

/** The provider in use, or null when none is set up (messages then wait in the outbox). */
export function currentProvider(): SmsProvider | null {
  const holder = globalThis as Holder;
  if (holder[OVERRIDE] !== undefined) {
    return holder[OVERRIDE] ?? null;
  }
  const chosen = env("SMS_PROVIDER").toLowerCase();
  if (chosen === "dry-run") {
    return dryRun;
  }
  if (chosen === "http") {
    return httpProvider();
  }
  return null;
}
