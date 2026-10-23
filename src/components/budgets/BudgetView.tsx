import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useFinance } from "@/context/FinanceContext";
import { formatMonthLabel } from "@/lib/dates";
import { formatMoney, parseAmountToken } from "@/lib/money";
import { UNCATEGORIZED_ID } from "@/lib/types";

export function BudgetView() {
  const { categorySpend, settings, selectedMonth, upsertBudget } = useFinance();
  const rows = categorySpend
    .filter((item) => item.category.id !== UNCATEGORIZED_ID)
    .slice()
    .sort((a, b) => a.category.name.localeCompare(b.category.name));

  function persist(categoryId: string, raw: string) {
    const cents = parseAmountToken(raw);
    void upsertBudget(categoryId, cents ?? 0);
  }

  return (
    <section className="flex-1 overflow-auto p-5">
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Monthly budgets</h1>
        <p className="text-sm text-muted-foreground">
          Caps for {formatMonthLabel(selectedMonth, settings.locale)}. Clear a field to remove the cap.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((item) => {
          const budget = item.budgetCents ?? 0;
          const ratio = budget === 0 ? 0 : (item.spentCents / budget) * 100;
          return (
            <Card key={item.category.id}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: item.category.color }} />
                  {item.category.name}
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {formatMoney(item.spentCents, settings.currency, settings.locale)} spent
                </span>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    key={`${item.category.id}-${item.budgetCents ?? 0}`}
                    defaultValue={item.budgetCents ? (item.budgetCents / 100).toFixed(2) : ""}
                    placeholder="0.00"
                    className="w-32"
                    aria-label={`${item.category.name} monthly budget`}
                    onBlur={(event) => persist(item.category.id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        persist(item.category.id, event.currentTarget.value);
                        event.currentTarget.blur();
                      }
                    }}
                  />
                  <span className="text-xs text-muted-foreground">per month</span>
                </div>
                {item.budgetCents !== null && (
                  <Progress value={ratio} indicatorClassName={ratio > 100 ? "bg-expense" : undefined} />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
