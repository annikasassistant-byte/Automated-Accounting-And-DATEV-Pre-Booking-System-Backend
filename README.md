# Automated Accounting — Server

Express API (MongoDB, Redis, JWT) for German DATEV pre-booking (cash path) plus parallel **accrual** domain (JTL, marketplaces, business events, journal). Roles: `admin` | `user`.

## Quick start

```bash
cd server
cp .env.server.example .env
# Set MONGODB_URI, REDIS_URL, JWT_*, COOKIE_SECRET
# CSV uploads need text/csv in UPLOAD_ALLOWED_MIME

npm install
npm run seed
npm run dev
```

- API: http://localhost:5000/api/v1
- Health: `GET /api/v1/health` and `GET /api/v1/health/ready`
- Swagger: http://localhost:5000/api/docs

| Email | Password | Role |
|-------|----------|------|
| `admin@automatedaccounting.local` | `ChangeMeAdmin123!` | admin |
| `user@automatedaccounting.local` | `ChangeMeUser123!` | user |

Create/reset admin: `npm run create-admin` (optional `--email` / `--password` / `--force`).

---

## Coding structure

- **Health** — liveness / readiness
- **Auth** — register, login, refresh, logout, password reset, email verify
- **Users** — profile (`/users/me`), admin list/update/delete (`authorize(admin)`)
- **Accounting (cash)** — bank/PayPal import, transactions, rules, DATEV export, reconciliation
- **Accrual** — `POST /imports/jtl`, `POST /imports/marketplace/:channel`, `/accrual/*` (inbox, events, exceptions, clearing, journal), `/reconciliation/marketplace`

Thin controllers. Business logic in services. Persistence in repositories. Resolve deps via `container.*`. Use `asyncHandler` + `ApiError`. Admin writes: `authorize("admin")` on the **route**, not only in the UI.

```text
server/
├── src/
│   ├── server.ts              # Bootstrap: Mongo → Redis → workers → cron → HTTP → Socket.IO
│   ├── app.ts                 # Express: security middleware + routes
│   ├── di/container.ts        # Manual singleton DI
│   ├── routes/
│   │   ├── index.ts           # /api/v1, /api/v2
│   │   ├── v1/                # auth, users, accounts, imports, transactions, …
│   │   └── v2/                # health only
│   ├── controllers/v1/        # Thin HTTP handlers
│   ├── services/              # Auth + accounting/*
│   ├── repositories/          # Mongo access (base + accounting)
│   ├── models/                # User, tokens, audit + accounting/*
│   ├── helpers/accounting/    # parsers, rule-engine, policies, DATEV writer
│   ├── middlewares/           # auth, authorize, CSRF, upload, rate limit, errors
│   ├── validators/            # Auth/users (express-validator)
│   ├── config/                # env, db, redis, cors, helmet, swagger, multer
│   ├── sockets/               # JWT handshake, rooms user:{id} + role:admin
│   ├── cron/ jobs/ queues/    # Token purge, user purge, BullMQ
│   ├── data/skr03-accounts.ts # Chart of accounts seed
│   ├── scripts/               # seed, createAdmin, verifyAccounting, e2e
│   └── tests/                 # Jest unit + integration (+ accounting parsers)
├── fixtures/accounting/       # Sample Bank + PayPal CSVs (July)
├── docker/ Dockerfile
└── docker-compose.yml
```

Depth-style layers: routes → controllers → services → repositories → MongoDB. DI via `src/di/container.ts`.

Accrual services live in `src/services/accounting/accrual/`; models in `src/models/accrual/`. Cash `Transaction` path is unchanged.

| File | Role |
|------|------|
| `bank-parser.ts` | German bank CSV (semicolon, DE headers) |
| `paypal-parser.ts` | PayPal DE CSV; S1 exclude types, S2 Guthaben, S3 EUR |
| `system-policies.ts` | S5/S6 clearing, S9 marketplace park, S10/S11 park, S12 forbidden |
| `system-policy-defaults.ts` | Seeded Mongo singleton defaults |
| `rule-engine.ts` | Human rules: 0 → open, 1 → matched, ≥2 → conflict |
| `datev-writer.ts` | EXTF Buchungsstapel (700 / 21 / SKR 03) |
| `ledger-sides.ts` | Soll/Haben for overview + ledger |
| `csv.util.ts` | Parse, fingerprints, SHA-256, DE amounts |

Do not add express-validator to accounting routes unless asked (auth/users already use it).

---

## Implemented features

### Auth & users

| Area | Endpoints | Status |
|------|-----------|--------|
| Health | `GET /health`, `/health/live`, `/health/ready` | Implemented |
| Auth | `POST /auth/register`, `/login`, `/logout`, `/logout-all`, `/refresh`, `/forgot-password`, `/verify-otp`, `/reset-password`, `/verify-email`, `/resend-verification`, `/change-password` | Implemented |
| Profile | `GET/PATCH/DELETE /users/me`, avatar, notification prefs | Implemented |
| Admin users | `GET/POST /users`, `GET/PATCH/DELETE /users/:id`, `GET /users/export` | Implemented (`authorize(admin)`) |

JWT from `Authorization: Bearer` or `access_token` cookie. Redis blacklist. Inactive/locked accounts rejected.

Realtime rooms: `user:{id}`, `role:admin`. Events: `server:user_updated`, `server:force_logout`, `notification`.

