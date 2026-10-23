import { db } from "@/lib/db";
import { nowIso } from "@/lib/utils";
import { UNCATEGORIZED_ID, type AppSettings, type Category } from "@/lib/types";

export const DEFAULT_SETTINGS: AppSettings = {
  id: "default",
  currency: "USD",
  locale: "en-US",
  weekStartsOn: 0,
};

export const DEFAULT_CATEGORIES: Category[] = [
  { id: UNCATEGORIZED_ID, name: "Uncategorized", kind: "expense", color: "#94a3b8", icon: "CircleDashed", parentId: null, isArchived: false, createdAt: nowIso() },
  { id: "cat_food", name: "Food", kind: "expense", color: "#f97316", icon: "Utensils", parentId: null, isArchived: false, createdAt: nowIso() },
  { id: "cat_groceries", name: "Groceries", kind: "expense", color: "#84cc16", icon: "ShoppingBasket", parentId: null, isArchived: false, createdAt: nowIso() },
  { id: "cat_transport", name: "Transport", kind: "expense", color: "#3b82f6", icon: "Car", parentId: null, isArchived: false, createdAt: nowIso() },
  { id: "cat_housing", name: "Housing", kind: "expense", color: "#8b5cf6", icon: "Home", parentId: null, isArchived: false, createdAt: nowIso() },
  { id: "cat_utilities", name: "Utilities", kind: "expense", color: "#06b6d4", icon: "Zap", parentId: null, isArchived: false, createdAt: nowIso() },
  { id: "cat_health", name: "Health", kind: "expense", color: "#ef4444", icon: "HeartPulse", parentId: null, isArchived: false, createdAt: nowIso() },
  { id: "cat_entertainment", name: "Entertainment", kind: "expense", color: "#ec4899", icon: "Clapperboard", parentId: null, isArchived: false, createdAt: nowIso() },
  { id: "cat_shopping", name: "Shopping", kind: "expense", color: "#f59e0b", icon: "ShoppingBag", parentId: null, isArchived: false, createdAt: nowIso() },
  { id: "cat_subscriptions", name: "Subscriptions", kind: "expense", color: "#6366f1", icon: "Repeat", parentId: null, isArchived: false, createdAt: nowIso() },
  { id: "cat_other", name: "Other", kind: "expense", color: "#64748b", icon: "MoreHorizontal", parentId: null, isArchived: false, createdAt: nowIso() },
  { id: "cat_salary", name: "Salary", kind: "income", color: "#22c55e", icon: "Banknote", parentId: null, isArchived: false, createdAt: nowIso() },
  { id: "cat_other_income", name: "Other income", kind: "income", color: "#14b8a6", icon: "Coins", parentId: null, isArchived: false, createdAt: nowIso() },
];

export async function seedIfEmpty(): Promise<void> {
  const count = await db.categories.count();
  if (count > 0) {
    const settings = await db.settings.get("default");
    if (!settings) {
      await db.settings.put(DEFAULT_SETTINGS);
    }
    return;
  }

  await db.transaction("rw", db.categories, db.settings, async () => {
    await db.categories.bulkAdd(DEFAULT_CATEGORIES);
    await db.settings.put(DEFAULT_SETTINGS);
  });
}
