export type CategoryKind = "expense" | "income";
export type BudgetPeriod = "monthly";
export type AppView = "dashboard" | "transactions" | "budgets";
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

export interface Transaction {
  id: string;
  amountCents: number;
  kind: CategoryKind;
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
}

export type ParsedQuickAdd =
  | {
      ok: true;
      amountCents: number;
      kind: CategoryKind;
      description: string;
      merchantKey: string;
      categoryToken?: string;
      date: string;
    }
  | { ok: false; reason: string };

export interface QuickAddPreview {
  raw: string;
  valid: boolean;
  reason?: string;
  amountCents?: number;
  kind?: CategoryKind;
  description?: string;
  merchantKey?: string;
  categoryId?: string;
  categoryName?: string;
  categorySource?: CategorySource;
  date?: string;
}

export type QuickAddResult =
  | { ok: true; transaction: Transaction }
  | { ok: false; reason: string };

export const UNCATEGORIZED_ID = "cat_uncategorized";
