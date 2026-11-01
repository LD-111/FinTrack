import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLedger, usePortfolio, useShell } from "@/context/FinanceContext";
import { formatMonthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { wealthChangeCents, wealthSeries, wealthSnapshot, type WealthSlice } from "@/lib/wealth";

function formatShare(cents: number, totalCents: number, locale: string): string {
  if (totalCents <= 0) return "0%";
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(cents / totalCents);
}

const SLICE_COLORS = [
  "#0f766e",
  "#2563eb",
  "#d97706",
  "#7c3aed",
  "#db2777",
  "#0891b2",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
  "#64748b",
];

export function BalancesSection() {
  const { accounts, transactions } = useLedger();
  const { seriesByAccountId } = usePortfolio();
  const { selectedMonth, settings } = useShell();
  const [includeArchived, setIncludeArchived] = useState(false);
  const hasArchived = accounts.some((account) => account.isArchived);
  const include = includeArchived && hasArchived;

  const snapshot = useMemo(
    () => wealthSnapshot(accounts, transactions, seriesByAccountId, { includeArchived: include }),
    [accounts, include, seriesByAccountId, transactions],
  );
  const series = useMemo(
    () => wealthSeries(accounts, transactions, seriesByAccountId, { includeArchived: include }),
    [accounts, include, seriesByAccountId, transactions],
  );
  const change = wealthChangeCents(series, selectedMonth);
  const monthTitle = `In ${formatMonthLabel(selectedMonth, settings.locale)}`;
  const spansYears = series.length > 1 && series[0].month.slice(0, 4) !== series[series.length - 1].month.slice(0, 4);

  const pieCents = snapshot.slices.reduce((sum, slice) => sum + slice.balanceCents, 0);
  const pieData = snapshot.slices.map((slice) => ({
    id: slice.accountId,
    name: slice.name,
    cents: slice.balanceCents,
    value: slice.balanceCents / 100,
    color: sliceColor(slice.accountId, snapshot.balances),
  }));
  const lineData = series.map((point) => ({
    month: point.month,
    label: shortMonth(point.month, settings.locale, spansYears),
    total: point.totalCents / 100,
  }));

  const moneyTick = (value: number) => formatMoney(Math.round(value * 100), settings.currency, settings.locale);
  const money = (cents: number) => formatMoney(cents, settings.currency, settings.locale, "auto");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Balances</h2>
          <p className="text-sm text-muted-foreground">Bank, cash, savings, and investments.</p>
        </div>
        {hasArchived && (
          <button
            type="button"
            aria-pressed={includeArchived}
            className={cn(
              "rounded-md border border-input px-3 py-1.5 text-sm",
              includeArchived ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setIncludeArchived((current) => !current)}
          >
            Include archived
          </button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StatCard title="Total" value={money(snapshot.totalCents)} />
        <StatCard title="Liquid" value={money(snapshot.cashCents)} />
        <StatCard title="Invested" value={money(snapshot.investedCents)} />
        <StatCard
          title={monthTitle}
          value={change === null ? "—" : money(change)}
          tone={change === null ? undefined : change >= 0 ? "income" : "expense"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By account</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              {pieData.length === 0 ? (
                <EmptyChart label="No positive balances to chart." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={72}
                      paddingAngle={2}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.id} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => {
                        const cents = Math.round(Number(value) * 100);
                        return `${formatShare(cents, pieCents, settings.locale)} · ${formatMoney(cents, settings.currency, settings.locale)}`;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            {pieData.length > 0 && (
              <ul className="mt-3 space-y-1">
                {pieData.map((slice) => (
                  <li key={slice.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: slice.color }} />
                      <span className="truncate">{slice.name}</span>
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatShare(slice.cents, pieCents, settings.locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {snapshot.negative.length > 0 && (
              <p className="mt-3 text-sm text-muted-foreground">{negativeNote(snapshot.negative)}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Over time</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            {lineData.length < 2 ? (
              <EmptyChart label="Not enough history yet." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineData} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={(month) => shortMonth(String(month), settings.locale, spansYears)}
                    tick={{ fontSize: 11 }}
                    interval={lineData.length > 8 ? "preserveStartEnd" : 0}
                  />
                  <YAxis tickFormatter={moneyTick} width={72} tick={{ fontSize: 11 }} />
                  <Tooltip
                    labelFormatter={(month) => formatMonthLabel(String(month), settings.locale)}
                    formatter={(value) => moneyTick(Number(value))}
                  />
                  <Line
                    type="stepAfter"
                    dataKey="total"
                    name="Total"
                    stroke="var(--color-primary)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function sliceColor(accountId: string, balances: { account: { id: string } }[]): string {
  const index = balances.findIndex((row) => row.account.id === accountId);
  return SLICE_COLORS[(index < 0 ? 0 : index) % SLICE_COLORS.length];
}

function shortMonth(yearMonth: string, locale: string, withYear: boolean): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(locale, {
    month: "short",
    year: withYear ? "2-digit" : undefined,
  });
}

function negativeNote(rows: WealthSlice[]): string {
  const names = rows.map((row) => row.name);
  if (names.length === 1) return `${names[0]} is negative and left out of the chart.`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are negative and left out of the chart.`;
  const last = names[names.length - 1];
  return `${names.slice(0, -1).join(", ")}, and ${last} are negative and left out of the chart.`;
}

function EmptyChart({ label }: { label: string }) {
  return <p className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">{label}</p>;
}

function StatCard({ title, value, tone }: { title: string; value: string; tone?: "income" | "expense" }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={cn(
            "text-2xl font-semibold tabular-nums",
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
