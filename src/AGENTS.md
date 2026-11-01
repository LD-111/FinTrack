# src

Vite + React SPA. `main.tsx` mounts providers. `App.tsx` is the desktop shell: sidebar + Quick Add + one active view. A splash covers the shell until IndexedDB has hydrated and a short minimum has elapsed, then fades out; a failed hydrate leaves the splash up.

- No file-based router. `view` lives in `FinanceContext`. Dashboard Cashflow | Portfolio is `dashboardTab`, not a fourth view. There is no `/ledger` URL — click the sidebar, or press `1` / `2` / `3` after Escape so Quick Add is not focused.
- Import with `@/` (see `vite.config.ts` and `tsconfig.json`). TypeScript 6 needs `ignoreDeprecations: "6.0"` while `baseUrl` remains.
- Global styles and design tokens: `index.css` (Tailwind v4 + CSS variables).
- Do not add Next.js APIs, Server Components, or `'use client'`.
- `src/test/fixtures.ts` builds ledger rows for Vitest. The app does not import it.
