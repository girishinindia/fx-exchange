# FX Desk — Wholesale Currency Desk (multi-company)

Private portal **and mobile API** in one Next.js project, for Genius ITens clients:
**Company → Admin → Users**. Supabase **Postgres only** (schema `ex`) · Upstash Redis.

The business it runs, in one line: **depositors** bring in the primary currency (USD),
the company **deals** it out to **clients** in the currency they ask for (EUR, CHF …) at a
manually agreed rate, bills the client in rupees at a second manual rate, collects those
rupees and **settles** the depositors with them. Every step is a voucher in a real
double-entry ledger, so the company, each depositor and each client all have a ledger and
a summary, and the CA has a trial balance that ties out.

> Status: **Phase 13 — the Super Admin tier** complete (Phases 0–12 before it). The desk runs end
> to end, corrections and the year end work, and companies are now opened from a console of their
> own rather than at a database prompt. The financial year is the Indian one, 1 April to 31 March.
> There is no TDS or GST handling, and none is planned.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router, Server Components, Server Actions, `proxy.ts`) · TypeScript strict |
| UI | Tailwind CSS 4 (light-blue "sky" theme) · Font Awesome 7 · own small UI kit in `src/components/ui` |
| Database | Supabase Postgres, schema `ex`, Row Level Security on every tenant table, audit log |
| DB driver | `postgres` (postgres.js) via the Supabase **transaction pooler** (port 6543) as role `ex_app_login` |
| Cache / sessions | Upstash Redis (`@upstash/redis`, `@upstash/ratelimit`) |
| Money | `decimal.js` in JS, `numeric` in Postgres — never floats |
| Hosting | Vercel, region `bom1` (Mumbai) |

No Supabase Auth, no Supabase Storage, no file uploads. Vouchers carry a reference number
(SWIFT / NEFT / cheque), never an attachment.

## Two halves, one repository

| | **The desk** | **The console** |
|---|---|---|
| Who | the client's own people | Genius ITens |
| Address | `fxdesk.<client>` | `admin.geniusitens.com` |
| Signs in with | email address **or** mobile number + password | the same |
| Database login | `ex_app_login` | `ex_platform_login` |
| Can | everything about its own company's trade | open a company, add and block its people |
| Cannot | add a person, open a company, see another company | read one voucher, balance or client, anywhere |
| Turned on by | `DATABASE_URL` | `DATABASE_PLATFORM_URL` |

They are one codebase deployed twice, with different environment variables. Where
`DATABASE_PLATFORM_URL` is not set the console's routes do not work at all — which is how the
desk's own deployment is meant to run, so that it never holds a credential capable of opening a
company. Neither half can do the other's job, and this is enforced by the database's own grants
rather than by application code.

**Nobody inside a company can create a user, not even its Administrator.** The permissions that
allowed it — `user.manage` and `role.manage` — no longer exist; `0013` deletes the codes, so
there is no box anywhere that could grant them back. What this buys is worth the inconvenience:
access to a company's books can only ever be widened by a third party, and `ex.platform_audit`
records every time it was, by whom.

**A company sets itself up.** It arrives with no dealing currency chosen. Its first Administrator
signs in, changes the password they were given, confirms their own name, then names the company
and picks the currency the desk deals in — which locks in the same statement that sets it. Until
that is done, no other screen opens. A company may have as many Administrators as it likes.

### The ledger in one paragraph

Every entry is a **voucher** with two or more **lines**. A line carries four numbers that never
separate: the **currency**, the **amount in that currency** (4 dp), the **manual rate** to the book
currency (6 dp) and the resulting **rupee value** (2 dp). The books balance on the rupee value; the
rate lives on the line and never in a master, because the same currency has a different rate for a
different client on the same day. A posted voucher is never edited or deleted — a correction is a
reversal. Rate rounding of up to ₹1 goes to the *Rounding Off* account; anything larger is refused.
`ex.fn_post_voucher(jsonb)` is the only write path into the ledger, and it checks permission, the
financial-year lock, Dr = Cr, the account's currency, that control accounts name a party of the right
kind, and that no cash or bank account goes negative in any currency.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in the values (see below)
npm run dev                  # http://localhost:3000
```

`FX_PREVIEW=1` shows the portal shell without logging in (development only; never works in production).

### Local Redis without Upstash (optional)

`scripts/local-upstash.py` is a small stand-in for the Upstash REST API on top of a local `redis-server`
(needs `pip install redis`). Run it and set `UPSTASH_REDIS_REST_URL=http://127.0.0.1:8079`,
`UPSTASH_REDIS_REST_TOKEN=local-dev-token`. For development and tests only.

