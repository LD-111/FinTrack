import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { VisualInsights } from "@/components/dashboard/VisualInsights";
import { useFinance } from "@/context/FinanceContext";
import { formatMonthLabel } from "@/lib/dates";
import { formatMoney, formatSignedMoney } from "@/lib/money";

export function DashboardView() {
  const { monthSummary, categorySpend, transactions, settings, selectedMonth, categoryById, setView } =
    useFinance();
  const recent = transactions.slice(0, 8);
  const trackedBudgets = categorySpend.filter((item) => item.budgetCents !== null);
  const monthLabel = formatMonthLabel(selectedMonth, settings.locale);

  return (
    <section className="flex-1 space-y-4 overflow-auto p-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{monthLabel}</h1>
        <p className="text-sm text-muted-foreground">In, out, and what is left. Add from the bar — no forms.</p>
      </div>

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

      <div className="grid gap-4 lg:grid-cols-2">
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
                return (
                  <div key={transaction.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{transaction.description}</p>
                      <p className="text-xs text-muted-foreground">{category?.name ?? "Uncategorized"}</p>
                    </div>
                    <span
                      className={
                        transaction.kind === "expense" ? "tabular-nums text-expense" : "tabular-nums text-income"
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
    </section>
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
