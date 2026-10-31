import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { SplashScreen } from "@/components/layout/SplashScreen";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { BudgetView } from "@/components/budgets/BudgetView";
import { QuickAddBar } from "@/components/transactions/QuickAddBar";
import { TransactionTable } from "@/components/transactions/TransactionTable";
import { useFinance } from "@/context/FinanceContext";

const SPLASH_HOLD_MS = 900;
const SPLASH_EXIT_MS = 400;
const splashStartedAt = performance.now();

export default function App() {
  const { hydrated, view, setView, undo, focusQuickAdd } = useFinance();
  const [splash, setSplash] = useState<"hold" | "exit" | "gone">("hold");

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

      if (!inField && !document.querySelector("[data-account-manager]")) {
        if (event.key === "1") setView("dashboard");
        if (event.key === "2") setView("transactions");
        if (event.key === "3") setView("budgets");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusQuickAdd, setView, undo]);

  useEffect(() => {
    if (!hydrated || splash !== "hold") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSplash("gone");
      return;
    }
    const wait = Math.max(0, SPLASH_HOLD_MS - (performance.now() - splashStartedAt));
    const timer = window.setTimeout(() => setSplash("exit"), wait);
    return () => window.clearTimeout(timer);
  }, [hydrated, splash]);

  useEffect(() => {
    if (splash !== "exit") return;
    const timer = window.setTimeout(() => setSplash("gone"), SPLASH_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [splash]);

  return (
    <div className="relative h-full">
      <div className="flex h-full">
        {hydrated && (
          <>
            <Sidebar />
            <main className="flex min-w-0 flex-1 flex-col">
              <QuickAddBar />
              {view === "dashboard" && <DashboardView />}
              {view === "transactions" && <TransactionTable />}
              {view === "budgets" && <BudgetView />}
            </main>
          </>
        )}
      </div>
      {splash !== "gone" && (
        <SplashScreen exiting={splash === "exit"} onExited={() => setSplash("gone")} />
      )}
    </div>
  );
}
