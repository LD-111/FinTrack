import { describe, expect, it } from "vitest";
import { buildWorkbook, planWorkbookImport, type LedgerSnapshot } from "@/lib/excel";
import { makeAccount, makeCategory, makeTransaction } from "@/test/fixtures";

describe("planWorkbookImport", () => {
  it("inserts a new account and transaction, then skips those ids on a second plan", () => {
    const account = makeAccount({
      id: "acct_broker",
      name: "Brokerage",
      type: "investment",
      slug: "brokerage",
      openingBalanceCents: 25_000,
    });
    const category = makeCategory({ id: "cat_food", name: "Food", kind: "expense" });
    const transaction = makeTransaction({
      id: "tx_lunch",
      accountId: account.id,
      categoryId: category.id,
      amountCents: 1_250,
      description: "Lunch",
      date: "2026-10-15",
    });
    const ledger: LedgerSnapshot = {
      accounts: [account],
      categories: [category],
      transactions: [transaction],
      budgets: [],
      valuationLogs: [],
    };
    const empty: LedgerSnapshot = {
      accounts: [],
      categories: [],
      transactions: [],
      budgets: [],
      valuationLogs: [],
    };

    const bytes = buildWorkbook(ledger);
    const first = planWorkbookImport(bytes, empty, account.id);

    expect(first.issues).toEqual([]);
    expect(first.accounts.map((row) => row.id)).toEqual([account.id]);
    expect(first.accounts[0]?.openingBalanceCents).toBe(25_000);
    expect(first.transactions).toHaveLength(1);
    expect(first.transactions[0]).toMatchObject({
      id: transaction.id,
      amountCents: 1_250,
      description: "Lunch",
      accountId: account.id,
      categoryId: category.id,
    });
    expect(first.skipped.accounts).toBe(0);
    expect(first.skipped.transactions).toBe(0);

    const second = planWorkbookImport(bytes, ledger, account.id);

    expect(second.accounts).toHaveLength(0);
    expect(second.categories).toHaveLength(0);
    expect(second.transactions).toHaveLength(0);
    expect(second.skipped.accounts).toBe(1);
    expect(second.skipped.categories).toBe(1);
    expect(second.skipped.transactions).toBe(1);
  });
});
