# cPanel deployment

Target: one cPanel Node.js application, MySQL 8, and SSL. Do not commit `.env` or any production secret.

## 1. Application

In **Setup Node.js App**:

- Node.js 20.9 or newer. This project is developed and deployed on Node.js 22.
- Application mode: Production.
- Application root: the Git checkout, outside `public_html` when the host allows it.
- Application startup file: `server.js`.
- Application URL: the SSL hostname.

`server.js` is a small custom server. It calls `next()` with `dev: false`, serves requests on `PORT` (cPanel sets it), logs start-up and request errors to stderr, and closes the HTTP server and the database connection on `SIGTERM`. Set `HOSTNAME` only when the host requires a specific bind address. The default bind is `0.0.0.0`. Build first. `server.js` does not build.

## 2. Environment

Enter these in the cPanel environment panel. Prisma also reads a `.env` file in the application root. Leave a value empty when this list says it is not read.

| Name | Use |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `mysql://USER:PASSWORD@127.0.0.1:3306/DATABASE?connection_limit=5`. Percent-encode special characters in the password. `connection_limit` is per Node process; keep the total below the host's MySQL connection limit. |
| `APP_URL` | `https://` the public hostname. HTTPS turns on HSTS. |
| `AUTH_SECRET` | A long random secret. `openssl rand -hex 32` |
| `TRUST_PROXY` | `1` behind cPanel's proxy, so the client IP is the last forwarded address. |
| `SEED_OWNER_EMAIL` | Only for the first empty database. |
| `SEED_OWNER_PASSWORD` | Only for the first empty database. At least 8 characters. |
| `SEED_DEMO` | Leave unset on production. `1` adds demo products, customers, and posted sales. Local development only. |
| `NEXT_BUILD_CPUS` | `1` while running `npm run build:cpanel`. Without it Next.js starts one worker per server CPU and the build can stop with `pthread_create: Resource temporarily unavailable`. |
| `SMS_PROVIDER_URL` | Optional. When empty, SMS is saved as failed. |
| `BACKUP_DIR` | Optional. Defaults to `../meridian-backups`, which must not be inside `public_html`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Optional. When `SMTP_HOST` and `SMTP_FROM` are set, password reset mail is sent. When they are empty no mail is sent. |
| `SMS_PROVIDER`, `SMS_API_KEY` | Not read. |
| `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET` | Not read. Files are not stored in object storage. |

`.env.example` lists the same names with empty values.

## 3. Release steps

Run these in the application's virtual environment. The command to enter it is shown on the Node.js app page (`source /home/USER/nodevenv/APP/22/bin/activate`).

```text
git pull
npm install --include=dev
npx prisma migrate deploy
NEXT_BUILD_CPUS=1 NODE_OPTIONS="--max-old-space-size=2048" npm run build:cpanel
```

Restart the Node.js application from cPanel after the build.

Why these differ from a plain `npm install && npm run build`:

- `NODE_ENV=production` makes `npm install` skip dev dependencies. The build needs `typescript`, `tailwindcss`, and `@tailwindcss/postcss`, so use `--include=dev`.
- cPanel makes `node_modules` a symlink to a folder outside the application root. Turbopack, the default bundler, rejects that. `build:cpanel` runs `next build --webpack`.
- `NEXT_BUILD_CPUS=1` limits build workers (see the table above).

Use `npx prisma migrate deploy`. Do not use `migrate dev` on the server.

## 4. First install only

On an empty database, once:

```text
npx prisma db seed
```

The seed adds permissions, the chart of accounts, and the owner account from `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD`. It does not add demo data unless `SEED_DEMO=1`. Do not seed again over a live database. A second run only adds missing grants to Super Admin and does not remove any, but there is nothing to gain from it after launch.

## 5. Health and smoke

`GET /api/health` returns `status`, `database`, and `version` inside the normal JSON body. A database failure returns HTTP 500. The body does not include a connection string.

After restart, open `/login` and `/api/health` over HTTPS. Phase 20 is the full production check. Do not post sales, purchases, or stock as a deployment test.

## 6. SSL

Issue the certificate with AutoSSL or the host's SSL tool. `APP_URL` must be the `https://` origin. A plain HTTP site does not send HSTS.

## 7. Backup cron

The backup command is:

```text
cd /home/USER/app && set -a && . ./.env && set +a && /home/USER/nodevenv/APP/22/bin/node scripts/cpanel-backup.mjs
```

Schedule it daily in cPanel Cron Jobs. The script reads `DATABASE_URL` from the environment, writes one gzip dump per day, and deletes dumps older than 14 days. The directory must be outside `public_html`. Copy that directory off the server. A backup is trusted only after a restore onto a separate empty database, not onto the live one. Product photos are stored under `storage/` in the application root and are not part of the database dump; copy that folder too.

## 8. What stays unwired

SMS provider credentials, the blueprint SMS key names, and object storage have no code path. In-memory rate limits reset when the process restarts. There is no second application cron.
