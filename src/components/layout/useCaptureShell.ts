import { useEffect, useState } from "react";
import { isCaptureShell, isTauriRuntime, readNativePlatform } from "@/lib/shell";

export function useCaptureShell(): boolean | null {
  const dev = import.meta.env.DEV;
  const search = window.location.search;
  const tauri = isTauriRuntime();
  const [platform, setPlatform] = useState<string | null>(null);
  const [resolved, setResolved] = useState(!tauri);

  useEffect(() => {
    if (!tauri) return;
    let cancelled = false;
    void readNativePlatform().then((value) => {
      if (cancelled) return;
      setPlatform(value);
      setResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [tauri]);

  if (!resolved) return null;
  return isCaptureShell(platform, search, dev);
}
