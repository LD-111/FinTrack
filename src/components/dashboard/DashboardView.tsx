import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PortfolioPanel } from "@/components/dashboard/PortfolioPanel";
import { VisualInsights } from "@/components/dashboard/VisualInsights";
import { useFinanceActions, useLedger, useShell } from "@/context/FinanceContext";
import { formatAccountLabel, isPortfolioAccount } from "@/lib/accounts";
import { formatMonthLabel } from "@/lib/dates";
import { formatMoney, formatSignedMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export function DashboardView() {
  const { selectedMonth, settings, dashboardTab } = useShell();
  const { setDashboardTab } = useFinanceActions();
  const onPortfolio = dashboardTab === "portfolio";
  const monthLabel = formatMonthLabel(selectedMonth, settings.locale);

  return (
    <section className="flex-1 space-y-4 overflow-auto p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{onPortfolio ? "Portfolio" : monthLabel}</h1>
          <p className="text-sm text-muted-foreground">
            {onPortfolio
              ? "Market value versus money you put in. Log a total when prices move."
              : "In, out, and what is left. Add from the bar — no forms."}
          </p>
        </div>
        <div className="flex rounded-md border border-input p-0.5">
          <TabButton label="Cashflow" active={!onPortfolio} onClick={() => setDashboardTab("cashflow")} />
          <TabButton label="Portfolio" active={onPortfolio} onClick={() => setDashboardTab("portfolio")} />
        </div>
      </div>

      {onPortfolio ? <PortfolioPanel /> : <CashflowBody />}
    </section>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-sm px-3 py-1.5 text-sm",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function CashflowBody() {
  const { monthSummary, categorySpend, transactions, categoryById, accountById, accountBalances } = useLedger();
  const { settings } = useShell();
  const { setView, setAccountFilter, setDashboardTab, setSelectedPortfolioAccountId } = useFinanceActions();
  const recent = transactions.slice(0, 8);
  const trackedBudgets = categorySpend.filter((item) => item.budgetCents !== null);
  const visibleAccounts = accountBalances.filter((row) => !row.account.isArchived);
  const totalBalance = visibleAccounts.reduce((sum, row) => sum + row.balanceCents, 0);

  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard
          title="Income"
          value={formatMoney(monthSummary.incomeCents, settings.currency, settings.locale)}
          tone="income"
        />
        <StatCard
          title="Spent"
          value={formatMoney(monthSummary.expenseCents, settings.currency, settings.locale)}
          tone="expense"
        />
        <StatCard
          title="Net"
          value={formatMoney(monthSummary.netCents, settings.currency, settings.locale, "auto")}
          tone={monthSummary.netCents >= 0 ? "income" : "expense"}
        />
      </div>

      <VisualInsights />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Accounts</CardTitle>
            <span className="text-sm tabular-nums text-muted-foreground">
              {formatMoney(totalBalance, settings.currency, settings.locale, "auto")}
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            {visibleAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add an account from the sidebar.</p>
            ) : (
              visibleAccounts.map((row) => (
                <button
                  key={row.account.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 text-sm"
                  onClick={() => {
                    if (isPortfolioAccount(row.account)) {
                      setSelectedPortfolioAccountId(row.account.id);
                      setDashboardTab("portfolio");
                      return;
                    }
                    setAccountFilter(row.account.id);
                    setView("transactions");
                  }}
                >
                  <span className="truncate font-medium">{row.account.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatMoney(row.balanceCents, settings.currency, settings.locale, "auto")}
                  </span>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Budgets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {trackedBudgets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No monthly caps yet. Open{" "}
                <button type="button" className="underline" onClick={() => setView("budgets")}>
                  Budgets
                </button>{" "}
                and set Food to start.
              </p>
            ) : (
              trackedBudgets.map((item) => {
                const budget = item.budgetCents ?? 0;
                const ratio = budget === 0 ? 0 : (item.spentCents / budget) * 100;
                return (
                  <div key={item.category.id} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{item.category.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatMoney(item.spentCents, settings.currency, settings.locale)} /{" "}
                        {formatMoney(budget, settings.currency, settings.locale)}
                      </span>
                    </div>
                    <Progress value={ratio} indicatorClassName={ratio > 100 ? "bg-expense" : undefined} />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing logged this session. Try 12.50 Chipotle.</p>
            ) : (
              recent.map((transaction) => {
                const category = categoryById(transaction.categoryId);
                const subtitle =
                  transaction.kind === "transfer"
                    ? formatAccountLabel(transaction, accountById)
                    : (category?.name ?? "Uncategorized");
                return (
                  <div key={transaction.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{transaction.description}</p>
                      <p className="text-xs text-muted-foreground">{subtitle}</p>
                    </div>
                    <span
                      className={
                        transaction.kind === "expense"
                          ? "tabular-nums text-expense"
                          : transaction.kind === "income" || transaction.kind === "refund"
                            ? "tabular-nums text-income"
                            : "tabular-nums text-muted-foreground"
                      }
                    >
                      {formatSignedMoney(
                        transaction.amountCents,
                        transaction.kind,
                        settings.currency,
                        settings.locale,
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StatCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone: "income" | "expense";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={tone === "income" ? "text-2xl font-semibold text-income" : "text-2xl font-semibold text-expense"}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
