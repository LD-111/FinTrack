export type CategoryKind = "expense" | "income";
export type TransactionKind = "expense" | "income" | "transfer";
export type AccountType = "bank" | "cash" | "savings" | "investment" | "crypto" | "stock";
export type BudgetPeriod = "monthly";
export type AppView = "dashboard" | "transactions" | "budgets";
export type DashboardTab = "cashflow" | "portfolio";
export type CategorySource = "explicit" | "memory" | "fuzzy" | "uncategorized";

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon?: string;
  parentId: string | null;
  isArchived: boolean;
  createdAt: string;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  slug: string;
  openingBalanceCents: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  amountCents: number;
  kind: TransactionKind;
  accountId: string;
  toAccountId?: string;
  description: string;
  merchantKey: string;
  categoryId: string;
  date: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Budget {
  id: string;
  categoryId: string;
  amountCents: number;
  period: BudgetPeriod;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantMemory {
  id: string;
  merchantKey: string;
  categoryId: string;
  hitCount: number;
  lastUsedAt: string;
}

export interface AppSettings {
  id: "default";
  currency: string;
  locale: string;
  weekStartsOn: 0 | 1;
  defaultAccountId: string;
}

export interface ValuationLog {
  id: string;
  accountId: string;
  valueCents: number;
  date: string;
  createdAt: string;
}

export interface PortfolioSnapshot {
  account: Account;
  investedPrincipalCents: number;
  currentValueCents: number;
  profitCents: number;
  twrRatio: number;
  lastValuation: ValuationLog | null;
}

export type ParsedQuickAdd =
  | {
      ok: true;
      amountCents: number;
      kind: TransactionKind;
      description: string;
      merchantKey: string;
      categoryToken?: string;
      accountToken?: string;
      toAccountToken?: string;
      date: string;
    }
  | { ok: false; reason: string };

export interface QuickAddPreview {
  raw: string;
  valid: boolean;
  reason?: string;
  amountCents?: number;
  kind?: TransactionKind;
  description?: string;
  merchantKey?: string;
  categoryId?: string;
  categoryName?: string;
  categorySource?: CategorySource;
  accountId?: string;
  accountName?: string;
  toAccountId?: string;
  toAccountName?: string;
  date?: string;
}

export type QuickAddResult =
  | { ok: true; transaction: Transaction }
  | { ok: false; reason: string };

export const UNCATEGORIZED_ID = "cat_uncategorized";
export const TRANSFER_CATEGORY_ID = "cat_transfer";
export const DEFAULT_ACCOUNT_ID = "acct_cash";
