# components

- `layout/Sidebar.tsx` — view switch, account list + inline create, month net, keys 1/2/3
- `transactions/QuickAddBar.tsx` — always visible formula bar; never hide behind a modal
- `transactions/TransactionTable.tsx` — dense ledger, account + category filters, inline edit, delete + undo
- `dashboard/DashboardView.tsx` + `VisualInsights.tsx` — month stats, account balances, and Recharts
- `budgets/BudgetView.tsx` — monthly per-category caps; persist on Enter and blur (do not rely on unmount blur)
- `ui/` — shadcn-style primitives (button, input, table, tooltip, card, badge, progress). Toasts use `src/lib/toast.ts` + `ui/sonner.tsx`.

Keyboard: Enter commits Quick Add, Tab cycles category/account/date chips, Esc clears, `/` or Ctrl+K focuses the bar, Ctrl+Z undoes. `#account` targets an account; `500 #cash -> #savings` logs a transfer.
