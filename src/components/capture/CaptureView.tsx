import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { QuickAddBar } from "@/components/transactions/QuickAddBar";
import { useFinanceActions, useLedger, useShell } from "@/context/FinanceContext";
import { formatMonthLabel, todayISO } from "@/lib/dates";
import { compareTransactionsDesc } from "@/lib/derived";
import { formatMoney, formatSignedMoney } from "@/lib/money";
import { isNativeMobile } from "@/lib/shell";
import { toast } from "@/lib/toast";
import { DEFAULT_ACCOUNT_ID } from "@/lib/types";
import { cn } from "@/lib/utils";

const CAPTURE_READY_KEY = "fintrack-capture-ready";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(CAPTURE_READY_KEY) === "1";
  } catch {
    return false;
  }
}

export function CaptureView() {
  const { settings, selectedMonth } = useShell();
  const { accounts, transactions, monthSummary, categoryById, accountById } = useLedger();
  const { exportWorkbook, importWorkbook, undo } = useFinanceActions();
  const importRef = useRef<HTMLInputElement>(null);
  const [dismissed, setDismissed] = useState(readDismissed);

  const activeAccounts = accounts.filter((account) => !account.isArchived);
  const freshSeed =
    transactions.length === 0 && activeAccounts.length === 1 && activeAccounts[0]?.id === DEFAULT_ACCOUNT_ID;
  const showBanner = freshSeed && !dismissed;

  const today = todayISO();
  const todays = useMemo(
    () => transactions.filter((transaction) => transaction.date === today).sort(compareTransactionsDesc),
    [today, transactions],
  );

  function dismissBanner() {
    try {
      localStorage.setItem(CAPTURE_READY_KEY, "1");
    } catch {
      // The banner still closes for this visit.
    }
    setDismissed(true);
  }

  async function importLedger() {
    try {
      if (await isNativeMobile()) {
        const { pickWorkbookFile } = await import("@/lib/workbookFile");
        const bytes = await pickWorkbookFile();
        if (!bytes) return;
        await importWorkbook(bytes);
        return;
      }
      importRef.current?.click();
    } catch {
      toast("Could not open the workbook");
    }
  }

  return (
    <main className="capture-shell flex h-full min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <p className="text-base font-semibold">FinTrack</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => exportWorkbook()}>
            Export
          </Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void importLedger()}>
            Import
          </Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void undo()}>
            Undo
          </Button>
        </div>
      </header>
      {showBanner && (
        <div className="border-b bg-accent px-4 py-3 text-sm text-accent-foreground">
          <p>Import a desktop export before the first log, so account names match.</p>
          <div className="mt-3 flex gap-2">
            <Button type="button" className="min-h-11" onClick={() => void importLedger()}>
              Import
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={dismissBanner}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
      <QuickAddBar variant="capture" />
      <div className="grid shrink-0 grid-cols-2 gap-3 border-b px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">Spent</p>
          <p className="text-lg font-semibold">
            {formatMoney(monthSummary.expenseCents, settings.currency, settings.locale)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Income</p>
          <p className="text-lg font-semibold">
            {formatMoney(monthSummary.incomeCents, settings.currency, settings.locale)}
          </p>
        </div>
        <p className="col-span-2 text-xs text-muted-foreground">{formatMonthLabel(selectedMonth, settings.locale)}</p>
      </div>
      <section className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <h2 className="text-sm font-medium">Today</h2>
        {todays.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing logged today.</p>
        ) : (
          <ul className="mt-2">
            {todays.map((transaction) => {
              const category = categoryById(transaction.categoryId);
              const from = accountById(transaction.accountId)?.name ?? "Account";
              const accountLabel =
                transaction.kind === "transfer"
                  ? `${from} → ${transaction.toAccountId ? (accountById(transaction.toAccountId)?.name ?? "Account") : "Account"}`
                  : from;
              const detail =
                transaction.kind === "transfer" ? accountLabel : `${category?.name ?? "Uncategorized"} · ${accountLabel}`;
              return (
                <li key={transaction.id} className="flex items-start justify-between gap-3 border-b py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{transaction.description || "Transaction"}</p>
                    <p className="truncate text-xs text-muted-foreground">{detail}</p>
                  </div>
                  <p
                    className={cn(
                      "shrink-0 text-sm font-medium",
                      transaction.kind === "expense" && "text-expense",
                      (transaction.kind === "income" || transaction.kind === "refund") && "text-income",
                    )}
                  >
                    {formatSignedMoney(transaction.amountCents, transaction.kind, settings.currency, settings.locale)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <input
        ref={importRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void file.arrayBuffer().then((buffer) => importWorkbook(buffer));
        }}
      />
    </main>
  );
}
