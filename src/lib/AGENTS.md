# lib

- `types.ts` — `Account`, `Transaction`, `Category`, `Budget`, `MerchantMemory`, `AppSettings`. Amounts are cents. `Transaction.kind` is `expense` | `income` | `transfer`.
- `accounts.ts` — slug + `#token` matching (exact, then unique prefix) and transfer labels.
- `db.ts` — Dexie v2 stores: accounts, categories, transactions, budgets, merchantMemory, settings. Bump the version when the schema changes. v2 upgrade seeds Cash, backfills `accountId`, adds `cat_transfer`.
- `seed.ts` — first-launch categories + Cash account + USD/en-US settings. Stable ids such as `cat_food`, `cat_uncategorized`, `cat_transfer`, `acct_cash`.
- `parser.ts` — `[+]amount [description] [@category] [#account] [date-hint]`. Transfers: `amount #from -> #to` or `transfer 500 from #a to #b`. Accepts `12.50` and `12,50`.
- `categorizer.ts` — explicit `@token` → merchant memory → fuzzy → Uncategorized.
- `derived.ts` — month totals skip transfers. `accountBalances` = opening ± income/expense/transfers.
- `money.ts` / `dates.ts` — display and parse helpers. Dates stay local calendar dates. `formatSignedMoney` treats transfer as unsigned.
- `toast.ts` — lightweight toast bus used by FinanceContext undo/delete.
