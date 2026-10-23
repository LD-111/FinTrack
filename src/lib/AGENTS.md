# lib

- `types.ts` — `Transaction`, `Category`, `Budget`, `MerchantMemory`, `AppSettings`. Amounts are cents.
- `db.ts` — Dexie v1 stores: categories, transactions, budgets, merchantMemory, settings. Bump the version when the schema changes.
- `seed.ts` — first-launch categories + USD/en-US settings. Stable ids such as `cat_food`, `cat_uncategorized`.
- `parser.ts` — `[+]amount [description] [@category] [date-hint]`. Accepts `12.50` and `12,50`.
- `categorizer.ts` — explicit `@token` → merchant memory → fuzzy → Uncategorized.
- `money.ts` / `dates.ts` — display and parse helpers. Dates stay local calendar dates.
- `toast.ts` — lightweight toast bus used by FinanceContext undo/delete.
