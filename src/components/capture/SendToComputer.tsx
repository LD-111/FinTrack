import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinanceActions, useLedger, usePortfolio } from "@/context/FinanceContext";
import { parseHandoffTarget, readHandoffResult, type HandoffTarget } from "@/lib/handoff";
import { postHandoff } from "@/lib/handoffClient";
import { toast } from "@/lib/toast";

type Mode = "choose" | "scan" | "type" | "wait";

export function SendToComputer({ open, title, onClose }: { open: boolean; title: string; onClose: () => void }) {
  const { accounts, categories, transactions, budgets } = useLedger();
  const { valuationLogs } = usePortfolio();
  const { importLedgerSnapshot } = useFinanceActions();
  const openRef = useRef(open);
  openRef.current = open;
  const [mode, setMode] = useState<Mode>("choose");
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setMode("choose");
    setAddress("");
    setToken("");
    setError(null);
    setSending(false);
    dialogRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || sending) return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, sending]);

  async function send(target: HandoffTarget) {
    setSending(true);
    setError(null);
    setMode("wait");
    try {
      const response = await postHandoff(
        target,
        JSON.stringify({ accounts, categories, transactions, budgets, valuationLogs }),
      );
      const reply = readHandoffResult(response.status, response.body);
      if (!reply.ok) {
        if (openRef.current) {
          setError(reply.reason);
          setMode("type");
        }
        return;
      }
      const applied = await importLedgerSnapshot({
        accounts: reply.accounts,
        categories: reply.categories,
        transactions: [],
        budgets: [],
        valuationLogs: [],
      });
      if (applied.status === "failed") {
        if (openRef.current) {
          setError("Could not save the accounts from the computer.");
          setMode("type");
        }
        return;
      }
      if (applied.status === "empty") toast("The computer accepted this ledger.");
      if (openRef.current) onClose();
    } catch (err) {
      if (openRef.current) {
        setError(err instanceof Error ? err.message : "Could not reach the computer. Use Export and Import if this Wi-Fi blocks device-to-device traffic.");
        setMode("type");
      }
    } finally {
      if (openRef.current) setSending(false);
    }
  }

  function submitTyped() {
    const target = parseHandoffTarget(address, token);
    if (!target) {
      setError("Type the address from the computer, and the code if it is not already in the link.");
      return;
    }
    void send(target);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" data-handoff>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-computer-title"
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col outline-none"
      >
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <h2 id="send-computer-title" className="text-base font-semibold">
            {title}
          </h2>
          <Button type="button" variant="outline" className="min-h-11" disabled={sending} onClick={onClose}>
            Close
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {mode === "wait" ? (
            <p className="text-sm text-muted-foreground">Waiting for the computer to accept…</p>
          ) : mode === "scan" ? (
            <ScanCode
              onCode={(value) => {
                const target = parseHandoffTarget(value);
                if (!target) {
                  setAddress(value);
                  setError("That code is not a FinTrack session. Type the address instead.");
                  setMode("type");
                  return;
                }
                void send(target);
              }}
              onUnavailable={() => {
                setError("The camera is unavailable. Type the address shown on the computer.");
                setMode("type");
              }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                On the computer, choose From phone. Both devices need the same Wi-Fi. If the network keeps devices
                apart, use Export and Import.
              </p>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {mode === "choose" ? (
                <>
                  <Button type="button" className="min-h-11" onClick={() => setMode("scan")}>
                    Scan code
                  </Button>
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => setMode("type")}>
                    Type the address
                  </Button>
                </>
              ) : (
                <>
                  <label className="text-sm">
                    Address
                    <Input
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      placeholder="192.168.1.20:48721"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      className="mt-1 min-h-11"
                    />
                  </label>
                  <label className="text-sm">
                    Code
                    <Input
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder="From the computer, if it is not in the address"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      className="mt-1 min-h-11 font-mono"
                    />
                  </label>
                  <Button type="button" className="min-h-11" disabled={sending} onClick={submitTyped}>
                    Send
                  </Button>
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => setMode("scan")}>
                    Scan code
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScanCode({ onCode, onUnavailable }: { onCode: (value: string) => void; onUnavailable: () => void }) {
  const onCodeRef = useRef(onCode);
  const onUnavailableRef = useRef(onUnavailable);
  onCodeRef.current = onCode;
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    const holder: { scanner: import("html5-qrcode").Html5Qrcode | null } = { scanner: null };
    let cancelled = false;
    void (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode("handoff-camera", { verbose: false });
        holder.scanner = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 8, qrbox: { width: 220, height: 220 } },
          (text) => {
            if (cancelled) return;
            cancelled = true;
            void scanner.stop().catch(() => undefined);
            onCodeRef.current(text);
          },
          () => undefined,
        );
        if (cancelled) await scanner.stop().catch(() => undefined);
      } catch {
        if (!cancelled) onUnavailableRef.current();
      }
    })();
    return () => {
      cancelled = true;
      void holder.scanner?.stop().catch(() => undefined);
    };
  }, []);

  return <div id="handoff-camera" className="min-h-48 overflow-hidden rounded-lg bg-black" />;
}
