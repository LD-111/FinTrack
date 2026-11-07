# src-tauri

Tauri 2 shell only. IndexedDB stays in the WebView. Plugins are opener, os, dialog, and fs. Dialog and fs exist so the capture shell can save and open the workbook. Do not add a backup command. `handoff.rs` is a session pipe, not a ledger store: while From phone is open it binds `0.0.0.0` on an ephemeral port, checks the one-time token, and emits the body to the WebView. The WebView plans and confirms the insert. `send_handoff` is the phone's HTTP client so the WebView does not post across origins. Commands are `start_handoff`, `stop_handoff`, `complete_handoff`, and `send_handoff`. The listener stops when the panel closes.

Keep `tauri.conf.json` aligned with Vite:

- `devUrl`: `http://localhost:1420`
- `frontendDist`: `../dist`
- `beforeDevCommand` / `beforeBuildCommand`: `npm run dev` / `npm run build`
- Window: 1280×800, min 960×640, title FinTrack, identifier `com.fintrack.app`
- `tauri.android.conf.json` replaces that window with a title-only phone window so the 960×640 minimum stays on the desktop.
- Windows MSI upgrades: `bundle.windows.wix.upgradeCode` is pinned and `allowDowngrades` is true. `npm run tauri build` on Windows writes gitignored `tauri.windows.conf.json` with the next `wix.version` (`0.1.N`) before the CLI starts, and records that count in gitignored `.msi-build` only after the build succeeds. The installed app is replaced and the WebView ledger is left in place. Do not hand-edit `version` for a test install.

Android project: from WSL `Ubuntu-22.04`, `npm run tauri android init -- --ci` writes `gen/android` (gitignored with the rest of `gen`). `npm run tauri android build -- --debug --apk` writes the debug APK under `gen/android/app/build/outputs/apk/`. Set `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64`, `ANDROID_HOME=/usr/lib/android-sdk`, and `NDK_HOME=/usr/lib/android-sdk/ndk/26.1.10909125` in that distro. iOS init is macOS-only. `npm run tauri android` and `npm run tauri ios` run `scripts/mobile-handoff.mjs` before and after the CLI. When `gen/` exists it adds `CAMERA`, `usesCleartextTraffic`, and the iOS camera and local-network usage strings (`NSAllowsLocalNetworking`) so the phone can scan the code and post to the computer over HTTP. The same script copies `icons/android` and `icons/ios` onto that project. Those folders are the FinTrack logo on the sidebar color (`#141e28`), inset so the adaptive mask keeps the hourglass. `android init` restores the Tauri mark, and `gen/` is gitignored, so the tracked folders are what the next android or ios command installs. Desktop icons in `icons/` stay the transparent logo. Do not run `tauri icon` with output `src-tauri/icons` while `gen/android` exists: that overwrites the desktop set and the generated project, and the next android command copies the tracked folders back.

Capability `default` allows `os:default`, `dialog:default`, `fs:allow-read-file`, `fs:allow-write-file`, and `allow-handoff` (`permissions/handoff.toml`). The save and open dialogs add the chosen path to the fs scope for the session.

The Cargo package is `fintrack` and the library crate is `fintrack_lib`. The compiled binary is `FinTrack` (`FinTrack.exe` on Windows), set by `[[bin]].name` in `Cargo.toml`. Window title and identifier are FinTrack / `com.fintrack.app`. If you rename the crate, update `[package].name`, `[lib].name`, `[[bin]].name`, and `src/main.rs` together.

Do not add a backup command. Workbook bytes stay in the WebView; dialog and fs only move the xlsx the user picks. The handoff socket only forwards one session body and the reply. Cloud sync stays out of scope. Same-Wi-Fi is required, including a network that allows clients to reach each other. Guest isolation and cellular data will fail; Export and Import are the fallback.