Cron: expired refresh tokens (daily), soft-deleted user purge (weekly).

### Accounting domain

**Pipeline:** CSV import → file SHA dedupe + row fingerprint → system policies S1–S15 → human rules → open/conflict HITL → reviewed → DATEV EXTF + `ExportItem` lock → reconciliation.

Transaction statuses: `imported` → `suggested` \| `matched` \| `open` \| `conflict` → `reviewed` \| `skipped` → `exported`.

| Area | Endpoints | Notes |
|------|-----------|--------|
| Accounts | `GET/POST /accounts`, `PATCH /:id`, `POST /seed`, `POST /import-csv`, `GET /export-csv`, `GET /overview`, `GET /:number/ledger` | Seed/CRUD/CSV import = **admin** |
| Imports | `POST /imports/bank`, `/paypal`, `GET /imports`, `GET /:id`, `POST /:id/reprocess` | Any authenticated user |
| Transactions | `GET /`, `/open`, `/conflicts`, `GET /:id`, `POST /apply-rules`, `POST /:id/assign`, `/bulk-assign`, `POST /:id/status`, `/bulk-status`, `POST /:id/create-rule` | create-rule = **admin** |
| Rules | `GET/POST /rules`, `POST /test`, `POST /seed-optional`, `GET/PATCH/DELETE /:id`, `POST /:id/enable`, `/:id/disable` | Writes = **admin** |
| Suggestions | `GET /rule-suggestions`, `POST /:id/accept`, `POST /:id/reject` | Accept/reject = **admin** |
| Patterns | `POST /patterns/analyze` | **admin** |
| DATEV | `POST /exports/datev/preview`, `/validate`, `POST /exports/datev` (**admin**), `GET /exports`, `GET /:id/download` | Create locks rows |
| Reconciliation | `GET /reconciliation/summary`, `GET /paypal-balance/:importId` | Implemented |
| Marketplace recon | `GET /reconciliation/marketplace`, `POST /reconciliation/marketplace/match` | Payout ↔ bank/PayPal (clearing, not revenue) |
| Accrual imports | `POST /imports/jtl`, `POST /imports/marketplace/:channel?reportType=order\|financial\|auto` | BM auto-detects Order vs Financial |
| Accrual | `/accrual/*` inbox, events, exceptions, clearing, journal | Financial `sales`/`revenue` → SETTLEMENT (clearing); ORDER_CREATED ≠ Umsatz |
| Duplicates | `GET /duplicates`, `POST /:id/resolve` | merge / ignore / keep_both |
| Settings | `GET/PATCH /settings/company`, `/datev`, `GET/PATCH /system-policies`, `POST /system-policies/reset` | Writes = **admin** |
| Reports | `GET /reports/account-totals`, `/status-breakdown` | Implemented |

### System policies (admin-configurable Mongo singleton)

| ID | Behavior |
|----|----------|
| S1/S2 | PayPal exclude types + Guthaben integrity |
| S3 | EUR only |
| S5/S6 | Bank ↔ PayPal → clearing **1361** |
| S7/S8 | 0 rule match → open; ≥2 → conflict (never auto-pick) |
| S9 | Marketplace payouts stay open |
| S10/S11 | Commercial VAT / owner-related → park open |
| S12 | No LexOffice collectives **10001 / 70002** |
| S13/S14 | Duplicate fingerprint + export lock |
| S15 | Private inventory → **3220**, empty BU |

SKR03 seed includes **1201** bank, **1203** PayPal, **1361**, **3220**, **81971–81976**.

### Mongo models

**Auth:** `User`, `RefreshToken`, `AuditLog`  
**Accounting:** `Account`, `ImportBatch`, `Transaction`, `Rule`, `RuleSuggestion`, `ExportBatch`, `ExportItem`, `CompanySettings`, `SystemPolicy`, `DuplicateGroup`

Soft-delete + audit on most accounting models. Unique transaction `fingerprint` (partial index excluding deleted). Unique `ExportItem.transactionId` is the export lock.

### Scripts & tests

| Script | Purpose |
|--------|---------|
| `npm run dev` | Nodemon |
| `npm start` | `node dist/server.js` |
| `npm run build` | esbuild via `scripts/build.mjs` |
| `npm run seed` | Admin + demo user |
| `npm run create-admin` | Bootstrap admin |
| `npm test` | Jest (includes `accrual-parsers.test.ts`) |
| `npx tsx src/scripts/verifyAccounting.ts` | Parsers, rules, DATEV |
| `npx tsx src/scripts/e2eAcceptance.ts` | API E2E (expects `:5001`) |

Tests today: unit utils, health + auth integration, accounting parser/rule/export tests. Few full HTTP accounting tests.

### Not in this API (out of MVP)

Invoice OCR, live LexOffice booking, auto-email DATEV file to tax advisor.

---

## Production cookies (Vercel → Render)

```text
COOKIE_DOMAIN=
COOKIE_SAME_SITE=none
COOKIE_SECURE=true
FRONTEND_URL=https://your-frontend.vercel.app
CORS_ORIGIN=https://your-frontend.vercel.app
```

Never set `COOKIE_DOMAIN=production`. Never commit live Mongo/Redis/JWT values.

<!--
## Keeping this README current
##Cursor rule: ../.cursor/rules/update-readme-on-features.mdc
##When a backend feature or bug fix lands, update this file (and the root README Backend section) in the same change.
-->
