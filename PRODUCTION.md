# Production branch — server (Render)

You are on **`production`**. Render deploys this branch to live.

## package.json

| Repo | File |
|------|------|
| **Server (this repo)** | [package.json](./package.json) |
| **Client** | [../client/package.json](../client/package.json) |

Build scripts used on deploy: `npm run build` → `npm run start` (see [package.json](./package.json)).

---

## Promote to live (run in **both** `server/` and `client/`)

Run the full block below **inside this repo**, then repeat the same commands in **`client/`**.

```bash
git checkout before_production
git pull origin dev
git add .
git commit -m "take code from dev branch"
git push origin before_production
git checkout production
git pull origin before_production
git add .
git commit -m "take code from before_production"
git push origin production
```

If Git reports **nothing to commit** after a pull, that is OK — continue.

---

## Before you promote (on `dev`)

```bash
npm install
npm run build
npm test
npx tsx src/scripts/verifyAccounting.ts
```

---

## More docs

- [deployment/PRODUCTION_BRANCH_PROMOTION.md](../deployment/PRODUCTION_BRANCH_PROMOTION.md)
- [deployment/ACCRUAL_DEPLOY_CHECKLIST.md](../deployment/ACCRUAL_DEPLOY_CHECKLIST.md)
