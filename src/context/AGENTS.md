# context

`FinanceContext` is the only persistence gateway. Components call context methods; they do not import Dexie.

- Hydrate once on boot after `seedIfEmpty()`.
- Optimistic React state, then `db.*.put/delete`.
- `addTransactionFromQuickAdd` parses + categorizes + resolves `#account` + writes + merchant memory. Transfers skip merchant memory. Return `{ ok, reason }` — do not throw parse errors.
- Last successful account becomes `settings.defaultAccountId`.
- Account CRUD: `createAccount`, `updateAccount`, `archiveAccount`. Do not delete an account that has transactions; do not archive the last active account.
- `accountFilter` is shared so the sidebar can open Ledger on one account.
- Undo stack (cap 20) covers add/update/delete transaction and budget upserts.
- Derived month totals and account balances come from `src/lib/derived.ts`.
