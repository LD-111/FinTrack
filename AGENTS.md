# FinTrack

Local-first desktop personal finance app. Absolute simplicity: faster and easier than a spreadsheet.

## Stack

- Vite + React 19 + TypeScript (SPA). Not Next.js. No SSR meta-framework.
- Tauri 2 shell. WebView only — no Node server in production.
- Tailwind CSS v4 + shadcn-style primitives in `src/components/ui`
- Dexie (IndexedDB) for persistence
- Recharts for insights
- SheetJS (`xlsx`) for the ledger workbook
- Vitest for `npm test`
- npm

## Architecture

The packaged app is a static Vite `dist/` folder inside Tauri. All data lives in the WebView via IndexedDB. `FinanceContext` is the only persistence gateway. UI never imports `db` directly.

Navigation is React view state (`dashboard` | `transactions` | `budgets`), not a URL router. Dashboard has a Cashflow | Portfolio tab (`dashboardTab` in context).

Money is integer cents (`amountCents`, `openingBalanceCents`, `valueCents`). Account balances and portfolio metrics are derived, never stored. Transaction `date` and valuation `date` are local `YYYY-MM-DD`. Timestamps are ISO UTC.

Accounts are first-class (`bank` | `cash` | `savings` | `investment` | `crypto` | `stock`). `investment`, `crypto`, and `stock` are portfolio accounts. Transactions have `accountId`; transfers also have `toAccountId` and `kind: "transfer"`. Transfers do not count as income or spend. Manage accounts (under the sidebar list) archives an account, which hides it and keeps its history, or deletes it after a confirmation that lists removed transactions, transfers, and balance changes on the accounts that remain. At least one account stays active. The create-account name field suggests similar accounts so an archived one can be restored instead of copied.

Portfolio current value = latest valuation log + transfers after that log. Principal = opening + net transfers in − out. Profit = value − principal. Return % is time-weighted so new capital does not look like gain or loss. Sidebar shows market value for portfolio accounts.

## Run

