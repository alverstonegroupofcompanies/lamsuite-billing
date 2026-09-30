# ADR 0002: Backend Framework & API Parity Architecture

## Status
Proposed / Evaluated

## Context
Goal 1 and Non-Negotiable Requirement 4 state:
> "Backend: Choose the framework that pairs best with Tauri (Laravel, Nuxt/Nitro, Node, Rust/Axum, etc.) and justify the choice. Consider how much of the existing Laravel code and schema can be reused."
> "API parity: Every action available in the frontend must also be available through the backend API (OpenAPI documented), so the whole system can be operated from the backend as well."

### Evaluated Options:

1. **Option A: Cleaned & Modernized Laravel 11/12 Admin & Sync API (Recommended)**
   - **Schema Reuse:** 100% direct reuse of the existing 74-table relational database schema (`accounts`, `invoices`, `products`, `product_batches`, `purchase_documents`, `stock_events`, `stores`, etc.).
   - **Maturity:** Built-in Laravel Sanctum for token authentication, robust Eloquent ORM, queued jobs, automated database migrations, and battle-tested Indian accounting packages.
   - **Cloud Sync Compatibility:** Reuses the proven `/api/sync/*` batch endpoints while adding standard REST CRUD routes for 100% OpenAPI parity.
   - **Speed of Delivery:** Eliminates weeks of rewriting accounting, tax, and multi-tenant schema logic from scratch.

2. **Option B: Node.js / TypeScript (Fastify / NestJS + Prisma/Drizzle)**
   - **Pros:** Unified TypeScript codebase between frontend and backend.
   - **Cons:** High rewrite burden; requires re-implementing 74 tables, Eloquent relationships, seeders, sync ingestion watermarks, and Sanctum tokens.

3. **Option C: Rust (Axum + SQLx)**
   - **Pros:** Maximum raw throughput, tiny memory footprint.
   - **Cons:** Extremely high developer friction for complex business ERP with dozens of CRUD tables, dynamic tax reporting, and frequent regulatory changes.

## Decision
We select **Option A: Cleaned Modern Laravel 11/12 API** as the primary backend, augmented with a strict **OpenAPI 3.0 specification**:
- All legacy clutter, stubbed routes, and dead code are pruned.
- Full REST endpoints are provided for every master entity, stock adjustment, and customer account so external automation or web dashboards can operate the entire system headlessly.
- The desktop Tauri client communicates with this backend over HTTPS using clean, strongly typed API clients generated from the OpenAPI contract.
