import { describe, expect, it } from "vitest";
import { accountBalances, categorySpendForMonth, summarizeMonth } from "@/lib/derived";
import { makeAccount, makeCategory, makeTransaction } from "@/test/fixtures";
import type { Budget } from "@/lib/types";

const cash = makeAccount({
  id: "cash",
  name: "Cash",
  type: "cash",
  slug: "cash",
  openingBalanceCents: 10_000,
});
const savings = makeAccount({
  id: "savings",
  name: "Savings",
  type: "savings",
  slug: "savings",
});
const food = makeCategory({ id: "cat_food", name: "Food", kind: "expense" });
const salary = makeCategory({ id: "cat_salary", name: "Salary", kind: "income" });
const archived = makeCategory({ id: "cat_old", name: "Old", kind: "expense", isArchived: true });

const income = makeTransaction({
  id: "in",
  kind: "income",
  amountCents: 5_000,
  accountId: "cash",
  categoryId: "cat_salary",
  date: "2026-10-02",
});
const expense = makeTransaction({
  id: "ex",
  kind: "expense",
  amountCents: 1_200,
  accountId: "cash",
  categoryId: "cat_food",
  date: "2026-10-03",
});
const refund = makeTransaction({
  id: "re",
  kind: "refund",
  amountCents: 200,
  accountId: "cash",
  categoryId: "cat_food",
  date: "2026-10-04",
});
const transfer = makeTransaction({
  id: "tr",
  kind: "transfer",
  amountCents: 3_000,
  accountId: "cash",
  toAccountId: "savings",
  categoryId: "cat_transfer",
  date: "2026-10-05",
});
const september = makeTransaction({
  id: "sep",
  kind: "expense",
  amountCents: 9_999,
  accountId: "cash",
  date: "2026-09-15",
});

const october = [income, expense, refund, transfer, september];

describe("summarizeMonth", () => {
  it("skips transfers and lets a refund lower spent without touching income", () => {
    expect(summarizeMonth(october, "2026-10")).toEqual({
      yearMonth: "2026-10",
      incomeCents: 5_000,
      expenseCents: 1_000,
      netCents: 4_000,
    });
  });
});

describe("categorySpendForMonth", () => {
  it("nets refunds against the spending category and ignores income, transfers, and archived categories", () => {
    const budget: Budget = {
      id: "bud_food",
      categoryId: food.id,
      amountCents: 20_000,
      period: "monthly",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const archivedSpend = makeTransaction({
      id: "old",
      categoryId: archived.id,
      amountCents: 500,
      date: "2026-10-06",
    });

    expect(categorySpendForMonth([...october, archivedSpend], [food, salary, archived], [budget], "2026-10")).toEqual([
      { category: food, spentCents: 1_000, budgetCents: 20_000 },
    ]);
  });
});

describe("accountBalances", () => {
  it("adds income and refunds, subtracts expenses, and moves transfers to both accounts", () => {
    expect(accountBalances([cash, savings], [income, expense, refund, transfer])).toEqual([
      { account: cash, balanceCents: 11_000 },
      { account: savings, balanceCents: 3_000 },
    ]);
  });
});
