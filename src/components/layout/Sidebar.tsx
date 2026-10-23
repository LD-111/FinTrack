import { LayoutDashboard, List, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/context/FinanceContext";
import { formatMonthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AppView } from "@/lib/types";

const NAV: { view: AppView; label: string; shortcut: string; icon: typeof LayoutDashboard }[] = [
  { view: "dashboard", label: "Dashboard", shortcut: "1", icon: LayoutDashboard },
  { view: "transactions", label: "Ledger", shortcut: "2", icon: List },
  { view: "budgets", label: "Budgets", shortcut: "3", icon: Wallet },
];

export function Sidebar() {
  const { view, setView, monthSummary, selectedMonth, settings } = useFinance();
  const netPositive = monthSummary.netCents >= 0;

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="px-4 py-5">
        <p className="text-lg font-semibold tracking-tight">FinTrack</p>
        <p className="text-xs text-sidebar-foreground/60">Local ledger</p>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2">
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
