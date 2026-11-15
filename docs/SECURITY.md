# Security

**Status:** Requirements freeze  
**Phase:** 00 — Architecture Freeze  
**Verification:** Phase 04 covered auth basics. Phase 16 probed the section 8 list against the running code. Backups remain a Phase 19 operation.

## 1. Identity

- Passwords are hashed with bcrypt (cost 12). Plaintext passwords are never stored or logged. `bcryptjs` is used so the hash does not need a native build on cPanel.
- Sessions are server-side rows. The cookie `meridian_session` stores a random token. The database stores only an HMAC of that token, keyed with `AUTH_SECRET`. The cookie is `HttpOnly`, `Secure` in production, and `SameSite=Strict`.
- A session expires 12 hours after it is created. Activity does not extend it. A session that nobody uses for the shop's idle time (30 minutes by default, 5 to 720 in Settings > Security) is ended as well. Logout, a password reset and a password change revoke it (a password change keeps only the session that made it).
- Password reset tokens are single-use, stored only as a hash, and expire.
- Login and password reset are rate-limited, and the counters are kept in the database (`rate_limits`; the key is stored as a hash), so a restart or a second process does not forget them. Sign-in: 5 failures for one address with one email and 20 for one address over any email, in 15 minutes; a request with no known address shares one separate, much higher bucket and is logged. Reset: 5 requests for one email and 20 for one address, and 10 wrong tokens for one address, in an hour. Each failure after the second makes the next answer wait a little longer. The limit key does not use a client-chosen `X-Forwarded-For` address, and the same-site check does not trust `X-Forwarded-Host`: both headers are read only when `TRUST_PROXY=1` (for the address, only the last hop).
- An unknown email costs a password hash like a wrong password does, so the time taken says nothing about whether the email exists.
- Failed and successful logins are audited; the audit log keeps at most 10 failed sign-ins an hour for one address (the limit still counts all of them), so it cannot be filled from outside.
- A new password has at least 10 characters, is not among the several hundred most common passwords (with the usual letter-for-symbol swaps and trailing digits undone), is not a keyboard or number run, and does not contain the person's name or email. It is checked on a reset, a change, a new user and the first owner. Changing one's own password needs the old one. The reset token travels after the `#` of the link, never in a query string, and the sign-in, forgot and reset pages are sent with `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
- One installation serves one organization. An email address is looked up across the installation at sign-in; an address that more than one account holds cannot sign in.
- Disabled users cannot authenticate.
- Account status is checked on each authenticated request, not only at login.

## 2. Authorization

Server-side only. Order: authentication, organization, branch grant, permission, resource ownership.

A user cannot read or mutate another organization's rows. Queries include the session organization id. Missing cross-tenant rows respond as not found when existence would leak.

Branch-owned operations require `user_branch_access`. Sale and purchase detail reads use the session branch. A document on another branch of the same organization is not found.

Permission codes are `docs/PERMISSIONS.md`.

## 3. Input and output

- Zod on bodies, queries, and ids.
- Prisma parameterizes SQL. No string-built queries from user input.
- Rendered text is escaped by the framework. Rich text, if added later, needs an allowlist sanitizer before it is stored.
- API errors in production omit stacks, SQL, and secrets.
- Idempotency keys on the commands listed in `docs/API.md`.

## 4. Headers

Set on every response from `src/lib/security/headers.ts`:

```text
Content-Security-Policy (made for each request, with a nonce)
X-Content-Type-Options: nosniff
Referrer-Policy
Permissions-Policy
Strict-Transport-Security (production HTTPS)
Frame protection (CSP frame-ancestors or equivalent)
```

## 5. Files

Product images, documents, imports, and attachments:

- Allowlisted extension and MIME type
- Size limit
- Rejected executable types
- File signature check where the type can be spoofed by extension
- Generated storage name. Original filename is not a path segment.
- Storage outside executable web roots
- Downloads authorized with the same tenant and permission checks as the parent record

CSV import stores a sanitized basename. A path or an executable extension is rejected. The CSV body is parsed as text and is not written to disk. A product photo is stored only after the file bytes match JPEG, PNG, or WebP, and only under a generated name in `storage/product-images`. The original file name is not used as a path.

## 6. Secrets

Environment only. Never committed:

```text
.env
.env.local
DATABASE_URL
AUTH_SECRET
SMTP password
SMS credentials
storage keys
payment credentials
private tokens
```

`.env.example` may list keys with empty values. Phase 19 uses the blueprint environment list:

```text
NODE_ENV
DATABASE_URL
APP_URL
AUTH_SECRET
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
SMTP_FROM
SMS_PROVIDER
SMS_API_KEY
STORAGE_ENDPOINT
STORAGE_ACCESS_KEY
STORAGE_SECRET_KEY
STORAGE_BUCKET
```

## 7. Audit

Actions: login, failed login, create, update, delete, sale, purchase, return, payment, transfer, stock adjustment, accounting post, accounting reverse, role change, permission change, settings change, import, export.

Fields: organization, branch, user, action, module, entity type, entity id, before, after, IP, user agent, time.

Never log passwords, session tokens, reset tokens, or API secrets.

## 8. Threat list to test in Phase 16

```text
SQL injection
XSS
CSRF
IDOR
Privilege escalation
Cross-tenant access
Cross-branch access
Brute force
Credential stuffing
Session theft
Replay
Duplicate financial posts
Malicious uploads
Path traversal
Secret leakage
```

CSRF control chosen in Phase 04: `SameSite=Strict` session cookie, plus a same-origin check on mutating `/api` requests. The `Origin` host must match the request host. A missing or foreign origin is rejected. Login and password reset are limited to 5 attempts per 15 minutes (login) or per hour (reset) for each IP and email. Password reset tokens expire after 30 minutes, are stored only as an HMAC, and are single-use. The reset response does not reveal whether the email exists. Mail is not sent unless SMTP is configured later; the token itself is never returned by the API.

Phase 16 probes, in `src/modules/auth/security.test.ts`: a missing or foreign origin is rejected; the sixth login failure is rate-limited; a spoofed forwarding header does not choose the limit address; the session cookie is `HttpOnly` and `SameSite=Strict`; a failed login audit does not store the password; a search string is not executed as SQL; another organization's product is not returned; a sale on another branch is not returned; an unbalanced journal is rejected before it is saved; the health response does not include a connection string; an import name with a path or an executable extension is rejected. CSV text is parsed and is not written under the original filename. `Content-Security-Policy` is made for each request by `src/proxy.ts` with a nonce and `'strict-dynamic'`: no inline script and no eval run in production, and every page is rendered per request (a page made at build time has no nonce). Styles may stay inline. `Strict-Transport-Security` is sent when `APP_URL` is HTTPS. Rate-limit counters are kept in the database. SMTP is still not wired.

## 9. Abuse cases that must fail closed

- Double-submit of a payment
- Return quantity above the remaining eligible quantity
- Closing a shift that is already closed
- Posting a journal where debit does not equal credit
- Stock movement without a ledger row
- SMS or email failure after money has committed (money stays committed, notification is retried, failure is logged)

## 10. Backups

Daily database backup, copy off the server, retention policy, and a restore test. A backup is trusted only after restore has been tested. Phase 19 writes the operational steps. Phase 20 does not run destructive tests on production.
