const CAPTURE_PLATFORMS = new Set(["android", "ios"]);

export function isCaptureShell(platform: string | null, search: string, dev: boolean): boolean {
  if (platform !== null && CAPTURE_PLATFORMS.has(platform)) return true;
  if (!dev) return false;
  const query = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(query).get("capture") === "1";
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function readNativePlatform(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { platform } = await import("@tauri-apps/plugin-os");
    return platform();
  } catch {
    return null;
  }
}

export async function isNativeMobile(): Promise<boolean> {
  const platform = await readNativePlatform();
  return platform === "android" || platform === "ios";
}
