# uPVC Order Management

An internal order, quotation, and production tracking system for a uPVC windows and doors business. Build modules sequentially, beginning with user access and administration.

## Run & Operate

- In Replit, start the managed workflows `artifacts/api-server: API Server` and `artifacts/upvc-order-management: web`. Open the web app at `/`; API routes are served at `/api`. The Canvas preview workflow is optional and is not needed to run the app.
- Managed workflows supply `PORT` and `BASE_PATH`; the commands below are package entry points, not standalone shell commands without that environment.
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/upvc-order-management run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required Replit Secrets: `MONGODB_URI` for the intended MongoDB database, and `SESSION_SECRET` for staff sessions. Set both before starting the API.
- Install the imported dependencies with `pnpm install --frozen-lockfile`.
- Startup verification: `/api/healthz` returns `{"status":"ok"}`, `/api/auth/session` returns `{"authenticated":false,"user":null}` when signed out, and `/` displays staff sign-in. Sign in as an existing Master Admin and open `/admin/users` to verify that the Users page loads from the connected database. Setup does not create accounts or demo data.
- The API runs its existing index setup and compatibility migrations on startup.
- Project-local `uploads/` files are not included in Git imports. Restore any needed historical files separately; do not assume MongoDB metadata includes those file bytes. Local uploads may be lost on a published-app restart or publish.

## Stack

- pnpm workspaces, Node.js 20.20, TypeScript 5.9
- Web: React + Vite
- API: Express 5
- Persistence: MongoDB only, using the MongoDB Node.js driver
- Authentication: username/password with Mongo-backed sessions
- Validation and API client: Zod + Orval (from the OpenAPI spec)

## Where things live

- `artifacts/upvc-order-management` — web application
- `artifacts/api-server` — API routes, MongoDB connection, session handling, indexes, and migrations
- `lib/api-spec/openapi.yaml` — API contract
- `lib/api-client-react` and `lib/api-zod` — generated API client and validation schemas

## Architecture decisions

- MongoDB is the only persistence layer; do not add PostgreSQL or relational storage.
- Implement modules in the master prompt's order. Only Module 1 is in scope until it is confirmed.
- Local username/password authentication is required by the product specification; there is no public self-registration.
- Role permissions use `none`, `view`, and `edit`; user overrides take precedence over role defaults.

## Product

The first release provides sign-in, role-specific dashboard shells, Master Admin user management, custom roles, and per-module permissions. Later business modules remain visible as Coming Soon until built.

## Gotchas

- Do not add automatic database seeding. Existing MongoDB records must not be replaced or repopulated by startup code; provision initial users, roles, and business data explicitly.
- Do not use PostgreSQL tooling or the removed relational DB scaffold.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details