# uPVC Order Management

An internal order, quotation, and production tracking system for a uPVC windows and doors business. Build modules sequentially, beginning with user access and administration.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/upvc-order-management run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required secrets: `MONGODB_URI`, `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
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