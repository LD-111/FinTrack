# lib

- `types.ts` — `Account`, `Transaction`, `Category`, `Budget`, `MerchantMemory`, `AppSettings`, `ValuationLog`, `PortfolioSnapshot`. Amounts are cents. `AccountType` includes `investment` | `crypto` | `stock`. `Transaction.kind` is `expense` | `income` | `transfer`.
- `accounts.ts` — slug + `#token` matching (exact, then unique prefix), transfer labels, `isPortfolioAccount`.
- `db.ts` — Dexie v3 stores: accounts, categories, transactions, budgets, merchantMemory, settings, valuationLogs. Bump the version when the schema changes. v2 upgrade seeds Cash, backfills `accountId`, adds `cat_transfer`. v3 adds `valuationLogs`.
- `seed.ts` — first-launch categories + Cash account + USD/en-US settings. Stable ids such as `cat_food`, `cat_uncategorized`, `cat_transfer`, `acct_cash`.
- `parser.ts` — `[+]amount [description] [@category] [#account] [date-hint]`. Transfers: `amount #from -> #to` or `transfer 500 from #a to #b`. Accepts `12.50` and `12,50`.
- `categorizer.ts` — explicit `@token` → merchant memory → fuzzy → Uncategorized.
- `derived.ts` — month totals skip transfers. `accountBalances` = opening ± income/expense/transfers (book value).
- `portfolio.ts` — principal (opening + net transfers), current value (last log + later transfers), TWR, chart series. Do not store these on `Account`.
- `money.ts` / `dates.ts` — display and parse helpers. Dates stay local calendar dates. `formatSignedMoney` treats transfer as unsigned.
- `toast.ts` — lightweight toast bus used by FinanceContext undo/delete.
