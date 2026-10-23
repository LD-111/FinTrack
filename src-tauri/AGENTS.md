# src-tauri

Tauri 2 shell only. Phase 1 does not add Rust commands for data — IndexedDB is in the WebView.

Keep `tauri.conf.json` aligned with Vite:

- `devUrl`: `http://localhost:1420`
- `frontendDist`: `../dist`
- `beforeDevCommand` / `beforeBuildCommand`: `npm run dev` / `npm run build`
- Window: 1280×800, min 960×640, title FinTrack, identifier `com.fintrack.app`

The Cargo package is still `tauri-app` / `tauri_app_lib` (create-tauri-app default). The window title and identifier are FinTrack / `com.fintrack.app`. Do not rename the crate unless you update `Cargo.toml`, `[lib].name`, and `src/main.rs` together.

Do not add FS/backup commands unless that work is in scope.
