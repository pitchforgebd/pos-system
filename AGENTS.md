<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

- Node.js 22 and MySQL 8 are on the Cloud Agent image. Install is `npm ci`. On boot, start MySQL, create the `meridian` database if needed, write gitignored `.env` when it is missing, run `npx prisma migrate deploy`, and run `npx prisma db seed` only when `users` is empty.
- `.env` holds `DATABASE_URL`, `AUTH_SECRET`, `SEED_OWNER_EMAIL`, and `SEED_OWNER_PASSWORD`. Do not commit it. Sign in at `/login` with those owner values.
- Start MySQL with `sudo service mysql start` if it is not already up. The app dev server is `npm run dev -- --hostname 0.0.0.0 --port 3000`.
- Open the UI at `http://localhost:3000`. Next.js development mode does not hydrate the app when it is opened as `127.0.0.1`, so the login form submits as a normal browser form there. `GET http://127.0.0.1:3000/api/health` still works as a readiness check and returns `database: ok` when MySQL is up.
- `npm test`, `npm run typecheck`, and `npm run build` are the checks to run. `npm run lint` is the lint command; it currently exits nonzero because of existing issues in `server.js` and a few React components.
