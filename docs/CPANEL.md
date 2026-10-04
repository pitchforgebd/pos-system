# cPanel deployment

Target: one cPanel Node.js application, MySQL 8, and SSL. Do not commit `.env` or any production secret.

## 1. Application

In **Setup Node.js App**:

- Node.js 20.9 or newer. This project is developed on Node.js 22.
- Application mode: Production.
- Application root: the Git checkout, outside `public_html` when the host allows it.
- Application startup file: `server.js`.
- Application URL: the SSL hostname.

`server.js` starts `next start` on `PORT`. cPanel sets `PORT`. Set `HOSTNAME` only when the host requires a specific bind address. The default bind is `0.0.0.0`.

## 2. Environment

Enter these in the cPanel environment panel. Leave a value empty when this list says it is not read.

| Name | Use |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `mysql://USER:PASSWORD@127.0.0.1:3306/DATABASE` |
| `APP_URL` | `https://` the public hostname. HTTPS turns on HSTS. |
| `AUTH_SECRET` | A long random secret. |
| `TRUST_PROXY` | `1` behind cPanel's proxy, so the client IP is the last forwarded address. |
| `SEED_OWNER_EMAIL` | Only for the first empty database. |
| `SEED_OWNER_PASSWORD` | Only for the first empty database. |
| `SMS_PROVIDER_URL` | Optional. When empty, SMS is saved as failed. |
| `BACKUP_DIR` | Optional. Defaults to `../meridian-backups`, which must not be inside `public_html`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Not read. Mail is not sent. |
| `SMS_PROVIDER`, `SMS_API_KEY` | Not read. |
| `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET` | Not read. Files are not stored in object storage. |

`.env.example` lists the same names with empty values.

## 3. Release steps

```text
git pull
npm install
npx prisma migrate deploy
npm run build
```

Restart the Node.js application from cPanel after the build.

Use `npx prisma migrate deploy`. Do not use `migrate dev` on the server. Run `npx prisma db seed` only on an empty database, once. Do not seed again over live rows.

## 4. Health and smoke

`GET /api/health` returns `status`, `database`, and `version` inside the normal JSON body. A database failure returns HTTP 500. The body does not include a connection string.

After restart, open `/login` and `/api/health` over HTTPS. Phase 20 is the full production check. Do not post sales, purchases, or stock as a deployment test.

## 5. SSL

Issue the certificate with AutoSSL or the host's SSL tool. `APP_URL` must be the `https://` origin. A plain HTTP site does not send HSTS.

## 6. Backup cron

The backup command is:

```text
/usr/bin/node /home/USER/app/scripts/cpanel-backup.mjs
```

Schedule it daily in cPanel Cron Jobs. The script reads `DATABASE_URL` from the environment, writes one gzip dump per day, and deletes dumps older than 14 days. The directory must be outside `public_html`. Copy that directory off the server. A backup is trusted only after a restore onto a separate empty database, not onto the live one.

## 7. What stays unwired

SMTP, the blueprint SMS key names, and object storage have no code path. In-memory rate limits reset when the process restarts. There is no second application cron.
