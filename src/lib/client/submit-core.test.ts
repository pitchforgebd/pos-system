import assert from "node:assert/strict";
import test from "node:test";

import { createSubmitter } from "./submit-core.ts";
import { submitMessages } from "./submit-messages.ts";
import { newUuid } from "./uuid.ts";

type Call = { url: string; init: RequestInit };

/** A fake fetch that answers from a script and remembers what it was asked. */
function fakeFetch(script: Array<(() => Response | Promise<Response>) | "network">) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const step = script.shift();
    if (step === undefined || step === "network") {
      throw new TypeError("Failed to fetch");
    }
    return step();
  }) as typeof fetch;
  return { fetchFn, calls };
}

const ok = (data: unknown, status = 201) => () => Response.json({ success: true, data, message: "Operation completed" }, { status });
const refused = (status: number, message: string, fields: Record<string, string> = {}) => () =>
  Response.json({ success: false, error: { code: "X", message, fields } }, { status });
const keyOf = (call: Call) => (call.init.headers as Record<string, string>)["idempotency-key"];

test("a retry after a lost answer sends the same key; after a success the next request gets a new one", async () => {
  const { fetchFn, calls } = fakeFetch(["network", ok({ id: "1" }), ok({ id: "2" })]);
  let n = 0;
  const submitter = createSubmitter({ fetch: fetchFn, newKey: () => `key-${++n}` });
  const request = { url: "/api/v1/sales", body: { total: "35.00" } };

  const lost = await submitter.submit(request);
  assert.equal(lost.ok, false);
  const retried = await submitter.submit(request);
  assert.equal(retried.ok, true);
  assert.equal(keyOf(calls[0]), "key-1");
  assert.equal(keyOf(calls[1]), "key-1", "the retry reuses the key, so the server saves once");

  const next = await submitter.submit(request);
  assert.equal(next.ok, true);
  assert.equal(keyOf(calls[2]), "key-2", "a finished attempt is over: the next sale is a new sale");
});

test("a different body is a different request and gets a new key", async () => {
  const { fetchFn, calls } = fakeFetch(["network", ok({})]);
  let n = 0;
  const submitter = createSubmitter({ fetch: fetchFn, newKey: () => `key-${++n}` });
  await submitter.submit({ url: "/api/v1/sales", body: { qty: "1" } });
  await submitter.submit({ url: "/api/v1/sales", body: { qty: "2" } });
  assert.deepEqual(calls.map(keyOf), ["key-1", "key-2"]);
});

test("no answer is told apart from a refusal and from a server error, and only the first two may be retried as is", async () => {
  const { fetchFn } = fakeFetch(["network", refused(500, "boom"), refused(422, "Insufficient stock.", { quantity: "Too many" }), refused(409, "That number is used.")]);
  const submitter = createSubmitter({ fetch: fetchFn, newKey: () => "k" });
  const request = { url: "/x", body: {} };

  const network = await submitter.submit(request);
  assert.ok(!network.ok);
  assert.equal(network.kind, "network");
  assert.equal(network.retryable, true);
  assert.equal(network.message, submitMessages.network);
  assert.match(network.message, /ইন্টারনেট/, "the message is in Bangla");

  const server = await submitter.submit(request);
  assert.ok(!server.ok);
  assert.equal(server.kind, "server");
  assert.equal(server.retryable, true);
  assert.equal(server.message, submitMessages.server, "the server's own text is never shown for a 5xx");

  const rejected = await submitter.submit(request);
  assert.ok(!rejected.ok);
  assert.equal(rejected.kind, "rejected");
  assert.equal(rejected.status, 422);
  assert.equal(rejected.retryable, false);
  assert.equal(rejected.message, "Insufficient stock.");
  assert.deepEqual(rejected.fields, { quantity: "Too many" });

  const conflict = await submitter.submit(request);
  assert.ok(!conflict.ok);
  assert.equal(conflict.status, 409);
});

test("a second click while the first request runs sends nothing", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { fetchFn, calls } = fakeFetch([async () => (await gate, Response.json({ success: true, data: { id: "1" } }, { status: 201 }))]);
  const submitter = createSubmitter({ fetch: fetchFn });
  const first = submitter.submit({ url: "/api/v1/sales", body: { a: 1 } });
  assert.equal(submitter.busy, true);
  const second = await submitter.submit({ url: "/api/v1/sales", body: { a: 1 } });
  assert.ok(!second.ok);
  assert.equal(second.kind, "busy");
  release();
  assert.equal((await first).ok, true);
  assert.equal(calls.length, 1, "only one request reached the server");
  assert.equal(submitter.busy, false);
});

test("a request that never answers is given up on and treated as no answer, keeping its key", async () => {
  const hangs = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
  let n = 0;
  const submitter = createSubmitter({ fetch: hangs, timeoutMs: 20, newKey: () => `key-${++n}` });
  const request = { url: "/x", body: { a: 1 } };
  const result = await submitter.submit(request);
  assert.ok(!result.ok);
  assert.equal(result.kind, "network");
  assert.equal(submitter.busy, false);
  assert.equal(submitter.key, "key-1");
  await submitter.submit(request);
  assert.equal(submitter.key, "key-1", "still the same attempt");
});

test("a replayed answer is flagged, and the body is sent as JSON with the key in the header", async () => {
  const { fetchFn, calls } = fakeFetch([ok({ id: "1", number: "INV-2627-000007", replayed: true }, 200)]);
  const submitter = createSubmitter({ fetch: fetchFn, newKey: () => "abc" });
  const result = await submitter.submit<{ number: string }>({ url: "/api/v1/sales", body: { total: "35.00" } });
  assert.ok(result.ok);
  assert.equal(result.replayed, true);
  assert.equal(result.data.number, "INV-2627-000007");
  assert.equal(calls[0].init.method, "POST");
  assert.equal((calls[0].init.headers as Record<string, string>)["content-type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ total: "35.00" }));
});

test("a file upload is sent as is and every upload is its own request", async () => {
  const { fetchFn, calls } = fakeFetch([ok({}), ok({})]);
  let n = 0;
  const submitter = createSubmitter({ fetch: fetchFn, newKey: () => `key-${++n}` });
  const form = new FormData();
  form.set("file", new Blob(["x"]), "a.png");
  await submitter.submit({ url: "/api/v1/products/1/image", body: form });
  await submitter.submit({ url: "/api/v1/products/1/image", body: form });
  assert.deepEqual(calls.map(keyOf), ["key-1", "key-2"]);
  assert.equal(calls[0].init.body, form);
  assert.equal((calls[0].init.headers as Record<string, string>)["content-type"], undefined, "the browser sets the multipart boundary");
});

test("newUuid is a valid v4 UUID even where crypto.randomUUID does not exist (plain http on the shop network)", () => {
  const withoutRandomUuid = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
  const seen = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const id = newUuid(withoutRandomUuid);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    seen.add(id);
  }
  assert.equal(seen.size, 200);
  assert.match(newUuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