### Environment variables

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Supabase → **Connect** → *Transaction pooler*. Use user `ex_app_login.<project-ref>` and the `ex_app_login` password: `postgresql://ex_app_login.<project-ref>:<password>@<pooler-host>:6543/postgres` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash console → create a Redis database in **ap-south-1 (Mumbai)** → REST API |
| `SESSION_COOKIE_NAME` | default `fx_sid` |
| `APP_URL` | public URL of the portal |
| `FX_PREVIEW` | `1` only for local UI preview |
| `DATABASE_ADMIN_URL` | only for `npm run test:db` — admin connection, never on Vercel |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` / `npm start` | production build / run |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint (includes the tenant-safety rule below) |
| `npm test` | unit tests (money maths, formatting, CSV and CSP safety) |
| `npm run test:db` | database tests: tenant-leak suite, the worked ledger example, posting guards, gapless numbering, backup (all rolled back) |
| `npm run test:redis` | session tests against Redis (Upstash, or `scripts/local-upstash.py`) |
| `npm run check` | typecheck + lint + unit tests |
| `npm run backup:verify -- <zip>` | check a company backup ZIP (files + SHA-256) |
| `npm run backup:restore -- <zip> --db … --admin-email … --admin-password …` | restore a backup into an empty database (dry run unless `--commit`) — see docs/RESTORE.md |
| `npm run load:seed -- --db …` | 100,000-transaction load-test company (local only) — see docs/PERFORMANCE.md |

## Rules every developer must follow

1. **All database access goes through `withTenant(ctx, tx => …)` in `src/lib/db.ts`.**
   It opens a transaction and sets `app.company_id`, `app.user_id`, `app.client_ip`, `app.context`.
   RLS and the audit trigger depend on these. ESLint blocks importing `postgres` anywhere else.
2. **The company id comes only from the session** (`requireSession()` → `tenantOf(session)`),
   never from a form field, URL, query string or header.
3. `withSystem()` is only for global tables (`ex.currency_master`, `ex.permission`) and the login lookup.
4. **Money logic lives in Postgres functions.** `ex.fn_post_voucher` is the only way into the
   ledger; JS only previews numbers with `src/lib/money.ts`.
   Nothing may `INSERT`/`UPDATE`/`DELETE` `ex.voucher` or `ex.voucher_line` — the grant is revoked
   from `ex_app` and a trigger blocks it besides.
5. **Every Redis key includes the company id** — use `keys.*` from `src/lib/redis.ts`.
6. Every protected page/layout/server action starts with `requireSession()` (or `requireAdmin()`).
   `src/proxy.ts` is only an optimistic cookie check.
7. Secrets never use the `NEXT_PUBLIC_` prefix.
8. **Business rules live in `src/server/services/*`, not in a page or a route handler.**
   The portal's server actions and `/api/v1` both call the same service, so a rule is written once.
   A service takes the session as its first argument and passes it to `assertPermission(p, s)` —
   an API request carries a bearer token, not a cookie.

## Project layout

```
src/
  app/
    login/                sign-in (rate limit, lockout, forced password change)
    change-password/      first-login / voluntary password change
    (portal)/             everything behind login: layout = sidebar + topbar
      dashboard/          liquidity first: what we owe, what we are owed, what we hold
      opening/            the opening balance voucher — posted once, then locked
      parties/            depositors & clients, each with its ledger and balances
      accounts/           chart of accounts
      vouchers/           the voucher register, one voucher, and the line-by-line entry form
      reports/            trial balance, currency position, party balances, registers, journal
      search/             one box across parties, accounts and vouchers
      admin/users|roles|audit|settings|currencies|backup|api
      profile/            my password, active sessions, login history
    api/v1/               the mobile API (see docs/API.md) — same services as the portal
    api/health|backup|export/[report]
    actions/              server actions (thin: validate the form, call a service)
  server/services/        the business layer: ledger, parties, accounts, auth
  components/ui/          Card, Button, Badge, Kpi, Field, SelectField, Table, Note, EmptyState, Modal, Tabs
  components/layout/      Sidebar, Topbar
  lib/                    env, db, redis, session, permissions, password, ratelimit, action,
                          api, ledger, money, format, reports, backup, nav, company
  proxy.ts                optimistic auth gate (Next 16 name for middleware)
db/migrations/            0000_ex_schema.sql … 0008_ledger_core.sql
tests/                    unit + db + redis tests
```

## The statements

| Report | Answers |
|---|---|
| Trial balance | do the books agree? (the first page the CA opens) |
| Profit & loss | what did the desk earn and spend over the period |
| Balance sheet | what is held, what is owed, and the profit that ties the two together |
| Currency position | what is held in each currency, and at what carrying rate |
| Party balances · Client / Depositor summary | who owes what, on each track |
| **Ageing** | how long it has been outstanding — money received settles the oldest bill first |
| Client / Depositor statement | one party's account with a running balance after every line |
| Registers | deposits, deals, payouts, receipts, settlements, vouchers, the journal |

**Pack for the CA** (`/reports/ca-pack`) gathers eight of these in the order an accountant reads
them, shows the three checks that matter before anything is filed (books balance, profit for the
period, balance sheet square), prints as one document, and downloads as one workbook with a sheet
each — real numbers, not text, so the CA can total and filter them directly.

Ageing is FIFO-matched: a receipt settles the oldest bill first, and what is left is aged from the
bill it still belongs to. Netting a party's balance and dating it by the last entry — the usual
shortcut — would make a January debt read as current.

## The ledger tables

| Table | Holds |
|---|---|
| `ex.party` | depositors and clients (a firm can be both) |
| `ex.account` | chart of accounts — cash/bank per currency, control accounts, P&L heads |
| `ex.fy_period` | financial years; locked once the CA signs off |
| `ex.voucher_series` | gapless numbering per company / year / type — `GI/2026-27/DEP/00001` |
| `ex.voucher` / `ex.voucher_line` | the journal; immutable once posted |
| `ex.deposit` · `ex.deal` · `ex.deal_funding` | which deposit funded which deal, each slice at its own rate |

Two functions sit on top of `fn_post_voucher` for the depositor half of the cycle, so the entry is
right every time and the guards are in one place:

| Function | Posts | Refuses |
|---|---|---|
| `ex.fn_post_deposit(jsonb)` | Dr `CASH-<primary>` at the agreed rate · Cr `DEP-PAY` for that depositor | a currency other than the desk's, a party who is not an active depositor, a replayed `client_ref` (returns the first deposit instead) |
| `ex.fn_post_settlement(jsonb)` | Dr `DEP-PAY` for that depositor · Cr `CASH-<book>` | more than the books owe that depositor, and more rupees than the company actually holds |
| `ex.fn_post_deal(jsonb)` | Dr `CLIENT-REC` + `CASH-<deal currency>` · Cr `CLIENT-CUR-PAY` + one `CASH-<primary>` line per funding slice · Cr `FX-MARGIN` (or Dr `FX-LOSS`) | a currency the desk does not hold, the primary currency itself, a party who is not an active client, an allocation larger than a deposit has left, and an allocation that does not add up to what the deal spends |
| `ex.fn_post_payout(jsonb)` | Dr `CLIENT-CUR-PAY` at what the promise is carried at · Cr `CASH-<currency>` at what the currency is carried at · any difference to `FX-MARGIN` / `FX-LOSS` | more currency than the client is owed, a currency they are owed none of, and more than the company holds |
| `ex.fn_post_receipt(jsonb)` | Dr `CASH-<book>` · Cr `CLIENT-REC` | more than the client owes, unless `allow_advance` says the advance is intended |
| `ex.fn_reverse_voucher(id, reason)` | the same lines with debit and credit swapped, at the same rates, as a `REVERSAL` that points at the original and back | a blank reason, a voucher already reversed, reversing a reversal, a closed year, a deposit whose currency has already paid for a deal, and a deal whose currency has already gone out — each naming the voucher to reverse first |
| `ex.fn_revalue_currency(jsonb)` | currency held **and** currency owed to clients restated at the closing rate, the difference to `UNREAL-FX` | a rate for the book currency, and a missing or non-positive rate |
| `ex.fn_lock_fy(id, note)` / `ex.fn_unlock_fy(id, reason)` | closes a year once the CA has signed off; reopens it with the reason kept on the record | closing a year whose trial balance does not agree, and reopening without a reason |

**A client has two debts and they are never netted.** A deal bills them in rupees *and* promises
them currency; those are settled separately, in parts, and the client's statement shows each track
with its own running balance. A receipt for more than is owed becomes a visible advance — a credit
on their ledger — rather than a silent negative.

**A deal is allocated, never averaged.** The primary currency it spends came in on particular
deposits at particular rates, so the deal takes it slice by slice — oldest deposit first unless the
desk says otherwise — and each slice leaves the books at the rate that deposit actually cost. The
margin is then `billed − real cost`, and `ex.deal_funding` shows exactly which deposit paid for
which deal. A deal sold below cost posts an exchange loss; it is recorded, never blocked.

`ex.v_deposit_status` shows how much of each deposit is still unspent (deals draw on it in Phase 9);
`ex.v_depositor_summary` shows what each depositor brought in, what has been paid back and what is
still owed — the outstanding figure comes from the control account, so an opening balance counts too.

Voucher types: `OPENING`, `DEPOSIT`, `DEAL`, `PAYOUT`, `RECEIPT`, `SETTLEMENT`, `EXPENSE`,
`JOURNAL`, `REVERSAL`, `REVALUATION`.

**A reversal cancels by entry, not by exclusion.** Nothing is ever edited or deleted: the mirror is
posted and the two vouchers point at each other, and both stay in every balance, because together
they come to nothing. Leaving the original out while counting its mirror would apply the reversal
twice — the client would appear to be owed EUR 14,200 where EUR 9,200 is right. `status` marks a
voucher cancelled for the reader; it never hides its arithmetic. Only *counts of documents* — how
many deposits, how many deals, what a deal may still spend — skip a reversed voucher, because a
reversed deposit is no longer a deposit.

**The financial year is 1 April to 31 March**, for every company, enforced by a check constraint on
`ex.company`. It is not a setting, because the vouchers, the statements and the CA pack all have to
read the year the same way.

**Revaluation restates both sides.** Currency held and currency owed to clients move together, so a
matched position shows no gain — which is right, not a bug. Each restatement is a pair of lines on
the same account, out at the old rate and in at the new, so the currency nets to zero and only the
rupee value moves; the difference is an unrealised gain or loss until the money actually moves.

## Database

Migrations live in `db/migrations` and are applied to Supabase in order — **schema `ex` only**.
Applied on the development project: `0000_ex_schema` … `0013_platform` (all).
Company **GI — Genius ITens** exists with Admin Girish Chaudhary.

`0007_remove_counter.sql` deletes the retail counter module (exchange transactions, weighted-average
stock, the rate board, day close, the approval workflow). `0008_ledger_core.sql` creates the
double-entry ledger above. Both are safe to run on a database that still holds counter data:
existing customers become clients, and every existing company is given the new chart of accounts and
the new permissions.

- `ex_owner` owns everything · `ex_app` = app privileges (RLS applies) · `ex_app_login` = the login the desk uses
- `ex_platform` may execute the `ex.fn_platform_*` functions and nothing else — **no table grants at all** ·
  `ex_platform_login` = the login the console uses, and is not a member of `ex_app`
- `ex_security` (BYPASSRLS) owns only `fn_register_company` and `fn_auth_lookup`

## Documentation

| File | For |
|---|---|
| [docs/GO-LIVE.md](docs/GO-LIVE.md) | production setup, cut-over day, first week |
| [docs/UAT.md](docs/UAT.md) | acceptance test script with expected results and sign-off — the short version |
| `scripts/create-super-admin.mjs` | creates the first Super Admin; run once per installation |
| [docs/testing/](docs/testing/) | the long version: eleven printable books the client's own team works through, every figure proved against a real run |
| [docs/API.md](docs/API.md) | the mobile / integration API — tokens, endpoints, worked example |
| [docs/TRAINING.md](docs/TRAINING.md) | guide for desk staff and Admins |
| [docs/RESTORE.md](docs/RESTORE.md) | backup layers and restore runbook, monthly drill |
| [docs/SECURITY.md](docs/SECURITY.md) | every security control and the test that proves it |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | 100k-transaction load test, pool settings |

## Deploy (Vercel)

1. Push this repo to GitHub, import it in Vercel (framework: Next.js). `vercel.json` pins region `bom1`.
2. Add the environment variables for Production and Preview.
3. After deploy, open `/api/health` — both `db` and `redis` must be `ok: true`.
