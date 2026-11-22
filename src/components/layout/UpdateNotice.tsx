import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { lookForAppUpdate, readAppVersion, type AppUpdate } from "@/lib/appUpdate";
import {
  readUpdatePreferences,
  updateNotice,
  writeChecksOnLaunch,
  writeSkippedVersion,
  type UpdateCheckResult,
  type UpdatePreferences,
} from "@/lib/updateOffer";

export function UpdateNotice({ ready }: { ready: boolean }) {
  const [preferences, setPreferences] = useState<UpdatePreferences>(() => readUpdatePreferences(window.localStorage));
  const [version, setVersion] = useState<string | null>(null);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [manual, setManual] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "checking" | "installing">("idle");
  const [installFailed, setInstallFailed] = useState(false);
  const pending = useRef<AppUpdate | null>(null);
  const phaseRef = useRef(phase);
  const request = useRef(0);
  const autoChecked = useRef(false);
  phaseRef.current = phase;

  const runCheck = useCallback(async (isManual: boolean) => {
    const id = ++request.current;
    setManual(isManual);
    setInstallFailed(false);
    if (isManual) setPhase("checking");
    const found = await lookForAppUpdate();
    if (id !== request.current) {
      await found.update?.close();
      return;
    }
    const previous = pending.current;
    pending.current = found.update;
    if (previous && previous !== found.update) await previous.close();
    setResult(found.result);
    setPhase("idle");
  }, []);

  useEffect(() => {
    void readAppVersion().then(setVersion);
  }, []);

  useEffect(() => {
    if (!ready || !preferences.checksOnLaunch || autoChecked.current) return;
    autoChecked.current = true;
    void runCheck(false);
  }, [preferences.checksOnLaunch, ready, runCheck]);

  useEffect(() => {
    return () => {
      if (phaseRef.current !== "installing") void pending.current?.close();
    };
  }, []);

  const notice = updateNotice({ result, preferences, dismissedVersion, manual });
  const offeredVersion = result?.status === "available" ? result.version : null;
  const busy = phase !== "idle";

  async function releasePending() {
    const current = pending.current;
    pending.current = null;
    await current?.close();
  }

  function rememberPreferences() {
    setPreferences(readUpdatePreferences(window.localStorage));
    setManual(false);
  }

  async function onLater() {
    if (offeredVersion) setDismissedVersion(offeredVersion);
    rememberPreferences();
    await releasePending();
  }

  async function onKeep() {
    if (!offeredVersion) return;
    writeSkippedVersion(window.localStorage, offeredVersion);
    setDismissedVersion(offeredVersion);
    rememberPreferences();
    await releasePending();
  }

  async function onStopChecks() {
    writeChecksOnLaunch(window.localStorage, false);
    rememberPreferences();
    await releasePending();
  }

  function onStartChecks() {
    writeChecksOnLaunch(window.localStorage, true);
    setPreferences(readUpdatePreferences(window.localStorage));
  }

  async function onUpdate() {
    const update = pending.current;
    if (!update) return;
    setInstallFailed(false);
    setPhase("installing");
    try {
      await update.install();
    } catch {
      setInstallFailed(true);
      setPhase("idle");
    }
  }

  return (
    <div className="mt-3 border-t border-sidebar-border pt-3" aria-live="polite">
      {phase === "checking" && manual && (
        <p className="text-[11px] text-sidebar-foreground/55">Checking for updates</p>
      )}
      {phase === "installing" && offeredVersion && (
        <p className="text-[11px] text-sidebar-foreground/70">Installing {offeredVersion}. FinTrack will restart.</p>
      )}
      {phase === "idle" && notice === "offer" && offeredVersion && (
        <div className="mb-2">
          <p className="text-xs text-sidebar-foreground/80">{offeredVersion} is available</p>
          <div className="mt-2 flex flex-col gap-1">
            <Button type="button" size="sm" className="w-full" onClick={() => void onUpdate()}>
              Update
            </Button>
            <Button
              type="button"
              variant="sidebar"
              size="sm"
              className="w-full border border-sidebar-border text-[11px]"
              onClick={() => void onLater()}
            >
              Later
            </Button>
            <Button
              type="button"
              variant="sidebar"
              size="sm"
              className="w-full border border-sidebar-border text-[11px]"
              onClick={() => void onKeep()}
            >
              Keep this version
            </Button>
            <button
              type="button"
              className="text-left text-[11px] text-sidebar-foreground/55 hover:text-sidebar-foreground"
              onClick={() => void onStopChecks()}
            >
              Don't check on launch
            </button>
          </div>
        </div>
      )}
      {phase === "idle" && notice === "up-to-date" && (
        <p className="mb-1 text-[11px] text-sidebar-foreground/55">You're up to date</p>
      )}
      {phase === "idle" && notice === "failed" && (
        <p className="mb-1 text-[11px] text-sidebar-foreground/55">Couldn't check for updates</p>
      )}
      {installFailed && <p className="mb-1 text-[11px] text-sidebar-foreground/70">Couldn't install the update</p>}
      <button
        type="button"
        className="text-left text-[11px] text-sidebar-foreground/55 hover:text-sidebar-foreground disabled:opacity-60"
        disabled={busy}
        onClick={() => void runCheck(true)}
      >
        {version ? `Version ${version}` : "Check for updates"}
      </button>
      {!preferences.checksOnLaunch && phase === "idle" && (
        <button
          type="button"
          className="mt-1 block text-left text-[11px] text-sidebar-foreground/55 hover:text-sidebar-foreground"
          onClick={onStartChecks}
        >
          Check on launch
        </button>
      )}
    </div>
  );
}
