# FinTrack

Local-first desktop personal finance app. Absolute simplicity: faster and easier than a spreadsheet.

## Stack

- Vite + React 19 + TypeScript (SPA). Not Next.js. No SSR meta-framework.
- Tauri 2 shell. WebView only — no Node server in production.
- Tailwind CSS v4 + shadcn-style primitives in `src/components/ui`
- Dexie (IndexedDB) for persistence
- Recharts for insights
- npm

## Architecture

The packaged app is a static Vite `dist/` folder inside Tauri. All data lives in the WebView via IndexedDB. `FinanceContext` is the only persistence gateway. UI never imports `db` directly.

Navigation is React view state (`dashboard` | `transactions` | `budgets`), not a URL router.

Money is integer cents (`amountCents`, `openingBalanceCents`). Account balances are derived, never stored. Transaction `date` is local `YYYY-MM-DD`. Timestamps are ISO UTC.

Accounts are first-class (`bank` | `cash` | `savings` | `investment`). Transactions have `accountId`; transfers also have `toAccountId` and `kind: "transfer"`. Transfers do not count as income or spend.

## Run

- UI only: `npm run dev` (Vite on http://localhost:1420)
- Desktop: `npm run tauri dev`
- Production frontend: `npm run build` → `dist/`
- Installer: `npm run tauri build`

## Conventions

- TypeScript strict. Functional React components.
- Path alias `@/` → `src/`
- Keyboard-first: Quick Add is always visible, focused on launch, commit on Enter. No modal to add a transaction.
- Parser grammar: `[+]amount [description] [@category] [#account] [date-hint]`
- Transfers: `amount [#from] -> [#to] [description] [date-hint]` or `transfer 500 from #checking to #savings`
- `@` is category. `#` is account. Omit `#` to use `settings.defaultAccountId`.
- Optimistic writes, then Dexie `put`/`delete`. Undo stack cap 20.

## Out of Phase 1

Bank CSV import, cloud sync, auth, recurring transactions, Tauri FS backups, product rename, account detail page, per-account currency.

## AGENTS.md maintenance (required)

After any code change, update AGENTS.md files in the same change when the modification affects agent guidance: added/removed/renamed public modules or directories, schema or Dexie version changes, new conventions, stack/config changes, or new UX/keyboard contracts. Update the nearest nested file; also update root if the change is cross-cutting. Do not churn AGENTS.md for purely local implementation details. If you skip an update, state why in the reply.
