// The one place a browser form sends a write to the server (invariant I17 on the client side). It is plain
// TypeScript with no React in it so it can be tested without a browser; `useSubmit` wraps it for components.
//
//  - One Idempotency-Key per attempt. A retry of the same request (the answer was lost, the network dropped, the
//    server answered 5xx) sends the same key, so the server saves once and answers the same way. A different body
//    is a different request and gets a fresh key. After a success the next submit starts a new attempt.
//  - A second click while the first request runs does nothing.
//  - "No answer" (offline, timeout) and 5xx are told apart from a refusal (4xx) so the form can say what to do.
import { submitMessages } from "@/lib/client/submit-messages";
import { newUuid } from "@/lib/client/uuid";

export type SubmitRequest = {
  url: string;
  /** Default POST. */
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  /** A plain object is sent as JSON; a FormData (a file upload) is sent as is and always gets a fresh key. */
  body?: unknown;
};

export type SubmitFailure = {
  ok: false;
  /** network: no answer at all; server: 5xx; rejected: a 4xx with the server's reason; busy: a request is already running. */
  kind: "network" | "server" | "rejected" | "busy";
  status: number | null;
  message: string;
  /** Field name -> message, for a 400 that names the fields. */
  fields: Record<string, string>;
  /** The same request may be sent again as is (same key): nothing is lost, nothing is saved twice. */
  retryable: boolean;
};

export type SubmitSuccess<T> = { ok: true; status: number; data: T; message: string; replayed: boolean };

export type SubmitResult<T> = SubmitSuccess<T> | SubmitFailure;

export type SubmitterOptions = {
  fetch?: typeof fetch;
  newKey?: () => string;
  /** Give up waiting after this long and treat it as "no answer" (default 30 s). */
  timeoutMs?: number;
};

type Attempt = { key: string; signature: string };

function failure(kind: SubmitFailure["kind"], status: number | null, message: string, fields: Record<string, string> = {}): SubmitFailure {
  return { ok: false, kind, status, message, fields, retryable: kind === "network" || kind === "server" };
}

export function createSubmitter(options: SubmitterOptions = {}) {
  const send = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const newKey = options.newKey ?? newUuid;
  const timeoutMs = options.timeoutMs ?? 30_000;
  let attempt: Attempt | null = null;
  let busy = false;

  /** The attempt for this request: the same key while the request is the same, a new one when it changed. */
  function attemptFor(request: SubmitRequest): Attempt {
    const isFile = typeof FormData !== "undefined" && request.body instanceof FormData;
    const signature = isFile ? "" : `${request.method ?? "POST"} ${request.url} ${JSON.stringify(request.body ?? null)}`;
    if (!isFile && attempt && attempt.signature === signature) {
      return attempt;
    }
    attempt = { key: newKey(), signature };
    return attempt;
  }

  async function submit<T = unknown>(request: SubmitRequest): Promise<SubmitResult<T>> {
    if (busy) {
      return failure("busy", null, submitMessages.busy);
    }
    busy = true;
    const current = attemptFor(request);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const isFile = typeof FormData !== "undefined" && request.body instanceof FormData;
      const headers: Record<string, string> = { "idempotency-key": current.key };
      if (request.body !== undefined && !isFile) {
        headers["content-type"] = "application/json";
      }
      let response: Response;
      try {
        response = await send(request.url, {
          method: request.method ?? "POST",
          headers,
          body: request.body === undefined ? undefined : isFile ? (request.body as FormData) : JSON.stringify(request.body),
          signal: controller.signal,
        });
      } catch {
        return failure("network", null, submitMessages.network);
      }
      let envelope: { success?: boolean; data?: unknown; message?: string; error?: { message?: string; fields?: Record<string, string> } } | null = null;
      try {
        envelope = await response.json();
      } catch {
        envelope = null;
      }
      if (response.ok && envelope?.success !== false) {
        attempt = null;
        const data = (envelope?.data ?? null) as T;
        const replayed = typeof data === "object" && data !== null && (data as { replayed?: unknown }).replayed === true;
        return { ok: true, status: response.status, data, message: envelope?.message ?? "", replayed };
      }
      if (response.status >= 500) {
        return failure("server", response.status, submitMessages.server);
      }
      return failure("rejected", response.status, envelope?.error?.message ?? submitMessages.rejected, envelope?.error?.fields ?? {});
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  }

  return {
    submit,
    /** True while a request is running. */
    get busy() {
      return busy;
    },
    /** The key of the attempt in progress, or null (for tests and diagnostics). */
    get key() {
      return attempt?.key ?? null;
    },
    /** Forget the attempt, so the next submit starts a new one (the form was reset or left). */
    reset() {
      attempt = null;
    },
  };
}
