import { describe, expect, it } from "vitest";
import { kindAfterCategoryChange, kindForMoneyIn, resolveCategory } from "@/lib/categorizer";
import { makeCategory } from "@/test/fixtures";
import { UNCATEGORIZED_ID, type MerchantMemory } from "@/lib/types";

const food = makeCategory({ id: "cat_food", name: "Food", kind: "expense" });
const groceries = makeCategory({ id: "cat_groceries", name: "Groceries", kind: "expense" });
const salary = makeCategory({ id: "cat_salary", name: "Salary", kind: "income" });
const otherIncome = makeCategory({ id: "cat_other_income", name: "Other income", kind: "income" });
const uncategorized = makeCategory({ id: UNCATEGORIZED_ID, name: "Uncategorized", kind: "expense" });
const categories = [uncategorized, food, groceries, salary, otherIncome];

const starbucks: MerchantMemory = {
  id: "mem_starbucks",
  merchantKey: "starbucks",
  categoryId: groceries.id,
  hitCount: 4,
  lastUsedAt: "2026-10-01T00:00:00.000Z",
};

describe("resolveCategory", () => {
  it("prefers an explicit @token, then merchant memory, then a fuzzy key, then Uncategorized", () => {
    expect(
      resolveCategory({
        categoryToken: "food",
        merchantKey: "starbucks",
        categories,
        merchantMemory: [starbucks],
      }),
    ).toEqual({ categoryId: food.id, source: "explicit" });

    expect(
      resolveCategory({
        merchantKey: "starbucks",
        categories,
        merchantMemory: [starbucks],
      }),
    ).toEqual({ categoryId: groceries.id, source: "memory" });

    expect(
      resolveCategory({
        categoryToken: "nope",
        merchantKey: "starbucks",
        categories,
        merchantMemory: [starbucks],
      }),
    ).toEqual({ categoryId: groceries.id, source: "memory" });

    expect(
      resolveCategory({
        merchantKey: "star",
        categories,
        merchantMemory: [starbucks],
      }),
    ).toEqual({ categoryId: groceries.id, source: "fuzzy" });

    expect(
      resolveCategory({
        merchantKey: "unknown cafe",
        categories,
        merchantMemory: [starbucks],
      }),
    ).toEqual({ categoryId: UNCATEGORIZED_ID, source: "uncategorized" });
  });
});

describe("refund versus income", () => {
  it("treats money in on a spending category as a refund", () => {
    expect(kindForMoneyIn(food)).toBe("refund");
    expect(kindForMoneyIn(salary)).toBe("income");
    expect(kindForMoneyIn(otherIncome)).toBe("income");
    expect(kindForMoneyIn(uncategorized)).toBe("income");
    expect(kindForMoneyIn(undefined)).toBe("income");
    expect(kindForMoneyIn({ ...food, isArchived: true })).toBe("income");
  });

  it("keeps cash direction when the category changes", () => {
    expect(kindAfterCategoryChange("expense", salary)).toBe("expense");
    expect(kindAfterCategoryChange("expense", food)).toBe("expense");
    expect(kindAfterCategoryChange("income", food)).toBe("refund");
    expect(kindAfterCategoryChange("refund", salary)).toBe("income");
    expect(kindAfterCategoryChange("refund", otherIncome)).toBe("income");
    expect(kindAfterCategoryChange("refund", uncategorized)).toBe("income");
    expect(kindAfterCategoryChange("refund", food)).toBe("refund");
    expect(kindAfterCategoryChange("transfer", food)).toBe("transfer");
  });
});
