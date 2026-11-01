import { describe, expect, it } from "vitest";
import { isPortfolioAccount } from "@/lib/accounts";
import { accountBalances } from "@/lib/derived";
import { overlayPortfolioValues, portfolioSeries, portfolioSnapshots } from "@/lib/portfolio";
import type { PortfolioPoint } from "@/lib/portfolio";
import type { Account, Transaction, ValuationLog } from "@/lib/types";
import { makeAccount, makeTransaction, makeValuation } from "@/test/fixtures";
import { wealthChangeCents, wealthSeries, wealthSnapshot } from "@/lib/wealth";

const OPEN = "2026-01-01T00:00:00.000Z";
const TODAY = "2026-04-15";

function seriesFor(accounts: Account[], transactions: Transaction[], logs: ValuationLog[] = []) {
  const series = new Map<string, PortfolioPoint[]>();
  for (const account of accounts) {
    if (!isPortfolioAccount(account)) continue;
    series.set(account.id, portfolioSeries(account, transactions, logs));
  }
  return series;
}

function cardTotal(accounts: Account[], transactions: Transaction[], logs: ValuationLog[], includeArchived: boolean) {
  const overlaid = overlayPortfolioValues(
    accountBalances(accounts, transactions),
    portfolioSnapshots(accounts, transactions, logs),
  );
  return overlaid
    .filter((row) => includeArchived || !row.account.isArchived)
    .reduce((sum, row) => sum + row.balanceCents, 0);
}

