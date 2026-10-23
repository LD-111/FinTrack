import { UNCATEGORIZED_ID, type Category, type CategorySource, type MerchantMemory } from "@/lib/types";

export interface CategoryResolution {
  categoryId: string;
  source: CategorySource;
}

export function matchCategoryToken(token: string, categories: Category[]): Category | undefined {
  const needle = token.trim().toLowerCase();
  if (!needle) return undefined;

  const active = categories.filter((category) => !category.isArchived);
  return (
    active.find((category) => category.name.toLowerCase() === needle) ??
    active.find((category) => category.name.toLowerCase().startsWith(needle))
  );
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
          memory.merchantKey.includes(input.merchantKey) ||
          input.merchantKey.includes(memory.merchantKey),
      )
      .sort((a, b) => b.hitCount - a.hitCount)[0];

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
