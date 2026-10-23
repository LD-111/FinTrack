# components

- `layout/Sidebar.tsx` — view switch, account list + inline create (includes Crypto/Stock), month net, keys 1/2/3. Portfolio accounts open Dashboard → Portfolio; other accounts open Ledger.
- `transactions/QuickAddBar.tsx` — always visible formula bar; never hide behind a modal
- `transactions/TransactionTable.tsx` — dense ledger, account + category filters, inline edit, delete + undo
- `dashboard/DashboardView.tsx` + `VisualInsights.tsx` — Cashflow | Portfolio toggle. Cashflow: month stats, account balances, Recharts. Portfolio: `PortfolioPanel.tsx` (account chips, P/L, invested-vs-value chart, log value, history).
- `budgets/BudgetView.tsx` — monthly per-category caps; persist on Enter and blur (do not rely on unmount blur)
- `ui/` — shadcn-style primitives (button, input, table, tooltip, card, badge, progress). Toasts use `src/lib/toast.ts` + `ui/sonner.tsx`.

Keyboard: Enter commits Quick Add, Tab cycles category/account/date chips, Esc clears, `/` or Ctrl+K focuses the bar, Ctrl+Z undoes. `#account` targets an account; `500 #cash -> #savings` logs a transfer. Portfolio value log is a single input on the Portfolio tab (Enter / Log button).
