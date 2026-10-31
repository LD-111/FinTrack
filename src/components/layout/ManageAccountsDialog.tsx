import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/context/FinanceContext";
import { formatAccountType, planAccountDeletion } from "@/lib/accounts";
import { formatMoney } from "@/lib/money";

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function ManageAccountsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    accounts,
    transactions,
    valuationLogs,
    settings,
    archiveAccount,
    unarchiveAccount,
    deleteAccount,
    accountById,
  } = useFinance();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setPendingId(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const active = accounts.filter((account) => !account.isArchived).sort((a, b) => a.name.localeCompare(b.name));
  const archived = accounts.filter((account) => account.isArchived).sort((a, b) => a.name.localeCompare(b.name));
  const lastActive = active.length <= 1;
  const pending = pendingId ? accounts.find((account) => account.id === pendingId) : undefined;
  const plan = pending ? planAccountDeletion(pending.id, transactions, valuationLogs) : null;
  const balanceLines =
    plan?.balanceDeltas
      .map((delta) => ({
        accountId: delta.accountId,
        name: accountById(delta.accountId)?.name ?? "Account",
        deltaCents: delta.deltaCents,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)) ?? [];

  async function confirmDelete() {
    if (!pending) return;
    const removed = await deleteAccount(pending.id);
    if (removed) setPendingId(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      data-account-manager
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-accounts-title"
        tabIndex={-1}
        className="max-h-[min(32rem,calc(100vh-2rem))] w-full max-w-md overflow-auto rounded-xl border bg-card p-4 text-card-foreground shadow-lg outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="manage-accounts-title" className="text-base font-semibold">
              {pending ? `Remove ${pending.name}` : "Manage accounts"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {pending
                ? "This removes the account and every row tied to it."
                : "Archive hides an account and keeps its history. Delete removes it and the transactions tied to it, including transfers."}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        {pending && plan ? (
          <div className="mt-4 space-y-3">
            <ul className="space-y-1 text-sm">
              <li>{pending.name} will be removed.</li>
              {plan.incomeExpenseCount > 0 && (
                <li>
                  {countLabel(plan.incomeExpenseCount, "transaction", "transactions")} on this account will be deleted.
                </li>
              )}
              {plan.transferCount > 0 && (
                <li>{countLabel(plan.transferCount, "transfer", "transfers")} will be deleted.</li>
              )}
              {plan.valuationIds.length > 0 && (
                <li>{countLabel(plan.valuationIds.length, "value log", "value logs")} will be deleted.</li>
              )}
              {plan.incomeExpenseCount === 0 && plan.transferCount === 0 && plan.valuationIds.length === 0 && (
                <li>Nothing else is tied to this account.</li>
              )}
            </ul>
            {plan.transferCount > 0 && (
              <div className="text-sm">
                {balanceLines.length === 0 ? (
                  <p>No other account balances change.</p>
                ) : (
                  <ul className="space-y-1">
                    {balanceLines.map((line) => (
                      <li key={line.accountId}>
                        {line.name} balance changes by{" "}
                        {formatMoney(line.deltaCents, settings.currency, settings.locale, "auto")}.
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">You can undo this once with Ctrl+Z.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPendingId(null)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" onClick={() => void confirmDelete()}>
                Delete account
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <section className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Active</p>
              {lastActive && <p className="text-xs text-muted-foreground">Keep at least one active account.</p>}
              {active.map((account) => (
                <div key={account.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{account.name}</p>
                    <p className="text-xs text-muted-foreground">{formatAccountType(account.type)}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={lastActive}
                    onClick={() => void archiveAccount(account.id)}
                  >
                    Archive
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={lastActive}
                    onClick={() => setPendingId(account.id)}
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </section>
            {archived.length > 0 && (
              <section className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Archived</p>
                {archived.map((account) => (
                  <div key={account.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{account.name}</p>
                      <p className="text-xs text-muted-foreground">{formatAccountType(account.type)}</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => void unarchiveAccount(account.id)}>
                      Restore
                    </Button>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
