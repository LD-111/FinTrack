import {
  Bar,
  BarChart,
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
import { useFinance } from "@/context/FinanceContext";
import { dailySpend } from "@/lib/derived";
import { formatMoney } from "@/lib/money";

export function VisualInsights() {
  const { categorySpend, transactions, settings } = useFinance();

  const pieData = categorySpend
    .filter((item) => item.spentCents > 0)
    .map((item) => ({
      name: item.category.name,
      value: item.spentCents / 100,
      color: item.category.color,
    }));

  const barData = categorySpend
    .filter((item) => item.budgetCents !== null)
    .map((item) => ({
      name: item.category.name,
      spent: item.spentCents / 100,
      budget: (item.budgetCents ?? 0) / 100,
    }));

  const lineData = dailySpend(transactions).map((item) => ({
    date: item.date.slice(5),
    spent: item.cents / 100,
  }));

  const moneyTick = (value: number) => formatMoney(Math.round(value * 100), settings.currency, settings.locale);

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Category share</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          {pieData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => moneyTick(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Budget vs actual</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          {barData.length === 0 ? (
            <EmptyChart label="Set a budget to compare spend." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={moneyTick} width={72} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => moneyTick(Number(value))} />
                <Bar dataKey="spent" fill="var(--color-expense)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="budget" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Last 30 days</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
              <YAxis tickFormatter={moneyTick} width={72} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => moneyTick(Number(value))} />
              <Line type="monotone" dataKey="spent" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyChart({ label = "No expenses this month yet." }: { label?: string }) {
  return <p className="flex h-full items-center justify-center text-sm text-muted-foreground">{label}</p>;
}
