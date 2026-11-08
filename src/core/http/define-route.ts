import { Prisma } from "@prisma/client";
import type { ZodType } from "zod";

import { RuleError } from "@/core/errors/rule-error";
import { isKeyRace } from "@/core/idempotency";
import { runTx } from "@/core/tx/run";
import { clientIp, jsonError, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import type { SessionContext } from "@/modules/auth/session";

export type RouteContext<TBody = undefined, TParams = Record<string, string>> = {
  request: Request;
  /** The signed-in user. Present on every route that is not `public`. */
  session: SessionContext;
  /** The URL parameters of a dynamic route, already resolved. */
  params: TParams;
  /** The parsed body, when the route declares a `body` schema. */
  body: TBody;
  /** The Idempotency-Key header, when the route is `idempotent`. */
  idempotencyKey: string | null;
  /** Who is acting and where, taken from the session and the connection; never from the client. */
  ip: string;
  userAgent: string | null;
};

export type RouteConfig<TBody, TParams> = {
  /** No session needed (login, health). A write to a public route still checks the origin. */
  public?: boolean;
  /** Permission code(s) the user must hold (all of them). */
  permission?: string | string[];
  /** Zod schema of the JSON body. A body that does not fit is a 400 naming the fields. */
  body?: ZodType<TBody>;
  /** The request must carry a valid Idempotency-Key header. */
  idempotent?: boolean;
  /** Check that the request comes from this site. Default: on for everything except GET/HEAD/OPTIONS. */
  csrf?: boolean;
  /**
   * Run the whole handler in one database transaction (default: on for writes), so the documents, the stock, the
   * journal and the audit row are saved together or not at all. A 4xx answer or a thrown error undoes everything.
   * Turn it off only for a handler that must call an outside service (SMS, mail): a retry would send twice.
   */
  transaction?: boolean;
  handler: (ctx: RouteContext<TBody, TParams>) => Promise<Response>;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const KEY_PATTERN = /^[0-9a-f-]{36}$/i;

/** Thrown inside the transaction to undo it when the handler answers with an error, then turned back into that answer. */
class RollbackWith extends Error {
  response: Response;

  constructor(response: Response) {
    super("rollback");
    this.response = response;
  }
}

function ruleCode(status: number) {
  return status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : "BUSINESS_RULE";
}

function fieldErrors(issues: { path: (string | number)[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const name = issue.path.join(".") || "body";
    fields[name] ??= issue.message;
  }
  return fields;
}

/**
 * The one way to write an API route (invariant I17). It does, in this order: the origin check (writes), the
 * session, the permission, the URL parameters, the body check (zod), the Idempotency-Key check, then runs the
 * handler in a transaction (writes) and turns what happens into the standard answer: a rule refusal is 404, 409
 * or 422, a bad request 400, an unexpected error 500 without details. The handler only does the work.
 *
 *   export const POST = defineRoute({
 *     permission: "sales.create",
 *     body: SaleInput,
 *     idempotent: true,
 *     handler: async ({ session, body, idempotencyKey }) => jsonOk(await postSale(...)),
 *   });
 */
export function defineRoute<TBody = undefined, TParams = Record<string, string>>(config: RouteConfig<TBody, TParams>) {
  // Next.js passes { params } as the second argument; the type must not be optional for its route type check.
  return async function route(request: Request, context: { params: Promise<TParams> }): Promise<Response> {
    const mutating = !SAFE_METHODS.has(request.method.toUpperCase());

    if (config.csrf ?? mutating) {
      const rejected = rejectCrossSite(request);
      if (rejected) {
        return rejected;
      }
    }

    let session = undefined as unknown as SessionContext;
    if (!config.public) {
      const auth = await requireSession(request);
      if (!auth.ok) {
        return auth.response;
      }
      session = auth.session;
      for (const code of [config.permission ?? []].flat()) {
        const denied = requirePermission(session, code);
        if (denied) {
          return denied;
        }
      }
    }

    const params = (context?.params ? await context.params : {}) as TParams;

    let idempotencyKey: string | null = null;
    if (config.idempotent) {
      const header = request.headers.get("idempotency-key")?.trim() ?? "";
      if (!KEY_PATTERN.test(header)) {
        return jsonError("VALIDATION_ERROR", "A valid Idempotency-Key header is required.", 400, {
          "idempotency-key": "Send a fresh UUID for each attempt.",
        });
      }
      idempotencyKey = header;
    }

    // A body can be read once. The request is read here, one time, and every attempt of the handler gets its own copy
    // built from those bytes: a rerun after an idempotency-key race must still find its body.
    const transactional = config.transaction ?? mutating;
    const raw = mutating && request.body !== null && (config.body || transactional) ? await request.arrayBuffer() : null;
    const attemptRequest = () =>
      raw === null ? request : new Request(request.url, { method: request.method, headers: request.headers, body: raw.byteLength > 0 ? raw : undefined });

    let body = undefined as TBody;
    if (config.body) {
      let json: unknown = null;
      if (raw !== null) {
        try {
          json = JSON.parse(new TextDecoder().decode(raw));
        } catch {
          json = null;
        }
      }
      const parsed = config.body.safeParse(json);
      if (!parsed.success) {
        return jsonError("VALIDATION_ERROR", "The request is not valid.", 400, fieldErrors(parsed.error.issues));
      }
      body = parsed.data;
    }

    const makeContext = (): RouteContext<TBody, TParams> => ({
      request: attemptRequest(),
      session,
      params,
      body,
      idempotencyKey,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    try {
      if (transactional) {
        // READ COMMITTED: a repeated request sees the key its twin has just committed, and a scan of a small table
        // takes no gap locks that block another request's insert.
        return await runTx(
          async () => {
            const response = await config.handler(makeContext());
            if (response.status >= 400) {
              throw new RollbackWith(response);
            }
            return response;
          },
          // An idempotency-key race (a twin request committed first) reruns the whole request, which then replays.
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, retryIf: isKeyRace },
        );
      }
      return await config.handler(makeContext());
    } catch (error) {
      if (error instanceof RollbackWith) {
        return error.response;
      }
      if (error instanceof RuleError) {
        return jsonError(ruleCode(error.status), error.message, error.status);
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return jsonError("CONFLICT", "That value is already used.", 409);
      }
      console.error(`[route] ${request.method} ${new URL(request.url).pathname} failed:`, error);
      return jsonError("INTERNAL_ERROR", "Something went wrong. Try again.", 500);
    }
  };
}
