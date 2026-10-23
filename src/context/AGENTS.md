# context

`FinanceContext` is the only persistence gateway. Components call context methods; they do not import Dexie.

- Hydrate once on boot after `seedIfEmpty()`.
- Optimistic React state, then `db.*.put/delete`.
- `addTransactionFromQuickAdd` parses + categorizes + writes + merchant memory. Return `{ ok, reason }` — do not throw parse errors.
- Undo stack (cap 20) covers add/update/delete transaction and budget upserts.
- Derived month totals come from `src/lib/derived.ts`.
