import { useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { BudgetView } from "@/components/budgets/BudgetView";
import { QuickAddBar } from "@/components/transactions/QuickAddBar";
import { TransactionTable } from "@/components/transactions/TransactionTable";
import { useFinance } from "@/context/FinanceContext";

export default function App() {
  const { hydrated, view, setView, undo, focusQuickAdd } = useFinance();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const inField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undo();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        focusQuickAdd();
        return;
      }

      if (event.key === "/" && !inField) {
        event.preventDefault();
        focusQuickAdd();
        return;
      }

      if (!inField) {
        if (event.key === "1") setView("dashboard");
        if (event.key === "2") setView("transactions");
        if (event.key === "3") setView("budgets");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusQuickAdd, setView, undo]);

  if (!hydrated) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <img src="/fintrack_logo.png" alt="" className="size-16" />
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <QuickAddBar />
        {view === "dashboard" && <DashboardView />}
        {view === "transactions" && <TransactionTable />}
        {view === "budgets" && <BudgetView />}
      </main>
    </div>
  );
}
