import Dexie, { type EntityTable } from "dexie";
import type { AppSettings, Budget, Category, MerchantMemory, Transaction } from "@/lib/types";

class FinTrackDB extends Dexie {
  categories!: EntityTable<Category, "id">;
  transactions!: EntityTable<Transaction, "id">;
  budgets!: EntityTable<Budget, "id">;
  merchantMemory!: EntityTable<MerchantMemory, "id">;
  settings!: EntityTable<AppSettings, "id">;

  constructor() {
    super("fintrack");
    this.version(1).stores({
      categories: "id, kind, parentId, name",
      transactions: "id, date, categoryId, merchantKey, kind, createdAt",
      budgets: "id, categoryId",
      merchantMemory: "id, merchantKey, categoryId",
      settings: "id",
    });
  }
}

export const db = new FinTrackDB();
