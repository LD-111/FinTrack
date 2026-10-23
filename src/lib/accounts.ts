import type { Account, AccountType, Transaction } from "@/lib/types";
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

export function matchAccountToken(token: string, accounts: Account[]): Account | undefined {
  const needle = token.trim().toLowerCase().replace(/^#/, "");
  if (!needle) return undefined;

  const active = accounts.filter((account) => !account.isArchived);
  const exact = active.find(
    (account) => account.slug === needle || account.name.toLowerCase() === needle,
  );
  if (exact) return exact;

  const prefixes = active.filter(
    (account) => account.slug.startsWith(needle) || account.name.toLowerCase().startsWith(needle),
  );
  return prefixes.length === 1 ? prefixes[0] : undefined;
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
