import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinance } from "@/context/FinanceContext";
import { formatAccountType, isPortfolioAccount } from "@/lib/accounts";
import { formatDisplayDate } from "@/lib/dates";
import { formatMoney, parseAmountToken } from "@/lib/money";
import { portfolioSeries } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

export function PortfolioPanel() {
  const {
    accounts,
    transactions,
    valuationLogs,
    portfolioSnapshots,
    selectedPortfolioAccountId,
    setSelectedPortfolioAccountId,
    settings,
    addValuationLog,
    deleteValuationLog,
  } = useFinance();
  const [rawValue, setRawValue] = useState("");

  const portfolioAccounts = accounts.filter((account) => !account.isArchived && isPortfolioAccount(account));
  const snapshot = portfolioSnapshots.find((row) => row.account.id === selectedPortfolioAccountId);
  const logs = useMemo(() => {
    if (!selectedPortfolioAccountId) return [];
    return valuationLogs
      .filter((log) => log.accountId === selectedPortfolioAccountId)
      .slice()
      .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
  }, [selectedPortfolioAccountId, valuationLogs]);

  const chartData = useMemo(() => {
    if (!snapshot) return [];
    return portfolioSeries(snapshot.account, transactions, valuationLogs).map((point, index) => ({
      step: index,
      date: point.date.slice(5),
      invested: point.investedCents / 100,
      value: point.valueCents / 100,
    }));
  }, [snapshot, transactions, valuationLogs]);

  if (portfolioAccounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add a Crypto or Stock account from the sidebar, then transfer money in and log its value.
      </p>
    );
  }

  const moneyTick = (value: number) => formatMoney(Math.round(value * 100), settings.currency, settings.locale);
  const profitTone = (snapshot?.profitCents ?? 0) >= 0 ? "income" : "expense";
  const showReturn = snapshot != null && snapshot.investedPrincipalCents > 0;

  async function submitValue() {
    if (!selectedPortfolioAccountId) return;
    const valueCents = parseAmountToken(rawValue);
    if (valueCents === null) return;
    const logged = await addValuationLog({ accountId: selectedPortfolioAccountId, valueCents });
    if (logged) setRawValue("");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {portfolioAccounts.map((account) => {
          const active = account.id === selectedPortfolioAccountId;
          return (
            <button
              key={account.id}
              type="button"
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm transition-colors",
                active ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-muted",
              )}
              onClick={() => setSelectedPortfolioAccountId(account.id)}
            >
              <span className="font-medium">{account.name}</span>
              <span className={cn("ml-2 text-xs", active ? "text-primary-foreground/80" : "text-muted-foreground")}>
                {formatAccountType(account.type)}
              </span>
            </button>
          );
        })}
      </div>

      {snapshot && (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <StatCard
              title="Current value"
              value={formatMoney(snapshot.currentValueCents, settings.currency, settings.locale)}
              tone="income"
            />
            <StatCard
              title="Invested"
              value={formatMoney(snapshot.investedPrincipalCents, settings.currency, settings.locale)}
            />
            <StatCard
              title="Profit / Loss"
              value={formatMoney(snapshot.profitCents, settings.currency, settings.locale, "auto")}
              tone={profitTone}
            />
            <StatCard
              title="Return"
              value={showReturn ? formatReturn(snapshot.twrRatio) : "—"}
              tone={showReturn ? profitTone : undefined}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Capital vs value</CardTitle>
            </CardHeader>
            <CardContent className="h-56">
              {chartData.length === 0 ? (
                <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Transfer money in, then log a value.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="step"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(step) => chartData[Number(step)]?.date ?? ""}
                      interval="preserveStartEnd"
                    />
                    <YAxis tickFormatter={moneyTick} width={72} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value, name) => [
                        moneyTick(Number(value)),
                        name === "invested" ? "Invested" : "Portfolio value",
                      ]}
                    />
                    <Legend />
                    <Line
                      type="stepAfter"
                      dataKey="invested"
                      name="Invested"
                      stroke="var(--color-muted-foreground)"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="stepAfter"
                      dataKey="value"
                      name="Portfolio value"
                      stroke="var(--color-income)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Log current total value</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="flex max-w-sm gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitValue();
                }}
              >
                <Input
                  value={rawValue}
                  placeholder="210"
                  inputMode="decimal"
                  aria-label="Current total value"
                  onChange={(event) => setRawValue(event.target.value)}
                />
                <Button type="submit" disabled={parseAmountToken(rawValue) === null}>
                  Log
                </Button>
              </form>
              <p className="mt-2 text-xs text-muted-foreground">
                Type what the account is worth right now. New transfers after this log are added automatically.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Valuation history</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No valuations yet.</p>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="tabular-nums font-medium">
                        {formatMoney(log.valueCents, settings.currency, settings.locale)}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDisplayDate(log.date, settings.locale)}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={() => void deleteValuationLog(log.id)}
                    >
                      Delete
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function formatReturn(ratio: number): string {
  return `${ratio >= 0 ? "+" : ""}${(ratio * 100).toFixed(1)}%`;
}

function StatCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone?: "income" | "expense";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={cn(
            "text-2xl font-semibold",
            tone === "income" && "text-income",
            tone === "expense" && "text-expense",
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
