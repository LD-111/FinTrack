# context

`FinanceContext` is the only persistence gateway. Components call context methods; they do not import Dexie.

- Hydrate once on boot after `seedIfEmpty()`. A throw here leaves `hydrated` false (the splash stays up). Fast Refresh cannot update this file (`useFinance` export) — Vite reloads the page.
- Fixture writes to IndexedDB are invisible until reload; context does not live-subscribe to Dexie. Dashboard/Ledger only show the current `selectedMonth`.
- Optimistic React state, then `db.*.put/delete`.
- `addTransactionFromQuickAdd` parses + categorizes + resolves `#account` + writes + merchant memory. Transfers skip merchant memory. Return `{ ok, reason }` — do not throw parse errors.
- Last successful account becomes `settings.defaultAccountId`.
- Account CRUD: `createAccount`, `updateAccount`, `archiveAccount`, `unarchiveAccount`, `deleteAccount`. Archive and delete refuse the last active account. Delete removes the account, its income and expenses, transfers that touch it, and its valuation logs, then reassigns the default account when that account was the default. One undo entry restores the account, those rows, and the previous default account.
- Quick Add does not unarchive. If a `#token` misses every active account and matches exactly one archived account, the preview reason is `{name} is archived`.
- `accountFilter` is shared so the sidebar can open Ledger on one account.
- `dashboardTab` (`cashflow` | `portfolio`) and `selectedPortfolioAccountId` stay in context so the sidebar can open the Portfolio tab on a portfolio account.
- Valuation logs: `addValuationLog`, `deleteValuationLog`. Optimistic write, then Dexie. UI never imports `db`.
- Undo stack (cap 20) covers add/update/delete transaction, budget upserts, valuation add/delete, account deletion, and one entry per workbook import.
- `exportWorkbook` downloads the ledger workbook. `importWorkbook` inserts the planned rows in one Dexie transaction. The import undo removes only the accounts, categories, transactions, budgets, and valuations that import created.
- Derived month totals come from `src/lib/derived.ts`. Portfolio snapshots come from `src/lib/portfolio.ts`. Context overlays market value onto displayed `accountBalances` for portfolio accounts.
