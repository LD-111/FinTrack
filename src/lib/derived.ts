import { addDays, todayISO } from "@/lib/dates";
import type { Account, Budget, Category, Transaction } from "@/lib/types";

export interface MonthSummary {
  yearMonth: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

export interface AccountBalance {
  account: Account;
  balanceCents: number;
}

export function filterByMonth(transactions: Transaction[], yearMonth: string): Transaction[] {
  return transactions.filter((transaction) => transaction.date.startsWith(yearMonth));
}

export function summarizeMonth(transactions: Transaction[], yearMonth: string): MonthSummary {
  return filterByMonth(transactions, yearMonth).reduce<MonthSummary>(
    (summary, transaction) => {
      if (transaction.kind === "transfer") return summary;
      if (transaction.kind === "income") {
        summary.incomeCents += transaction.amountCents;
      } else {
        summary.expenseCents += transaction.amountCents;
      }
      summary.netCents = summary.incomeCents - summary.expenseCents;
      return summary;
    },
    { yearMonth, incomeCents: 0, expenseCents: 0, netCents: 0 },
  );
}

export interface CategorySpend {
  category: Category;
  spentCents: number;
  budgetCents: number | null;
}

export function categorySpendForMonth(
  transactions: Transaction[],
  categories: Category[],
  budgets: Budget[],
  yearMonth: string,
): CategorySpend[] {
  const spentByCategory = new Map<string, number>();
  for (const transaction of filterByMonth(transactions, yearMonth)) {
    if (transaction.kind !== "expense") continue;
    spentByCategory.set(
      transaction.categoryId,
      (spentByCategory.get(transaction.categoryId) ?? 0) + transaction.amountCents,
    );
  }

  return categories
    .filter((category) => category.kind === "expense" && !category.isArchived)
    .map((category) => ({
      category,
      spentCents: spentByCategory.get(category.id) ?? 0,
      budgetCents: budgets.find((budget) => budget.categoryId === category.id)?.amountCents ?? null,
    }));
}

export function dailySpend(transactions: Transaction[], days = 30): { date: string; cents: number }[] {
  const start = addDays(todayISO(), -(days - 1));
  const totals = new Map<string, number>();
  for (let i = 0; i < days; i += 1) {
    totals.set(addDays(start, i), 0);
  }

  for (const transaction of transactions) {
    if (transaction.kind !== "expense") continue;
    if (transaction.date < start) continue;
    if (!totals.has(transaction.date)) continue;
    totals.set(transaction.date, (totals.get(transaction.date) ?? 0) + transaction.amountCents);
  }

  return [...totals.entries()].map(([date, cents]) => ({ date, cents }));
}

export function accountBalances(accounts: Account[], transactions: Transaction[]): AccountBalance[] {
  const totals = new Map(accounts.map((account) => [account.id, account.openingBalanceCents]));

  for (const transaction of transactions) {
    if (transaction.kind === "income") {
      totals.set(transaction.accountId, (totals.get(transaction.accountId) ?? 0) + transaction.amountCents);
      continue;
    }
    if (transaction.kind === "expense") {
      totals.set(transaction.accountId, (totals.get(transaction.accountId) ?? 0) - transaction.amountCents);
      continue;
    }
    totals.set(transaction.accountId, (totals.get(transaction.accountId) ?? 0) - transaction.amountCents);
    if (transaction.toAccountId) {
      totals.set(transaction.toAccountId, (totals.get(transaction.toAccountId) ?? 0) + transaction.amountCents);
    }
  }

  return accounts.map((account) => ({
    account,
    balanceCents: totals.get(account.id) ?? account.openingBalanceCents,
  }));
}
