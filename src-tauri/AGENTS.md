# src-tauri

Tauri 2 shell only. Phase 1 does not add Rust commands for data — IndexedDB is in the WebView. Plugins are opener, os, dialog, and fs. Dialog and fs exist so the capture shell can save and open the workbook. Do not add a backup command.

Keep `tauri.conf.json` aligned with Vite:

- `devUrl`: `http://localhost:1420`
- `frontendDist`: `../dist`
- `beforeDevCommand` / `beforeBuildCommand`: `npm run dev` / `npm run build`
- Window: 1280×800, min 960×640, title FinTrack, identifier `com.fintrack.app`
- `tauri.android.conf.json` replaces that window with a title-only phone window so the 960×640 minimum stays on the desktop.

Android project: from WSL `Ubuntu-22.04`, `npm run tauri android init -- --ci` writes `gen/android` (gitignored with the rest of `gen`). `npm run tauri android build -- --debug --apk` writes the debug APK under `gen/android/app/build/outputs/apk/`. Set `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64`, `ANDROID_HOME=/usr/lib/android-sdk`, and `NDK_HOME=/usr/lib/android-sdk/ndk/26.1.10909125` in that distro. iOS init is macOS-only.

Capability `default` allows `os:default`, `dialog:default`, `fs:allow-read-file`, and `fs:allow-write-file`. The save and open dialogs add the chosen path to the fs scope for the session.

The Cargo package is `fintrack` and the library crate is `fintrack_lib`. The compiled binary is `FinTrack` (`FinTrack.exe` on Windows), set by `[[bin]].name` in `Cargo.toml`. Window title and identifier are FinTrack / `com.fintrack.app`. If you rename the crate, update `[package].name`, `[lib].name`, `[[bin]].name`, and `src/main.rs` together.

Do not add a backup command. Workbook bytes stay in the WebView; dialog and fs only move the xlsx the user picks.