- UI only: `npm run dev` (Vite on http://localhost:1420, `strictPort: true`)
- Desktop: `npm run tauri dev`
- Production frontend: `npm run build` → `dist/`
- Installer: `npm run tauri build` (binary `FinTrack.exe`)

## Testing

`npm test` runs the Vitest suite once. `npm run test:watch` reruns it while files change. Tests sit next to the modules they cover (`src/lib/*.test.ts`) plus `src/context/FinanceContext.test.tsx`. Shared row builders live in `src/test/fixtures.ts` and are not imported by the app.

The suite covers Quick Add parsing, refunds, transfers, balances, account matching and deletion plans, portfolio value and time-weighted return, and workbook import. The provider file creates accounts, commits Quick Add, logs valuations, archives and deletes, and undoes a transaction against `fake-indexeddb`. That database is in memory. It does not touch the Vite tab’s IndexedDB.

Keyboard behavior in the running UI stays manual. Exercise the app at http://localhost:1420. Vite will not start if 1420 is already taken — reuse that server instead of launching a second one.

IndexedDB database name is `fintrack`. It persists per browser profile (Vite tab, another Chrome profile, and the Tauri WebView are different databases). Leftover verification rows are normal: empty income, a negative Cash balance, or a "Verification Lunch" in Recent. `seedIfEmpty()` only runs when `categories` is empty, so a second visit never resets data. To start clean, delete the `fintrack` database and reload so Dexie and seed run again.

Do not create the Dexie schema yourself. Opening `indexedDB.open("fintrack", 3)` and adding stores by hand, then letting the app boot, throws `BulkError` during hydrate and leaves the splash up forever. Let the app open Dexie first.

Launch shows a splash (logo and “FinTrack” on the sidebar color) until hydrate and a short minimum (~1s), then fades into the shell. Quick Add is focused underneath, so it is ready when the dashboard appears. `prefers-reduced-motion` skips the animation and dismisses as soon as hydrate finishes.

To load fixture data: wait until the splash has faded and the sidebar is visible, write into the existing stores, then reload so `FinanceContext` rehydrates. Leave `categories` alone unless you are replacing known seed ids (`cat_food`, `cat_salary`, `cat_transfer`, `cat_uncategorized`, …). Clear leftover `accounts` / `transactions` / `budgets` / `valuationLogs` if you need a clean month. Dashboard and Ledger filter by `selectedMonth` (the current `YYYY-MM`); fixture `date` values outside that month do not appear in totals or the default list. Transfers need `kind: "transfer"`, `toAccountId`, and `categoryId: "cat_transfer"`.

There are no URL routes. You cannot open `/ledger`. Click the sidebar, or press `1` / `2` / `3` only after Quick Add is not focused — it is focused on launch, so Escape (or click away) first. `/` and Ctrl+K put focus back on the bar. Setting an input's DOM `value` does not update React state: Quick Add will show the text but no preview chips unless keystrokes go through `onChange` (or you call context).

`body` is `overflow: hidden`. The main pane scrolls, not the document, so a full-page screenshot misses Accounts / Budgets / Recent and the lower charts. Scroll that pane or use a tall viewport. Cashflow charts sit three-across only at `xl`. After switching to Cashflow or Portfolio, wait for `.recharts-surface` before asserting or capturing.

A throw during `seedIfEmpty()` or the initial Dexie reads leaves `hydrated` false, so the splash stays up. Edits to `FinanceContext` cannot Fast Refresh (`useFinance` export) and trigger a full reload — in-memory UI state does not survive.

## Conventions

- TypeScript strict. Functional React components.
- Path alias `@/` → `src/`
- Keyboard-first: Quick Add is always visible, focused on launch, commit on Enter. No modal to add a transaction.
- Parser grammar: `[+]amount [description] [@category] [#account] [date-hint]`
- Refunds: a leading `+` is money in. On Salary, Other income, Uncategorized, or no category it is income. On any other spending category it is a `refund`: the account goes up, that category's spent total and the month's spent figure go down, and income stays unchanged. Quick Add shows a Refund chip, including when the category chip is arrowed onto a spending category before Enter. The refund is dated when the money returns (`tomorrow`, `yesterday`, `last friday`), which is the month whose budget it credits. Changing the category in the ledger keeps the cash direction: money out stays an expense; money in becomes a refund or income to match the new category.
- Transfers: `amount [#from] -> [#to] [description] [date-hint]` or `transfer 500 from #checking to #savings`. `amount #from` with no description is a transfer before `->` is typed. A second `#to` sets the destination. Otherwise the destination is the most recent same-amount transfer out of that account, then the most recent, then the only other active account. Enter commits that suggestion. Tab to the account chip and arrows change the destination. A description word keeps it an expense. A leading `+` stays money in, not a transfer.
- `@` is category. `#` is account. Omit `#` to use `settings.defaultAccountId`.
- Optimistic writes, then Dexie `put`/`delete`. Undo stack cap 20.
- Workbook: sidebar Export and Import. File `fintrack-YYYY-MM-DD.xlsx` with sheets Accounts, Categories, Transactions, Budgets, Valuations. Import inserts rows and creates missing accounts or categories. Existing ids are left unchanged. One Ctrl+Z undoes that import.

## Out of Phase 1

Bank CSV import, cloud sync, auth, recurring transactions, Tauri FS backups, account detail page, per-account currency.

## AGENTS.md maintenance (required)

After any code change, update AGENTS.md files in the same change when the modification affects agent guidance: added/removed/renamed public modules or directories, schema or Dexie version changes, new conventions, stack/config changes, or new UX/keyboard contracts. Update the nearest nested file; also update root if the change is cross-cutting. Do not churn AGENTS.md for purely local implementation details. If you skip an update, state why in the reply.
