import { isPortfolioAccount } from "@/lib/accounts";
import { todayISO } from "@/lib/dates";
import type { PortfolioPoint } from "@/lib/portfolio";
import type { Account, Transaction } from "@/lib/types";

export interface WealthBalance {
  account: Account;
  balanceCents: number;
}

export interface WealthSlice {
  accountId: string;
  name: string;
  balanceCents: number;
}

export interface WealthSnapshot {
  totalCents: number;
  cashCents: number;
  investedCents: number;
  balances: WealthBalance[];
  slices: WealthSlice[];
  negative: WealthSlice[];
}

export interface WealthPoint {
  month: string;
  asOf: string;
  totalCents: number;
}

interface WealthOptions {
  includeArchived?: boolean;
  today?: string;
}

interface ValueStep {
  date: string;
  valueCents: number;
}

function trackedAccounts(accounts: Account[], includeArchived: boolean): Account[] {
  return includeArchived ? accounts : accounts.filter((account) => !account.isArchived);
}

function cashDelta(transaction: Transaction, accountId: string): number | null {
  if (transaction.kind === "transfer") {
    if (transaction.toAccountId === accountId) return transaction.amountCents;
    if (transaction.accountId === accountId) return -transaction.amountCents;
    return null;
  }
  if (transaction.accountId !== accountId) return null;
  if (transaction.kind === "income" || transaction.kind === "refund") return transaction.amountCents;
  if (transaction.kind === "expense") return -transaction.amountCents;
  return null;
}

function cashSteps(account: Account, transactions: Transaction[]): ValueStep[] {
  const events: { date: string; createdAt: string; deltaCents: number }[] = [];
  for (const transaction of transactions) {
    const deltaCents = cashDelta(transaction, account.id);
    if (deltaCents === null) continue;
    events.push({ date: transaction.date, createdAt: transaction.createdAt, deltaCents });
  }
  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return 0;
  });

  let valueCents = account.openingBalanceCents;
  const steps: ValueStep[] = [];
  if (valueCents !== 0 || events.length > 0) {
    steps.push({ date: account.createdAt.slice(0, 10), valueCents });
  }
  for (const event of events) {
    valueCents += event.deltaCents;
    steps.push({ date: event.date, valueCents });
  }
  return steps;
}

function stepsFor(
  account: Account,
  transactions: Transaction[],
  portfolioSeriesByAccountId: ReadonlyMap<string, PortfolioPoint[]>,
): ValueStep[] {
  if (isPortfolioAccount(account)) {
    const series = portfolioSeriesByAccountId.get(account.id) ?? [];
    return series.map((point) => ({ date: point.date, valueCents: point.valueCents }));
  }
  return cashSteps(account, transactions);
}

function finalValue(steps: ValueStep[]): number {
  return steps.length === 0 ? 0 : steps[steps.length - 1].valueCents;
}

/** Last walked point on or before `asOf`. Points stay in walk order, not sorted by date. */
function valueAt(steps: ValueStep[], asOf: string): number {
  let valueCents = 0;
  for (const step of steps) {
    if (step.date <= asOf) valueCents = step.valueCents;
  }
  return valueCents;
}

function toSlice(balance: WealthBalance): WealthSlice {
  return {
    accountId: balance.account.id,
    name: balance.account.name,
    balanceCents: balance.balanceCents,
  };
}

function monthEnd(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
}

function nextMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(year, month, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function wealthSnapshot(
  accounts: Account[],
  transactions: Transaction[],
  portfolioSeriesByAccountId: ReadonlyMap<string, PortfolioPoint[]>,
  options?: WealthOptions,
): WealthSnapshot {
  const balances = trackedAccounts(accounts, options?.includeArchived ?? false).map((account) => ({
    account,
    balanceCents: finalValue(stepsFor(account, transactions, portfolioSeriesByAccountId)),
  }));

  let cashCents = 0;
  let investedCents = 0;
  for (const balance of balances) {
    if (isPortfolioAccount(balance.account)) investedCents += balance.balanceCents;
    else cashCents += balance.balanceCents;
  }

  return {
    totalCents: cashCents + investedCents,
    cashCents,
    investedCents,
    balances,
    slices: balances.filter((balance) => balance.balanceCents > 0).map(toSlice),
    negative: balances.filter((balance) => balance.balanceCents < 0).map(toSlice),
  };
}

export function wealthSeries(
  accounts: Account[],
  transactions: Transaction[],
  portfolioSeriesByAccountId: ReadonlyMap<string, PortfolioPoint[]>,
  options?: WealthOptions,
): WealthPoint[] {
  const today = options?.today ?? todayISO();
  const todayMonth = today.slice(0, 7);
  const tracked = trackedAccounts(accounts, options?.includeArchived ?? false).map((account) =>
    stepsFor(account, transactions, portfolioSeriesByAccountId),
  );

  let startMonth: string | null = null;
  for (const steps of tracked) {
    for (const step of steps) {
      const month = step.date.slice(0, 7);
      if (startMonth === null || month < startMonth) startMonth = month;
    }
  }
  if (startMonth === null || startMonth > todayMonth) return [];

  const points: WealthPoint[] = [];
  for (let month = startMonth; month <= todayMonth; month = nextMonth(month)) {
    const current = month === todayMonth;
    const asOf = current ? today : monthEnd(month);
    let totalCents = 0;
    for (const steps of tracked) {
      totalCents += current ? finalValue(steps) : valueAt(steps, asOf);
    }
    points.push({ month, asOf, totalCents });
  }
  return points;
}

export function wealthChangeCents(series: WealthPoint[], yearMonth: string): number | null {
  const index = series.findIndex((point) => point.month === yearMonth);
  if (index <= 0) return null;
  return series[index].totalCents - series[index - 1].totalCents;
}
