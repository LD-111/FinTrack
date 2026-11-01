import type { Account, AccountType, Transaction, ValuationLog } from "@/lib/types";
import { toMerchantKey } from "@/lib/utils";

export const PORTFOLIO_ACCOUNT_TYPES: AccountType[] = ["investment", "crypto", "stock"];

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: "Bank",
  cash: "Cash",
  savings: "Savings",
  investment: "Investment",
  crypto: "Crypto",
  stock: "Stock",
};

export function isPortfolioAccount(account: Pick<Account, "type">): boolean {
  return PORTFOLIO_ACCOUNT_TYPES.includes(account.type);
}

export function formatAccountType(type: AccountType): string {
  return ACCOUNT_TYPE_LABELS[type];
}

export function toAccountSlug(name: string): string {
  return toMerchantKey(name);
}

export function uniqueAccountSlug(name: string, existing: Account[]): string {
  const base = toAccountSlug(name) || "account";
  const slugs = new Set(existing.map((account) => account.slug));
  if (!slugs.has(base)) return base;

  let suffix = 2;
  while (slugs.has(`${base} ${suffix}`)) {
    suffix += 1;
  }
  return `${base} ${suffix}`;
}

function matchTokenIn(token: string, accounts: Account[]): Account | undefined {
  const needle = token.trim().toLowerCase().replace(/^#/, "");
  if (!needle) return undefined;

  const exact = accounts.find(
    (account) => account.slug === needle || account.name.toLowerCase() === needle,
  );
  if (exact) return exact;

  const prefixes = accounts.filter(
    (account) => account.slug.startsWith(needle) || account.name.toLowerCase().startsWith(needle),
  );
  return prefixes.length === 1 ? prefixes[0] : undefined;
}

export function matchAccountToken(token: string, accounts: Account[]): Account | undefined {
  return matchTokenIn(
    token,
    accounts.filter((account) => !account.isArchived),
  );
}

export function matchArchivedAccountToken(token: string, accounts: Account[]): Account | undefined {
  return matchTokenIn(
    token,
    accounts.filter((account) => account.isArchived),
  );
}

export type AccountNameRank = "exact" | "prefix" | "contains";

export interface AccountNameHit {
  account: Account;
  rank: AccountNameRank;
}

const NAME_RANK_ORDER: Record<AccountNameRank, number> = {
  exact: 0,
  prefix: 1,
  contains: 2,
};

export function matchAccountsByName(query: string, accounts: Account[]): AccountNameHit[] {
  const nameNeedle = query.trim().toLowerCase();
  const slugNeedle = toAccountSlug(query);
  if (!nameNeedle && !slugNeedle) return [];

  const hits: AccountNameHit[] = [];
  for (const account of accounts) {
    const name = account.name.toLowerCase();
    const slug = account.slug;
    const exact =
      (nameNeedle !== "" && name === nameNeedle) || (slugNeedle !== "" && slug === slugNeedle);
    const prefix =
      (nameNeedle !== "" && name.startsWith(nameNeedle)) ||
      (slugNeedle !== "" && slug.startsWith(slugNeedle));
    const contains =
      (nameNeedle !== "" && name.includes(nameNeedle)) ||
      (slugNeedle !== "" && slug.includes(slugNeedle));
    let rank: AccountNameRank | null = null;
    if (exact) rank = "exact";
    else if (prefix) rank = "prefix";
    else if (contains) rank = "contains";
    if (rank) hits.push({ account, rank });
  }

  hits.sort((a, b) => {
    const byRank = NAME_RANK_ORDER[a.rank] - NAME_RANK_ORDER[b.rank];
    if (byRank !== 0) return byRank;
    return a.account.name.localeCompare(b.account.name);
  });
  return hits;
}

export interface AccountBalanceDelta {
  accountId: string;
  deltaCents: number;
}

export interface AccountDeletionPlan {
  transactionIds: string[];
  valuationIds: string[];
  incomeExpenseCount: number;
  transferCount: number;
  balanceDeltas: AccountBalanceDelta[];
}

export function planAccountDeletion(
  accountId: string,
  transactions: Transaction[],
  valuationLogs: ValuationLog[],
): AccountDeletionPlan {
  const transactionIds: string[] = [];
  let incomeExpenseCount = 0;
  let transferCount = 0;
  const deltas = new Map<string, number>();

  for (const transaction of transactions) {
    const onSource = transaction.accountId === accountId;
    const onDest = transaction.toAccountId === accountId;
    if (!onSource && !onDest) continue;

    transactionIds.push(transaction.id);
    if (transaction.kind !== "transfer") {
      incomeExpenseCount += 1;
      continue;
    }

    transferCount += 1;
    if (onSource && transaction.toAccountId && transaction.toAccountId !== accountId) {
      const id = transaction.toAccountId;
      deltas.set(id, (deltas.get(id) ?? 0) - transaction.amountCents);
    }
    if (onDest && transaction.accountId !== accountId) {
      const id = transaction.accountId;
      deltas.set(id, (deltas.get(id) ?? 0) + transaction.amountCents);
    }
  }

  return {
    transactionIds,
    valuationIds: valuationLogs.filter((log) => log.accountId === accountId).map((log) => log.id),
    incomeExpenseCount,
    transferCount,
    balanceDeltas: [...deltas.entries()]
      .filter(([, deltaCents]) => deltaCents !== 0)
      .map(([id, deltaCents]) => ({ accountId: id, deltaCents })),
  };
}

export interface TransferDestinationSuggestion {
  toAccountId: string;
  description?: string;
}

export function suggestTransferDestination(
  fromAccountId: string,
  amountCents: number,
  transactions: Transaction[],
  accounts: Account[],
): TransferDestinationSuggestion | undefined {
  const activeIds = new Set(
    accounts.filter((account) => !account.isArchived).map((account) => account.id),
  );
  const outgoing = transactions.filter(
    (transaction) =>
      transaction.kind === "transfer" &&
      transaction.accountId === fromAccountId &&
      transaction.toAccountId &&
      transaction.toAccountId !== fromAccountId &&
      activeIds.has(transaction.toAccountId),
  );
  const recent = [...outgoing].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    return b.createdAt.localeCompare(a.createdAt);
  });
  const chosen = recent.find((transaction) => transaction.amountCents === amountCents) ?? recent[0];
  if (chosen?.toAccountId) {
    const description = chosen.description.trim();
    return { toAccountId: chosen.toAccountId, description: description || undefined };
  }

  const others = accounts.filter((account) => !account.isArchived && account.id !== fromAccountId);
  if (others.length === 1) return { toAccountId: others[0].id };
  return undefined;
}

export function formatAccountLabel(
  transaction: Transaction,
  accountById: (id: string) => Account | undefined,
): string {
  const from = accountById(transaction.accountId)?.name ?? "Account";
  if (transaction.kind !== "transfer") return from;
  const to = transaction.toAccountId ? (accountById(transaction.toAccountId)?.name ?? "Account") : "Account";
  return `${from} → ${to}`;
}
