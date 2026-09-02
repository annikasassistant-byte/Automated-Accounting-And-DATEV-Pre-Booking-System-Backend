# Automated Accounting Server

Express API (MongoDB, Redis, JWT) for German DATEV pre-booking (cash path) plus parallel **accrual** domain (JTL, marketplaces, business events, journal). Roles: `admin` | `user`.

## Quick start

```bash
cd server
cp .env.example .env
# Set MONGODB_URI, REDIS_URL, JWT_*, COOKIE_SECRET

npm install
npm run seed          # admin + demo user
npm run dev
```

Health: `GET /api/v1/health`

## Seeded accounts

| Email | Password | Role |
|-------|----------|------|
| `admin@automatedaccounting.local` | `ChangeMeAdmin123!` | admin |
| `user@automatedaccounting.local` | `ChangeMeUser123!` | user |

Create/reset admin: `npm run create-admin` (or `--email` / `--password` / `--force`).

## API surface

Mounted under `/api/v1`:

- **Health** — liveness / readiness
- **Auth** — register, login, refresh, logout, password reset, email verify
- **Users** — profile (`/users/me`), admin list/update/delete (`authorize(admin)`)
- **Accounting (cash)** — bank/PayPal import, transactions, rules, DATEV export, reconciliation
- **Accrual** — `POST /imports/jtl`, `POST /imports/marketplace/:channel`, `/accrual/*` (inbox, events, exceptions, clearing, journal), `/reconciliation/marketplace`

Public register always assigns role `user`. JWT carries `role` and empty `permissions: []`.

## Architecture

Depth-style layers: routes → controllers → services → repositories → MongoDB. DI via `src/di/container.ts`.

Accrual services live in `src/services/accounting/accrual/`; models in `src/models/accrual/`. Cash `Transaction` path is unchanged.

Realtime: Socket.IO rooms `user:{id}` and `role:admin`. Events: `user_updated`, `force_logout`, `notification`.

Cron: expired refresh tokens (daily) and soft-deleted user purge (weekly).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Nodemon |
| `npm start` | `node dist/server.js` |
| `npm run seed` | Seed admin + demo user |
| `npm run create-admin` | Bootstrap admin |
| `npm test` | Jest (includes `accrual-parsers.test.ts`) |

See `.env.example` for full configuration.
