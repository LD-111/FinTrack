import type { UpdateCheckResult } from "@/lib/updateOffer";
import { isTauriRuntime } from "@/lib/shell";

export function canCheckForUpdates(): boolean {
  return isTauriRuntime() && import.meta.env.PROD;
}

export type AppUpdate = {
  version: string;
  install: () => Promise<void>;
  close: () => Promise<void>;
};

export async function readAppVersion(): Promise<string | null> {
  if (!canCheckForUpdates()) return null;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return null;
  }
}

export async function lookForAppUpdate(): Promise<{ result: UpdateCheckResult; update: AppUpdate | null }> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const found = await check();
    if (!found) return { result: { status: "up-to-date" }, update: null };
    return {
      result: { status: "available", version: found.version },
      update: {
        version: found.version,
        install: async () => {
          await found.downloadAndInstall();
          const { platform } = await import("@tauri-apps/plugin-os");
          if (platform() === "windows") return;
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        },
        close: () => found.close(),
      },
    };
  } catch {
    return { result: { status: "failed" }, update: null };
  }
}
