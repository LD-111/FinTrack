import {
  UNCATEGORIZED_ID,
  type Category,
  type CategorySource,
  type MerchantMemory,
  type TransactionKind,
} from "@/lib/types";

export interface CategoryResolution {
  categoryId: string;
  source: CategorySource;
}

export function matchCategoryToken(token: string, categories: Category[]): Category | undefined {
  const needle = token.trim().toLowerCase();
  if (!needle) return undefined;

  const active = categories.filter((category) => !category.isArchived);
  const exact = active.find((category) => category.name.toLowerCase() === needle);
  if (exact) return exact;

  const prefixes = active.filter((category) => category.name.toLowerCase().startsWith(needle));
  return prefixes.length === 1 ? prefixes[0] : undefined;
}

const MIN_FUZZY_CHARS = 3;

function sharesPrefix(haystack: string, needle: string): boolean {
  if (needle.length < MIN_FUZZY_CHARS) return false;
  if (haystack.startsWith(needle)) return true;
  return haystack.split(" ").some((token) => token.startsWith(needle));
}

export function resolveCategory(input: {
  categoryToken?: string;
  merchantKey: string;
  categories: Category[];
  merchantMemory: MerchantMemory[];
}): CategoryResolution {
  if (input.categoryToken) {
    const explicit = matchCategoryToken(input.categoryToken, input.categories);
    if (explicit) {
      return { categoryId: explicit.id, source: "explicit" };
    }
  }

  if (input.merchantKey) {
    const memories = input.merchantMemory
      .filter((memory) => memory.merchantKey === input.merchantKey)
      .sort((a, b) => b.hitCount - a.hitCount || b.lastUsedAt.localeCompare(a.lastUsedAt));

    if (memories[0]) {
      return { categoryId: memories[0].categoryId, source: "memory" };
    }

    const fuzzy = input.merchantMemory
      .filter(
        (memory) =>
          sharesPrefix(memory.merchantKey, input.merchantKey) ||
          sharesPrefix(input.merchantKey, memory.merchantKey),
      )
      .sort(
        (a, b) =>
          b.merchantKey.length - a.merchantKey.length ||
          b.hitCount - a.hitCount ||
          b.lastUsedAt.localeCompare(a.lastUsedAt),
      )[0];

    if (fuzzy) {
      return { categoryId: fuzzy.categoryId, source: "fuzzy" };
    }
  }

  const uncategorized = input.categories.find((category) => category.id === UNCATEGORIZED_ID);
  return {
    categoryId: uncategorized?.id ?? UNCATEGORIZED_ID,
    source: "uncategorized",
  };
}

/** Active expense categories other than Uncategorized. Income and archived categories are not spending buckets. */
export function isSpendingCategory(category: Category | undefined): boolean {
  if (!category || category.isArchived) return false;
  if (category.id === UNCATEGORIZED_ID) return false;
  return category.kind === "expense";
}

/** Money in (`+`) reduces a spending category. Otherwise it is income. */
export function kindForMoneyIn(category: Category | undefined): "income" | "refund" {
  return isSpendingCategory(category) ? "refund" : "income";
}

/** Category edits keep the cash direction. Money out stays an expense; money in follows the new category. */
export function kindAfterCategoryChange(
  previousKind: TransactionKind,
  category: Category | undefined,
): TransactionKind {
  if (previousKind === "expense" || previousKind === "transfer") return previousKind;
  return kindForMoneyIn(category);
}
