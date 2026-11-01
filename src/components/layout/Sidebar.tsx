import { useRef, useState } from "react";
import { LayoutDashboard, List, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ManageAccountsDialog } from "@/components/layout/ManageAccountsDialog";
import { useFinance } from "@/context/FinanceContext";
import { isPortfolioAccount, matchAccountsByName } from "@/lib/accounts";
import { formatMonthLabel } from "@/lib/dates";
import { formatMoney, parseAmountToken } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Account, AccountType, AppView } from "@/lib/types";

const NAV: { view: AppView; label: string; shortcut: string; icon: typeof LayoutDashboard }[] = [
  { view: "dashboard", label: "Dashboard", shortcut: "1", icon: LayoutDashboard },
  { view: "transactions", label: "Ledger", shortcut: "2", icon: List },
  { view: "budgets", label: "Budgets", shortcut: "3", icon: Wallet },
];

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "bank", label: "Bank" },
  { value: "cash", label: "Cash" },
  { value: "savings", label: "Savings" },
  { value: "investment", label: "Investment" },
  { value: "crypto", label: "Crypto" },
  { value: "stock", label: "Stock" },
];

export function Sidebar() {
  const {
    view,
    setView,
    monthSummary,
    selectedMonth,
    settings,
    accountBalances,
    accountFilter,
    setAccountFilter,
    dashboardTab,
    setDashboardTab,
    selectedPortfolioAccountId,
    setSelectedPortfolioAccountId,
    accounts,
    createAccount,
    unarchiveAccount,
    exportWorkbook,
    importWorkbook,
  } = useFinance();
  const netPositive = monthSummary.netCents >= 0;
  const importRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("bank");
  const [opening, setOpening] = useState("");

  const visibleBalances = accountBalances.filter((row) => !row.account.isArchived);

  const nameHits = matchAccountsByName(name, accounts);
  const suggestions = nameHits.slice(0, 4);
  const exactActive = nameHits.filter((hit) => hit.rank === "exact" && !hit.account.isArchived);
  const exactArchived = nameHits.filter((hit) => hit.rank === "exact" && hit.account.isArchived);
  const restoreTarget = exactActive.length === 0 && exactArchived.length === 1 ? exactArchived[0].account : null;
  const blockedByActive = exactActive.length > 0;

  function resetCreateForm() {
    setName("");
    setType("bank");
    setOpening("");
    setCreating(false);
  }

  function openAccount(account: Account) {
    if (isPortfolioAccount(account)) {
      setSelectedPortfolioAccountId(account.id);
      setDashboardTab("portfolio");
      setView("dashboard");
      return;
    }
    setAccountFilter(account.id);
    setView("transactions");
  }

  async function restoreAccount(id: string) {
    await unarchiveAccount(id);
    resetCreateForm();
  }

  async function submitAccount(force: boolean) {
    if (!force && restoreTarget) {
      await restoreAccount(restoreTarget.id);
      return;
    }
    if (!force && blockedByActive) return;
    const created = await createAccount({
      name,
      type,
      openingBalanceCents: parseAmountToken(opening) ?? 0,
    });
    if (!created) return;
    resetCreateForm();
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-4 py-5">
        <img src="/fintrack_logo.png" alt="" className="size-9 shrink-0" />
        <div>
          <p className="text-lg font-semibold tracking-tight">FinTrack</p>
          <p className="text-xs text-sidebar-foreground/60">Local ledger</p>
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.view;
          return (
            <Button
              key={item.view}
              variant="sidebar"
              className={cn("w-full justify-start", active && "bg-sidebar-accent text-sidebar-accent-foreground")}
              onClick={() => setView(item.view)}
            >
              <Icon />
              <span className="flex-1 text-left">{item.label}</span>
              <kbd className="text-[10px] text-sidebar-foreground/45">{item.shortcut}</kbd>
            </Button>
          );
        })}
      </nav>

      <div className="mt-4 min-h-0 flex-1 overflow-auto px-2">
        <div className="mb-1 flex items-center justify-between px-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/45">Accounts</p>
          <Button
            variant="sidebar"
            size="icon"
            className="size-6"
            aria-label="Add account"
            onClick={() => setCreating((current) => !current)}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>

        {creating && (
          <form
            className="mb-2 space-y-2 rounded-md bg-sidebar-accent/50 p-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submitAccount(!blockedByActive && exactArchived.length > 0 && !restoreTarget);
            }}
          >
            <Input
              value={name}
              autoFocus
              placeholder="Name"
              className="h-8 bg-background/10 text-sidebar-foreground placeholder:text-sidebar-foreground/40"
              onChange={(event) => setName(event.target.value)}
            />
            {suggestions.length > 0 && (
              <ul className="space-y-0.5">
                {suggestions.map(({ account }) => (
                  <li key={account.id} className="flex items-center gap-1 rounded px-1 py-0.5">
                    {account.isArchived ? (
                      <>
                        <span className="min-w-0 flex-1 truncate text-xs">{account.name}</span>
                        <span className="shrink-0 text-[10px] text-sidebar-foreground/50">Archived</span>
                        <Button
                          type="button"
                          variant="sidebar"
                          size="sm"
                          className="h-6 px-1.5 text-[10px]"
                          onClick={() => void restoreAccount(account.id)}
                        >
                          Restore
                        </Button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs hover:underline"
                        onClick={() => {
                          openAccount(account);
                          resetCreateForm();
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">{account.name}</span>
                        <span className="shrink-0 text-[10px] text-sidebar-foreground/50">In use</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <select
              value={type}
              aria-label="Account type"
              className="h-8 w-full rounded-md border border-input bg-background/10 px-2 text-xs text-sidebar-foreground"
              onChange={(event) => setType(event.target.value as AccountType)}
            >
              {ACCOUNT_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <Input
              value={opening}
              placeholder="Opening 0.00"
              className="h-8 bg-background/10 text-sidebar-foreground placeholder:text-sidebar-foreground/40"
              onChange={(event) => setOpening(event.target.value)}
            />
            {restoreTarget ? (
              <div className="space-y-1">
                <Button type="submit" size="sm" className="w-full">
                  Restore
                </Button>
                <Button
                  type="button"
                  variant="sidebar"
                  size="sm"
                  className="w-full text-[11px]"
                  onClick={() => void submitAccount(true)}
                >
                  Create a new one anyway
                </Button>
              </div>
            ) : (
              <Button type="submit" size="sm" className="w-full" disabled={blockedByActive || !name.trim()}>
                {exactArchived.length > 0 ? "Create a new one anyway" : "Add"}
              </Button>
            )}
          </form>
        )}

        <div className="flex flex-col gap-0.5">
          {visibleBalances.map((row) => {
            const portfolio = isPortfolioAccount(row.account);
            const active = portfolio
              ? (view === "dashboard" && dashboardTab === "portfolio" && selectedPortfolioAccountId === row.account.id) ||
                (view === "transactions" && accountFilter === row.account.id)
              : accountFilter === row.account.id;
            return (
              <button
                key={row.account.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-sidebar-accent",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
                onClick={() => openAccount(row.account)}
              >
                <span className="min-w-0 flex-1 truncate">{row.account.name}</span>
                <span className="tabular-nums text-sidebar-foreground/70">
                  {formatMoney(row.balanceCents, settings.currency, settings.locale, "auto")}
                </span>
              </button>
            );
          })}
        </div>
        <Button
          type="button"
          variant="sidebar"
          size="sm"
          className="mt-2 w-full justify-start px-2 text-[11px] text-sidebar-foreground/55"
          onClick={() => setManaging(true)}
        >
          Manage accounts
        </Button>
      </div>
      <ManageAccountsDialog open={managing} onClose={() => setManaging(false)} />

      <div className="flex gap-2 border-t border-sidebar-border px-3 py-3">
        <Button
          type="button"
          variant="sidebar"
          size="sm"
          className="flex-1 border border-sidebar-border text-xs"
          onClick={() => exportWorkbook()}
        >
          Export
        </Button>
        <Button
          type="button"
          variant="sidebar"
          size="sm"
          className="flex-1 border border-sidebar-border text-xs"
          onClick={() => importRef.current?.click()}
        >
          Import
        </Button>
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
      </div>

      <div className="border-t border-sidebar-border px-4 py-4">
        <p className="text-xs text-sidebar-foreground/55">
          {formatMonthLabel(selectedMonth, settings.locale)}
        </p>
        <p className={cn("mt-1 text-xl font-semibold", netPositive ? "text-emerald-300" : "text-rose-300")}>
          {formatMoney(monthSummary.netCents, settings.currency, settings.locale, "auto")}
        </p>
        <p className="text-xs text-sidebar-foreground/50">This month net</p>
      </div>
    </aside>
  );
}
