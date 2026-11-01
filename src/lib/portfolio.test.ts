import { describe, expect, it } from "vitest";
import { accountBalances } from "@/lib/derived";
import { overlayPortfolioValues, portfolioSeries, portfolioSnapshot, portfolioSnapshots } from "@/lib/portfolio";
import { makeAccount, makeTransaction, makeValuation } from "@/test/fixtures";

const OPEN = "2026-01-01T00:00:00.000Z";

function brokerageBooks() {
  const brokerage = makeAccount({
    id: "broker",
    name: "Brokerage",
    type: "investment",
    slug: "brokerage",
    openingBalanceCents: 10_000,
    createdAt: OPEN,
    updatedAt: OPEN,
  });
  const cash = makeAccount({
    id: "cash",
    name: "Cash",
    type: "cash",
    slug: "cash",
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
  const deposit = makeTransaction({
    id: "dep",
    kind: "transfer",
    amountCents: 11_000,
    accountId: cash.id,
    toAccountId: brokerage.id,
    categoryId: "cat_transfer",
    description: "Deposit",
    date: "2026-03-01",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  });
  return { brokerage, cash, log, deposit };
}

describe("portfolioSnapshot", () => {
  it("keeps a deposit after a gain out of profit and the time-weighted return", () => {
    const { brokerage, cash, log, deposit } = brokerageBooks();
    const snapshot = portfolioSnapshot(brokerage, [deposit], [log]);

    expect(snapshot.investedPrincipalCents).toBe(21_000);
    expect(snapshot.currentValueCents).toBe(22_000);
    expect(snapshot.profitCents).toBe(1_000);
    expect(snapshot.twrRatio).toBeCloseTo(0.1);
    expect(snapshot.lastValuation).toEqual(log);

    const series = portfolioSeries(brokerage, [deposit], [log]);
    expect(series[series.length - 1]).toEqual({
      date: "2026-03-01",
      investedCents: 21_000,
      valueCents: 22_000,
    });

    const stock = makeAccount({
      id: "stock",
      name: "Index",
      type: "stock",
      slug: "index",
      createdAt: OPEN,
      updatedAt: OPEN,
    });
    expect(portfolioSnapshots([cash, brokerage, stock], [deposit], [log]).map((item) => item.account.id)).toEqual([
      brokerage.id,
      stock.id,
    ]);
  });

  it("shows market value for portfolio accounts and leaves other balances alone", () => {
    const { brokerage, cash, log, deposit } = brokerageBooks();
    const balances = accountBalances([cash, brokerage], [deposit]);
    const overlaid = overlayPortfolioValues(balances, portfolioSnapshots([cash, brokerage], [deposit], [log]));

    expect(overlaid.find((row) => row.account.id === cash.id)?.balanceCents).toBe(-11_000);
    expect(overlaid.find((row) => row.account.id === brokerage.id)?.balanceCents).toBe(22_000);
  });

  it("counts a fee and a dividend after a valuation without changing principal", () => {
    const { brokerage, log } = brokerageBooks();
    const fee = makeTransaction({
      id: "fee",
      kind: "expense",
      amountCents: 100,
      accountId: brokerage.id,
      date: "2026-02-02",
      createdAt: "2026-02-02T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
    const dividend = makeTransaction({
      id: "div",
      kind: "income",
      amountCents: 500,
      accountId: brokerage.id,
      categoryId: "cat_other_income",
      date: "2026-02-03",
      createdAt: "2026-02-03T00:00:00.000Z",
      updatedAt: "2026-02-03T00:00:00.000Z",
    });
    const snapshot = portfolioSnapshot(brokerage, [fee, dividend], [log]);

    expect(snapshot.investedPrincipalCents).toBe(10_000);
    expect(snapshot.currentValueCents).toBe(11_400);
    expect(snapshot.profitCents).toBe(1_400);
    expect(snapshot.twrRatio).toBeCloseTo(0.14);
  });

  it("lets a later valuation replace a fee that was already marked", () => {
    const { brokerage, log } = brokerageBooks();
    const fee = makeTransaction({
      id: "fee",
      kind: "expense",
      amountCents: 100,
      accountId: brokerage.id,
      date: "2026-01-15",
      createdAt: "2026-01-15T00:00:00.000Z",
      updatedAt: "2026-01-15T00:00:00.000Z",
    });
    const snapshot = portfolioSnapshot(brokerage, [fee], [log]);

    expect(snapshot.investedPrincipalCents).toBe(10_000);
    expect(snapshot.currentValueCents).toBe(11_000);
    expect(snapshot.profitCents).toBe(1_000);
  });
});
