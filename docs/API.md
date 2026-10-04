# API

**Status:** Contract freeze  
**Phase:** 00 — Architecture Freeze  
**Implementation:** Phase 04 onward. Phase 01 and 02 do not expose fake success handlers.

## 1. Base

```text
/api/v1/
```

`GET /api/health` is outside the version prefix:

```json
{
  "status": "ok",
  "database": "ok",
  "version": "1.0.0"
}
```

Health returns no secrets and no connection strings. Until the database exists, this route is not implemented.

## 2. Success

```json
{
  "success": true,
  "data": {},
  "message": "Operation completed",
  "meta": {}
}
```

`meta` carries pagination when a list is returned: page or cursor, page size, and total when the query can count it cheaply.

## 3. Error

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "fields": {}
  }
}
```

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Zod or business-input failure. Field map when the failure is per field |
| `AUTHENTICATION_ERROR` | 401 | Missing or invalid session |
| `AUTHORIZATION_ERROR` | 403 | Authenticated, permission or branch denied |
| `NOT_FOUND` | 404 | Missing, or hidden because it is outside the tenant |
| `CONFLICT` | 409 | Unique constraint, idempotency payload mismatch, illegal state change |
| `BUSINESS_RULE` | 422 | Rule rejected the operation, such as insufficient stock once that rule is approved |
| `RATE_LIMITED` | 429 | Login or other sensitive throttle |
| `EXTERNAL_SERVICE_ERROR` | 502 | SMS, SMTP, or storage failed |
| `DATABASE_ERROR` | 500 | Persistence failed. Body stays generic |

Cross-tenant access uses `NOT_FOUND` when revealing existence would leak another tenant. Use `AUTHORIZATION_ERROR` when the user is inside the tenant but lacks permission or branch access.

Production bodies do not include stack traces, SQL, or secret values.

## 4. Identity

Session cookie authenticates the caller. Handlers load organization, user, and branch grants from that session.

Rejected as authority when supplied by the client:

```text
organizationId
branchId
userId
roleId
```

A branch filter is allowed only if that branch is in the caller's grants. The server drops or rejects any other branch id.

## 5. Validation

Every body, query string, and route id is parsed with Zod before a service runs. Unknown fields are stripped. Financial amounts are decimal strings, not JSON floats, once money endpoints exist.

## 6. Idempotency

Header:

```text
Idempotency-Key: <uuid>
```

Required on:

```text
sale create
purchase create
return create
payment create
advance create
transfer create and status transitions that move stock
stock adjustment
opening stock
own stock
loyalty redemption
shift close
accounting post
```

## 7. Pagination and filters

Admin lists use offset pagination. High-volume ledgers and reports use cursor pagination when offset becomes misleading. Filters run in SQL. The API does not return an entire ledger for the client to filter.

## 8. Frozen examples

These paths are required examples. They are not implemented in Phase 00.

```text
GET    /api/v1/products
POST   /api/v1/products
GET    /api/v1/products/:id
PATCH  /api/v1/products/:id

POST   /api/v1/sales
GET    /api/v1/sales
GET    /api/v1/sales/:id
POST   /api/v1/sales/:id/cancel
POST   /api/v1/sales/:id/return

GET    /api/v1/inventory/stock
GET    /api/v1/inventory/ledger
POST   /api/v1/inventory/adjustments
POST   /api/v1/inventory/transfers

GET    /api/v1/customers
POST   /api/v1/customers
POST   /api/v1/customers/:id/payment
POST   /api/v1/customers/:id/advance
```

Later phases add resources that match the route map: purchases, suppliers, accounting, shifts, SMS, CRM, reports, quotations, requisitions, users, roles. Each new route uses this envelope and the permission catalog in `docs/PERMISSIONS.md`.

## 9. Transaction history filters

When the transactions API is built, it accepts from date, to date, and account head, and returns date, type, cash or bank, amount, credit or debit, reference, and created-by user. Types are the enums in `docs/BUSINESS_RULES.md`, not free-form strings.

## 10. What Phase 01 and 02 must not add

No route that returns `success: true` for a command that does not persist. Mock UI data stays in the frontend module marked as mock.
