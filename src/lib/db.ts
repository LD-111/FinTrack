import Dexie, { type EntityTable } from "dexie";
import {
  DEFAULT_ACCOUNT_ID,
  TRANSFER_CATEGORY_ID,
  type Account,
  type AppSettings,
  type Budget,
  type Category,
  type MerchantMemory,
  type Transaction,
  type ValuationLog,
} from "@/lib/types";

class FinTrackDB extends Dexie {
  accounts!: EntityTable<Account, "id">;
  categories!: EntityTable<Category, "id">;
  transactions!: EntityTable<Transaction, "id">;
  budgets!: EntityTable<Budget, "id">;
  merchantMemory!: EntityTable<MerchantMemory, "id">;
  settings!: EntityTable<AppSettings, "id">;
  valuationLogs!: EntityTable<ValuationLog, "id">;

  constructor() {
    super("fintrack");
    this.version(1).stores({
      categories: "id, kind, parentId, name",
      transactions: "id, date, categoryId, merchantKey, kind, createdAt",
      budgets: "id, categoryId",
      merchantMemory: "id, merchantKey, categoryId",
      settings: "id",
    });
    this.version(2)
      .stores({
        accounts: "id, type, slug, name",
        categories: "id, kind, parentId, name",
        transactions: "id, date, categoryId, merchantKey, kind, accountId, toAccountId, createdAt",
        budgets: "id, categoryId",
        merchantMemory: "id, merchantKey, categoryId",
        settings: "id",
      })
      .upgrade(async (trans) => {
        const stamp = new Date().toISOString();
        await trans.table("accounts").put({
          id: DEFAULT_ACCOUNT_ID,
          name: "Cash",
          type: "cash",
          slug: "cash",
          openingBalanceCents: 0,
          isArchived: false,
          createdAt: stamp,
          updatedAt: stamp,
        } satisfies Account);
        await trans.table("transactions").toCollection().modify((row: { accountId?: string }) => {
          if (!row.accountId) {
            row.accountId = DEFAULT_ACCOUNT_ID;
          }
        });
        const transfer = await trans.table("categories").get(TRANSFER_CATEGORY_ID);
        if (!transfer) {
          await trans.table("categories").put({
            id: TRANSFER_CATEGORY_ID,
            name: "Transfer",
            kind: "expense",
            color: "#64748b",
            icon: "ArrowLeftRight",
            parentId: null,
            isArchived: true,
            createdAt: stamp,
          } satisfies Category);
        }
        const settings = await trans.table("settings").get("default");
        if (settings) {
          await trans.table("settings").put({ ...settings, defaultAccountId: DEFAULT_ACCOUNT_ID });
        }
      });
    this.version(3).stores({
      accounts: "id, type, slug, name",
      categories: "id, kind, parentId, name",
      transactions: "id, date, categoryId, merchantKey, kind, accountId, toAccountId, createdAt",
      budgets: "id, categoryId",
      merchantMemory: "id, merchantKey, categoryId",
      settings: "id",
      valuationLogs: "id, accountId, date, createdAt",
    });
  }
}

export const db = new FinTrackDB();
