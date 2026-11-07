import { describe, expect, it } from "vitest";
import { buildWorkbook, planSessionImport, planWorkbookImport, type LedgerSnapshot } from "@/lib/excel";
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

  it("inserts only the new meal when a phone export is planned onto the desktop ledger", () => {
    const account = makeAccount({ id: "acct_cash", name: "Cash", type: "cash", slug: "cash" });
    const category = makeCategory({ id: "cat_food", name: "Food", kind: "expense" });
    const lunch = makeTransaction({
      id: "tx_lunch",
      accountId: account.id,
      categoryId: category.id,
      amountCents: 1_250,
      description: "Lunch",
      date: "2026-10-15",
    });
    const dinner = makeTransaction({
      id: "tx_dinner",
      accountId: account.id,
      categoryId: category.id,
      amountCents: 4_200,
      description: "Dinner",
      date: "2026-10-16",
    });
    const desktop: LedgerSnapshot = {
      accounts: [account],
      categories: [category],
      transactions: [lunch],
      budgets: [],
      valuationLogs: [],
    };
    const phone: LedgerSnapshot = { ...desktop, transactions: [lunch, dinner] };

    const plan = planWorkbookImport(buildWorkbook(phone), desktop, account.id);

    expect(plan.issues).toEqual([]);
    expect(plan.accounts).toHaveLength(0);
    expect(plan.categories).toHaveLength(0);
    expect(plan.transactions.map((row) => row.id)).toEqual(["tx_dinner"]);
    expect(plan.transactions[0]).toMatchObject({ amountCents: 4_200, description: "Dinner" });
    expect(plan.skipped.transactions).toBe(1);
  });
});

describe("planSessionImport", () => {
  it("inserts only the new meal when a phone snapshot is planned onto the desktop ledger", () => {
    const account = makeAccount({ id: "acct_cash", name: "Cash", type: "cash", slug: "cash" });
    const category = makeCategory({ id: "cat_food", name: "Food", kind: "expense" });
    const lunch = makeTransaction({
      id: "tx_lunch",
      accountId: account.id,
      categoryId: category.id,
      amountCents: 1_250,
      description: "Lunch",
      date: "2026-10-15",
    });
    const dinner = makeTransaction({
      id: "tx_dinner",
      accountId: account.id,
      categoryId: category.id,
      amountCents: 4_200,
      description: "Dinner",
      date: "2026-10-16",
    });
    const desktop: LedgerSnapshot = {
      accounts: [account],
      categories: [category],
      transactions: [lunch],
      budgets: [],
      valuationLogs: [],
    };
    const phone: LedgerSnapshot = {
      ...desktop,
      transactions: [{ ...lunch, amountCents: 9_999 }, dinner],
    };

    const plan = planSessionImport(phone, desktop, account.id);

    expect(plan.issues).toEqual([]);
    expect(plan.accounts).toHaveLength(0);
    expect(plan.transactions.map((row) => row.id)).toEqual(["tx_dinner"]);
    expect(plan.transactions[0]).toMatchObject({ amountCents: 4_200, description: "Dinner" });
    expect(plan.skipped.transactions).toBe(1);

    const again = planSessionImport(phone, { ...desktop, transactions: [lunch, dinner] }, account.id);
    expect(again.transactions).toHaveLength(0);
    expect(again.skipped.transactions).toBe(2);
  });

  it("keeps the desktop account id when the phone used another id for the same name", () => {
    const desktopAccount = makeAccount({ id: "acct_cash", name: "Cash", type: "cash", slug: "cash" });
    const phoneAccount = makeAccount({ id: "phone_cash", name: "Cash", type: "cash", slug: "cash-phone" });
    const category = makeCategory({ id: "cat_food", name: "Food", kind: "expense" });
    const meal = makeTransaction({
      id: "tx_lunch",
      accountId: phoneAccount.id,
      categoryId: category.id,
      description: "Lunch",
    });
    const desktop: LedgerSnapshot = {
      accounts: [desktopAccount],
      categories: [category],
      transactions: [],
      budgets: [],
      valuationLogs: [],
    };
    const phone: LedgerSnapshot = {
      accounts: [phoneAccount],
      categories: [category],
      transactions: [meal],
      budgets: [],
      valuationLogs: [],
    };

    const plan = planSessionImport(phone, desktop, desktopAccount.id);

    expect(plan.accounts).toHaveLength(0);
    expect(plan.skipped.accounts).toBe(1);
    expect(plan.transactions[0]?.accountId).toBe(desktopAccount.id);
  });
});
