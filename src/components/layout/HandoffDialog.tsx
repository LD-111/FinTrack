import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { toDataURL } from "qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinanceActions, useLedger, usePortfolio, useShell } from "@/context/FinanceContext";
import { describeHandoff, handoffSeed, handoffUrl, readHandoffBody, type HandoffPreview } from "@/lib/handoff";
import type { LedgerSnapshot } from "@/lib/excel";
import { isTauriRuntime } from "@/lib/shell";
import { toast } from "@/lib/toast";

interface HandoffSessionInfo {
  id: number;
  port: number;
  token: string;
  addresses: string[];
  loopbackOnly: boolean;
}

let handoffChain: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>) {
  const run = handoffChain.then(task, task);
  handoffChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function HandoffDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings } = useShell();
  const ledger = useLedger();
  const { valuationLogs } = usePortfolio();
  const { receiveHandoff } = useFinanceActions();
  const ledgerRef = useRef({ snapshot: emptySnapshot(ledger, valuationLogs), defaultAccountId: settings.defaultAccountId });
  ledgerRef.current = { snapshot: emptySnapshot(ledger, valuationLogs), defaultAccountId: settings.defaultAccountId };
  const receiveRef = useRef(receiveHandoff);
  receiveRef.current = receiveHandoff;
  const pendingSnapshot = useRef<LedgerSnapshot | null>(null);
  const busy = useRef(false);
  const onRequestRef = useRef<(raw: string) => Promise<void>>(async () => undefined);
  const [session, setSession] = useState<HandoffSessionInfo | null>(null);
  const [address, setAddress] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<HandoffPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      setSession(null);
      setQr(null);
      setIncoming(null);
      setSaving(false);
      setError(null);
      pendingSnapshot.current = null;
      busy.current = false;
      return;
    }
    dialogRef.current?.focus();
    const started: { id: number | null } = { id: null };
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void enqueue(async () => {
      if (cancelled) return;
      if (!isTauriRuntime()) {
        setError("Open the FinTrack desktop app to receive from a phone.");
        return;
      }
      try {
        const next = await invoke<HandoffSessionInfo>("start_handoff");
        if (cancelled) {
          await invoke("stop_handoff", { id: next.id });
          return;
        }
        started.id = next.id;
        unlisten = await listen<{ body: string }>("handoff-request", (event) => {
          void onRequestRef.current(event.payload.body);
        });
        if (cancelled) {
          unlisten();
          unlisten = undefined;
          await invoke("stop_handoff", { id: next.id });
          started.id = null;
          return;
        }
        setSession(next);
        setAddress(next.addresses[0] ?? "127.0.0.1");
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not listen for the phone.");
      }
    });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCloseRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener("keydown", onKeyDown);
      void enqueue(async () => {
        if (started.id === null) return;
        const id = started.id;
        started.id = null;
        await invoke("stop_handoff", { id }).catch(() => undefined);
      });
    };
  }, [open]);

  useEffect(() => {
    if (!session || !address) return;
    let cancel = false;
    void toDataURL(handoffUrl(address, session.port, session.token), { margin: 1, width: 240 }).then(
      (url) => {
        if (!cancel) setQr(url);
      },
      () => {
        if (!cancel) setQr(null);
      },
    );
    return () => {
      cancel = true;
    };
  }, [address, session]);

  async function onRequest(raw: string) {
    if (busy.current) {
      await finish(409, { ok: false, reason: "This computer is already confirming a transfer." });
      return;
    }
    busy.current = true;
    pendingSnapshot.current = null;
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        await finish(400, { ok: false, reason: "Could not read this ledger" });
        return;
      }
      const read = readHandoffBody(parsed);
      if (!read.ok) {
        await finish(400, { ok: false, reason: read.reason });
        return;
      }
      const { planSessionImport } = await import("@/lib/excel");
      const current = ledgerRef.current;
      const plan = planSessionImport(read.snapshot, current.snapshot, current.defaultAccountId);
      plan.issues.push(...read.issues);
      const seed = handoffSeed(current.snapshot, read.snapshot);
      const first = plan.issues[0];
      const issueNote = first
        ? `${first.row > 0 ? `${first.sheet} row ${first.row}: ` : ""}${first.reason}${plan.issues.length > 1 ? ` (${plan.issues.length} invalid)` : ""}`
        : null;
      const preview = describeHandoff({
        add: {
          accounts: plan.accounts.length,
          categories: plan.categories.length,
          transactions: plan.transactions.length,
          budgets: plan.budgets.length,
          valuations: plan.valuationLogs.length,
        },
        issueNote,
        seedAccounts: seed.accounts.length,
        seedCategories: seed.categories.length,
      });
      if (!preview.needsConfirm) {
        await finish(200, { ok: true, accounts: [], categories: [] });
        toast("Nothing new to import");
        return;
      }
      pendingSnapshot.current = read.snapshot;
      setIncoming(preview);
    } catch {
      await finish(400, { ok: false, reason: "Could not read this ledger" }).catch(() => undefined);
    } finally {
      if (!pendingSnapshot.current) busy.current = false;
    }
  }
  onRequestRef.current = onRequest;

  async function accept() {
    const snapshot = pendingSnapshot.current;
    if (!snapshot || saving) return;
    setSaving(true);
    try {
      const result = await receiveRef.current(snapshot);
      if (result.status === "failed") {
        await finish(500, { ok: false, reason: "Could not save the imported rows" });
        return;
      }
      try {
        await finish(200, { ok: true, accounts: result.accounts, categories: result.categories });
      } catch {
        toast("The phone disconnected. Send again if it did not update.");
      }
      if (result.status === "empty") {
        toast(incoming?.seedLabel ? `Sent ${incoming.seedLabel} to the phone` : "Nothing new to import");
      }
    } finally {
      pendingSnapshot.current = null;
      busy.current = false;
      setIncoming(null);
      setSaving(false);
    }
  }

  async function decline() {
    if (saving) return;
    await finish(409, { ok: false, reason: "The computer declined the transfer." }).catch(() => undefined);
    pendingSnapshot.current = null;
    busy.current = false;
    setIncoming(null);
  }

  if (!open) return null;

  const link = session && address ? handoffUrl(address, session.port, session.token) : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-handoff onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="handoff-title"
        tabIndex={-1}
        className="max-h-[min(40rem,calc(100vh-2rem))] w-full max-w-md overflow-auto rounded-xl border bg-card p-4 text-card-foreground shadow-lg outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="handoff-title" className="text-base font-semibold">
          From phone
        </h2>
        {error ? (
          <p className="mt-3 text-sm text-muted-foreground">{error}</p>
        ) : !session ? (
          <p className="mt-3 text-sm text-muted-foreground">Starting…</p>
        ) : incoming ? (
          <div className="mt-3">
            <p className="text-sm font-medium">{incoming.title}</p>
            {incoming.description && <p className="mt-2 text-sm text-muted-foreground">{incoming.description}</p>}
            <div className="mt-4 flex gap-2">
              <Button type="button" disabled={saving} onClick={() => void accept()}>
                Accept
              </Button>
              <Button type="button" variant="outline" disabled={saving} onClick={() => void decline()}>
                Decline
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-muted-foreground">
              Scan this from the phone, or type the address there. If Windows asks, allow FinTrack on private networks.
              Both devices need the same Wi-Fi. Export and Import still work when the network keeps devices apart.
            </p>
            {session.loopbackOnly && (
              <p className="mt-2 text-sm text-muted-foreground">
                This computer has no private network address, so a phone on Wi-Fi cannot connect. From the Android
                emulator, type 10.0.2.2 and this port.
              </p>
            )}
            {qr && <img src={qr} alt="Code for the phone to scan" className="mx-auto mt-4 h-60 w-60" />}
            {session.addresses.length > 1 && (
              <label className="mt-4 block text-xs text-muted-foreground">
                Network address
                <select
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-card-foreground"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                >
                  {session.addresses.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="mt-4 text-sm font-medium tabular-nums">
              {address}:{session.port}
            </p>
            <Input readOnly value={link} className="mt-3 font-mono text-xs" aria-label="Session address" onFocus={(event) => event.currentTarget.select()} />
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

async function finish(status: number, payload: { ok: true; accounts: unknown[]; categories: unknown[] } | { ok: false; reason: string }) {
  await invoke("complete_handoff", { status, body: JSON.stringify(payload) });
}

function emptySnapshot(
  ledger: { accounts: LedgerSnapshot["accounts"]; categories: LedgerSnapshot["categories"]; transactions: LedgerSnapshot["transactions"]; budgets: LedgerSnapshot["budgets"] },
  valuationLogs: LedgerSnapshot["valuationLogs"],
): LedgerSnapshot {
  return {
    accounts: ledger.accounts,
    categories: ledger.categories,
    transactions: ledger.transactions,
    budgets: ledger.budgets,
    valuationLogs,
  };
}
