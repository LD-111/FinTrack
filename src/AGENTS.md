# src

Vite + React SPA. `main.tsx` mounts providers. `App.tsx` is the desktop shell: sidebar + Quick Add + one active view.

- No file-based router. `view` lives in `FinanceContext`. Dashboard Cashflow | Portfolio is `dashboardTab`, not a fourth view.
- Import with `@/` (see `vite.config.ts` and `tsconfig.json`). TypeScript 6 needs `ignoreDeprecations: "6.0"` while `baseUrl` remains.
- Global styles and design tokens: `index.css` (Tailwind v4 + CSS variables).
- Do not add Next.js APIs, Server Components, or `'use client'`.
