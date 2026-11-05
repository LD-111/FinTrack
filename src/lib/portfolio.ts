import { isPortfolioAccount } from "@/lib/accounts";
import type { AccountBalance } from "@/lib/derived";
import type { Account, PortfolioSnapshot, Transaction, ValuationLog } from "@/lib/types";

export interface PortfolioPoint {
  date: string;
  investedCents: number;
  valueCents: number;
}

type PortfolioEvent =
  | { kind: "transfer"; date: string; createdAt: string; deltaCents: number }
  | { kind: "cash"; date: string; createdAt: string; deltaCents: number }
  | { kind: "valuation"; date: string; createdAt: string; valueCents: number; log: ValuationLog };

const EVENT_RANK: Record<PortfolioEvent["kind"], number> = {
  transfer: 0,
  cash: 1,
  valuation: 2,
};

function transferDelta(transaction: Transaction, accountId: string): number | null {
  if (transaction.kind !== "transfer") return null;
  if (transaction.toAccountId === accountId) return transaction.amountCents;
  if (transaction.accountId === accountId) return -transaction.amountCents;
  return null;
}

function cashDelta(transaction: Transaction, accountId: string): number | null {
  if (transaction.accountId !== accountId) return null;
  if (transaction.kind === "income" || transaction.kind === "refund") return transaction.amountCents;
  if (transaction.kind === "expense") return -transaction.amountCents;
  return null;
}

function compareChrono(
  a: { date: string; createdAt: string; kind: PortfolioEvent["kind"] },
  b: { date: string; createdAt: string; kind: PortfolioEvent["kind"] },
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.kind !== b.kind) return EVENT_RANK[a.kind] - EVENT_RANK[b.kind];
  return 0;
}

function collectEvents(
  accountId: string,
  transactions: Transaction[],
  logs: ValuationLog[],
): PortfolioEvent[] {
  const events: PortfolioEvent[] = [];
  for (const transaction of transactions) {
    const deltaCents = transferDelta(transaction, accountId);
    if (deltaCents === null) continue;
    events.push({
      kind: "transfer",
      date: transaction.date,
      createdAt: transaction.createdAt,
      deltaCents,
    });
  }
  for (const transaction of transactions) {
    const deltaCents = cashDelta(transaction, accountId);
    if (deltaCents === null) continue;
    events.push({
      kind: "cash",
      date: transaction.date,
      createdAt: transaction.createdAt,
      deltaCents,
    });
  }
  for (const log of logs) {
    if (log.accountId !== accountId) continue;
    events.push({
      kind: "valuation",
      date: log.date,
      createdAt: log.createdAt,
      valueCents: log.valueCents,
      log,
    });
  }
  events.sort(compareChrono);
  return events;
}

function walkPortfolio(account: Account, transactions: Transaction[], logs: ValuationLog[]) {
  const events = collectEvents(account.id, transactions, logs);
  let principal = account.openingBalanceCents;
  let value = account.openingBalanceCents;
  let periodStart = account.openingBalanceCents;
  let growth = 1;
  let lastValuation: ValuationLog | null = null;
  const series: PortfolioPoint[] = [];

  const openingDate = account.createdAt.slice(0, 10);
  if (principal !== 0 || events.length > 0) {
    series.push({ date: openingDate, investedCents: principal, valueCents: value });
  }

  function closePeriod() {
    if (periodStart > 0) {
      growth *= value / periodStart;
    }
  }

  for (const event of events) {
    if (event.kind === "transfer") {
      closePeriod();
      if (event.deltaCents >= 0 || value <= 0) {
        principal += event.deltaCents;
        value += event.deltaCents;
      } else {
        const withdrawn = -event.deltaCents;
        if (withdrawn >= value) {
          value -= withdrawn;
          principal = value;
        } else {
          principal = Math.round((principal * (value - withdrawn)) / value);
          value -= withdrawn;
        }
      }
      if (value <= 0) growth = 1;
      periodStart = value;
    } else if (event.kind === "cash") {
      value += event.deltaCents;
    } else {
      value = event.valueCents;
      lastValuation = event.log;
    }
    series.push({ date: event.date, investedCents: principal, valueCents: value });
  }
  closePeriod();

  return {
    principal,
    value,
    lastValuation,
    twrRatio: growth - 1,
    series,
  };
}

export function portfolioSnapshot(
  account: Account,
  transactions: Transaction[],
  logs: ValuationLog[],
): PortfolioSnapshot {
  const walked = walkPortfolio(account, transactions, logs);
  return {
    account,
    investedPrincipalCents: walked.principal,
    currentValueCents: walked.value,
    profitCents: walked.value - walked.principal,
    twrRatio: walked.twrRatio,
    lastValuation: walked.lastValuation,
  };
}

export function portfolioSnapshots(
  accounts: Account[],
  transactions: Transaction[],
  logs: ValuationLog[],
): PortfolioSnapshot[] {
  return accounts.filter(isPortfolioAccount).map((account) => portfolioSnapshot(account, transactions, logs));
}

export interface PortfolioView {
  snapshot: PortfolioSnapshot;
  series: PortfolioPoint[];
}

export function portfolioViews(
  accounts: Account[],
  transactions: Transaction[],
  logs: ValuationLog[],
): PortfolioView[] {
  return accounts.filter(isPortfolioAccount).map((account) => {
    const walked = walkPortfolio(account, transactions, logs);
    return {
      snapshot: {
        account,
        investedPrincipalCents: walked.principal,
        currentValueCents: walked.value,
        profitCents: walked.value - walked.principal,
        twrRatio: walked.twrRatio,
        lastValuation: walked.lastValuation,
      },
      series: walked.series,
    };
  });
}

export function portfolioSeries(
  account: Account,
  transactions: Transaction[],
  logs: ValuationLog[],
): PortfolioPoint[] {
  return walkPortfolio(account, transactions, logs).series;
}

export function overlayPortfolioValues(
  balances: AccountBalance[],
  snapshots: PortfolioSnapshot[],
): AccountBalance[] {
  const byId = new Map(snapshots.map((snapshot) => [snapshot.account.id, snapshot]));
  return balances.map((row) => {
    const snapshot = byId.get(row.account.id);
    if (!snapshot) return row;
    return { ...row, balanceCents: snapshot.currentValueCents };
  });
}