describe("wealthSnapshot", () => {
  it("splits cash book value from portfolio market value and matches the accounts total", () => {
    const checking = makeAccount({
      id: "checking",
      name: "Checking",
      type: "bank",
      openingBalanceCents: 5_000,
      createdAt: OPEN,
      updatedAt: OPEN,
    });
    const brokerage = makeAccount({
      id: "broker",
      name: "Brokerage",
      type: "investment",
      openingBalanceCents: 0,
      createdAt: OPEN,
      updatedAt: OPEN,
    });
    const transfer = makeTransaction({
      id: "move",
      kind: "transfer",
      amountCents: 2_000,
      accountId: checking.id,
      toAccountId: brokerage.id,
      categoryId: "cat_transfer",
      description: "Deposit",
      date: "2026-02-01",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    const log = makeValuation({
      id: "val",
      accountId: brokerage.id,
      valueCents: 2_500,
      date: "2026-03-01",
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    const accounts = [checking, brokerage];
    const transactions = [transfer];
    const logs = [log];
    const snapshot = wealthSnapshot(accounts, transactions, seriesFor(accounts, transactions, logs));

    expect(snapshot.cashCents).toBe(3_000);
    expect(snapshot.investedCents).toBe(2_500);
    expect(snapshot.totalCents).toBe(5_500);
    expect(snapshot.totalCents).toBe(cardTotal(accounts, transactions, logs, false));
  });

  it("keeps a transfer between included accounts out of the total", () => {
    const checking = makeAccount({
      id: "checking",
      name: "Checking",
      type: "bank",
      openingBalanceCents: 5_000,
      createdAt: OPEN,
      updatedAt: OPEN,
    });
    const savings = makeAccount({
      id: "savings",
      name: "Savings",
      type: "savings",
      createdAt: OPEN,
      updatedAt: OPEN,
    });
    const transfer = makeTransaction({
      id: "move",
      kind: "transfer",
      amountCents: 2_000,
      accountId: checking.id,
      toAccountId: savings.id,
      categoryId: "cat_transfer",
      description: "Save",
      date: "2026-02-01",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    const accounts = [checking, savings];
    const series = wealthSeries(accounts, [transfer], seriesFor(accounts, [transfer]), { today: TODAY });

    expect(series.map((point) => point.totalCents)).toEqual([5_000, 5_000, 5_000, 5_000]);
    const snapshot = wealthSnapshot(accounts, [transfer], seriesFor(accounts, [transfer]));
    expect(snapshot.balances.map((row) => row.balanceCents)).toEqual([3_000, 2_000]);
  });

  it("drops a transfer into an excluded archived account and restores the whole history when included", () => {
    const checking = makeAccount({
      id: "checking",
      name: "Checking",
      type: "bank",
      openingBalanceCents: 5_000,
      createdAt: OPEN,
      updatedAt: OPEN,
    });
    const savings = makeAccount({
      id: "savings",
      name: "Old savings",
      type: "savings",
      isArchived: true,
      createdAt: OPEN,
      updatedAt: OPEN,
    });
    const transfer = makeTransaction({
      id: "move",
      kind: "transfer",
      amountCents: 2_000,
      accountId: checking.id,
      toAccountId: savings.id,
      categoryId: "cat_transfer",
      description: "Park",
      date: "2026-02-01",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    const accounts = [checking, savings];
    const hidden = wealthSeries(accounts, [transfer], seriesFor(accounts, [transfer]), { today: TODAY });
    const shown = wealthSeries(accounts, [transfer], seriesFor(accounts, [transfer]), {
      includeArchived: true,
      today: TODAY,
    });

    expect(hidden.map((point) => point.totalCents)).toEqual([5_000, 3_000, 3_000, 3_000]);
    expect(shown.map((point) => point.totalCents)).toEqual([5_000, 5_000, 5_000, 5_000]);
    expect(wealthSnapshot(accounts, [transfer], seriesFor(accounts, [transfer])).totalCents).toBe(3_000);
    expect(
      wealthSnapshot(accounts, [transfer], seriesFor(accounts, [transfer]), { includeArchived: true }).totalCents,
    ).toBe(5_000);
  });

  it("replaces portfolio value at a valuation and applies a later fee once", () => {
    const brokerage = makeAccount({
      id: "broker",
      name: "Brokerage",
      type: "investment",
      createdAt: OPEN,
      updatedAt: OPEN,
    });
    const log = makeValuation({
      id: "val",
      accountId: brokerage.id,
      valueCents: 11_000,
      date: "2026-02-01",
      createdAt: "2026-02-01T00:00:00.000Z",
    });
    const fee = makeTransaction({
      id: "fee",
      kind: "expense",
      amountCents: 500,
      accountId: brokerage.id,
      description: "Fee",
      date: "2026-03-01",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    const accounts = [brokerage];
    const transactions = [fee];
    const logs = [log];
    const series = wealthSeries(accounts, transactions, seriesFor(accounts, transactions, logs), { today: TODAY });

    expect(series.find((point) => point.month === "2026-01")).toMatchObject({ asOf: "2026-01-31", totalCents: 0 });
    expect(series.find((point) => point.month === "2026-02")).toMatchObject({ asOf: "2026-02-28", totalCents: 11_000 });
    expect(series.find((point) => point.month === "2026-03")).toMatchObject({ asOf: "2026-03-31", totalCents: 10_500 });
    expect(wealthSnapshot(accounts, transactions, seriesFor(accounts, transactions, logs)).investedCents).toBe(10_500);
  });

  it("moves the total with income, expense, and refunds", () => {
    const checking = makeAccount({
      id: "checking",
      name: "Checking",
      type: "bank",
      createdAt: OPEN,
      updatedAt: OPEN,
    });
    const transactions = [
      makeTransaction({
        id: "pay",
        kind: "income",
        amountCents: 2_000,
        accountId: checking.id,
        categoryId: "cat_salary",
        description: "Pay",
        date: "2026-02-01",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
      makeTransaction({
        id: "lunch",
        kind: "expense",
        amountCents: 500,
        accountId: checking.id,
        description: "Lunch",
        date: "2026-03-01",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }),
      makeTransaction({
        id: "back",
        kind: "refund",
        amountCents: 100,
        accountId: checking.id,
        description: "Return",
        date: "2026-03-20",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      }),
    ];
    const series = wealthSeries([checking], transactions, new Map(), { today: TODAY });
    const snapshot = wealthSnapshot([checking], transactions, new Map());

    expect(series.find((point) => point.month === "2026-02")?.totalCents).toBe(2_000);
    expect(series.find((point) => point.month === "2026-03")?.totalCents).toBe(1_600);
    expect(snapshot.totalCents).toBe(1_600);
    expect(snapshot.cashCents).toBe(1_600);
    expect(snapshot.investedCents).toBe(0);
  });

  it("keeps a negative balance in the total and out of the pie", () => {
    const checking = makeAccount({
      id: "checking",
      name: "Checking",
      type: "bank",
      openingBalanceCents: -4_000,
      createdAt: OPEN,
      updatedAt: OPEN,
    });
    const savings = makeAccount({
      id: "savings",
      name: "Savings",
      type: "savings",
      openingBalanceCents: 10_000,
      createdAt: OPEN,
      updatedAt: OPEN,
    });
    const empty = makeAccount({
      id: "wallet",
      name: "Wallet",
      type: "cash",
      createdAt: OPEN,
      updatedAt: OPEN,
    });
    const snapshot = wealthSnapshot([checking, savings, empty], [], new Map());

    expect(snapshot.totalCents).toBe(6_000);
    expect(snapshot.slices).toEqual([{ accountId: "savings", name: "Savings", balanceCents: 10_000 }]);
    expect(snapshot.negative).toEqual([{ accountId: "checking", name: "Checking", balanceCents: -4_000 }]);
  });

  it("ends the series on today at the live total", () => {
    const checking = makeAccount({
      id: "checking",
      name: "Checking",
      type: "bank",
      openingBalanceCents: 1_000,
      createdAt: OPEN,
      updatedAt: OPEN,
    });
    const later = makeTransaction({
      id: "later",
      kind: "income",
      amountCents: 100,
      accountId: checking.id,
      categoryId: "cat_salary",
      description: "Later",
      date: "2026-04-20",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
    });
    const accounts = [checking];
    const transactions = [later];
    const snapshot = wealthSnapshot(accounts, transactions, new Map());
    const series = wealthSeries(accounts, transactions, new Map(), { today: TODAY });
    const last = series[series.length - 1];

    expect(last).toEqual({ month: "2026-04", asOf: TODAY, totalCents: snapshot.totalCents });
    expect(snapshot.totalCents).toBe(cardTotal(accounts, transactions, [], false));
    expect(series.find((point) => point.month === "2026-03")?.totalCents).toBe(1_000);
  });
});

describe("wealthSeries", () => {
  it("starts at the account open date and holds a flat opening balance across the year boundary", () => {
    const savings = makeAccount({
      id: "savings",
      name: "Savings",
      type: "savings",
      openingBalanceCents: 4_000,
      createdAt: "2025-11-15T00:00:00.000Z",
      updatedAt: "2025-11-15T00:00:00.000Z",
    });
    const series = wealthSeries([savings], [], new Map(), { today: "2026-02-10" });

    expect(series.map((point) => point.month)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(series.map((point) => point.totalCents)).toEqual([4_000, 4_000, 4_000, 4_000]);
    expect(series[0]?.asOf).toBe("2025-11-30");
    expect(series[3]?.asOf).toBe("2026-02-10");
  });
});

describe("wealthChangeCents", () => {
  it("is the gap from the previous month-end, and blank without one", () => {
    const series = wealthSeries(
      [
        makeAccount({
          id: "checking",
          name: "Checking",
          type: "bank",
          createdAt: OPEN,
          updatedAt: OPEN,
        }),
      ],
      [
        makeTransaction({
          id: "pay",
          kind: "income",
          amountCents: 2_000,
          accountId: "checking",
          categoryId: "cat_salary",
          description: "Pay",
          date: "2026-02-01",
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
      new Map(),
      { today: TODAY },
    );

    expect(wealthChangeCents(series, "2026-01")).toBeNull();
    expect(wealthChangeCents(series, "2026-02")).toBe(2_000);
    expect(wealthChangeCents(series, "2026-04")).toBe(0);
    expect(wealthChangeCents(series, "2025-12")).toBeNull();
    expect(wealthChangeCents(series, "2026-05")).toBeNull();
  });
});
