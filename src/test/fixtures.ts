import type { Account, Category, Transaction, ValuationLog } from "@/lib/types";

export const FIXTURE_STAMP = "2026-10-15T12:00:00.000Z";

export function makeAccount(overrides: Partial<Account> & Pick<Account, "id" | "name">): Account {
  return {
    type: "bank",
    slug: overrides.name.trim().toLowerCase(),
    openingBalanceCents: 0,
    isArchived: false,
    createdAt: FIXTURE_STAMP,
    updatedAt: FIXTURE_STAMP,
    ...overrides,
  };
}

export function makeCategory(
  overrides: Partial<Category> & Pick<Category, "id" | "name" | "kind">,
): Category {
  return {
    color: "#64748b",
    parentId: null,
    isArchived: false,
    createdAt: FIXTURE_STAMP,
    ...overrides,
  };
}

export function makeTransaction(
  overrides: Partial<Transaction> & Pick<Transaction, "id">,
): Transaction {
  return {
    amountCents: 100,
    kind: "expense",
    accountId: "acct_cash",
    description: "Lunch",
    merchantKey: "lunch",
    categoryId: "cat_food",
    date: "2026-10-15",
    createdAt: FIXTURE_STAMP,
    updatedAt: FIXTURE_STAMP,
    ...overrides,
  };
}

export function makeValuation(
  overrides: Partial<ValuationLog> & Pick<ValuationLog, "id" | "accountId" | "valueCents" | "date">,
): ValuationLog {
  return {
    createdAt: FIXTURE_STAMP,
    ...overrides,
  };
}
