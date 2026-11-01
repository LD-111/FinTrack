// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planAccountDeletion } from "@/lib/accounts";
import { FinanceProvider, useFinance, type FinanceContextValue } from "@/context/FinanceContext";
import { db } from "@/lib/db";
import { subscribeToasts } from "@/lib/toast";
import { DEFAULT_ACCOUNT_ID, UNCATEGORIZED_ID, type Account } from "@/lib/types";

function Reader({ slot }: { slot: { current: FinanceContextValue | null } }) {
  slot.current = useFinance();
  return null;
}

async function mountFinance() {
  const slot: { current: FinanceContextValue | null } = { current: null };
  render(
    <FinanceProvider>
      <Reader slot={slot} />
    </FinanceProvider>,
  );
  await waitFor(() => {
    expect(slot.current?.hydrated).toBe(true);
  });
  return slot;
}

function financeOf(slot: { current: FinanceContextValue | null }): FinanceContextValue {
  if (!slot.current) throw new Error("FinanceProvider is not mounted");
  return slot.current;
}

function balanceCents(finance: FinanceContextValue, accountId: string): number {
  const row = finance.accountBalances.find((item) => item.account.id === accountId);
  if (!row) throw new Error(`No balance for ${accountId}`);
  return row.balanceCents;
}

async function createAccount(
  slot: { current: FinanceContextValue | null },
  input: { name: string; type: Account["type"]; openingBalanceCents?: number },
): Promise<Account> {
  const created = await act(() => financeOf(slot).createAccount(input));
  if (!created) throw new Error(`expected ${input.name.trim() || "account"}`);
  return created;
}

// The default delete() disables auto-open, so the next hydrate stays on DatabaseClosedError.
async function resetDatabase() {
  await db.delete({ disableAutoOpen: false });
}

beforeEach(resetDatabase);

afterEach(async () => {
  cleanup();
  await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.budgets.toArray(),
    db.merchantMemory.toArray(),
    db.settings.toArray(),
    db.valuationLogs.toArray(),
  ]);
  await resetDatabase();
});

describe("FinanceProvider accounts", () => {
  it("creates Checking with an opening balance and a distinct slug for a duplicate name", async () => {
    const slot = await mountFinance();
    const first = await createAccount(slot, {
      name: "Checking",
      type: "bank",
      openingBalanceCents: 5_000,
    });
    const second = await createAccount(slot, { name: "Checking", type: "bank" });

    expect(first).toMatchObject({ name: "Checking", slug: "checking", openingBalanceCents: 5_000 });
    expect(second).toMatchObject({ name: "Checking", slug: "checking 2" });
    expect(financeOf(slot).accounts.map((account) => account.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    expect(await db.accounts.get(first.id)).toMatchObject({ openingBalanceCents: 5_000 });
  });

  it("returns null for a blank name", async () => {
    const slot = await mountFinance();
    const created = await act(() => financeOf(slot).createAccount({ name: "   ", type: "bank" }));

    expect(created).toBeNull();
    expect(financeOf(slot).accounts).toHaveLength(1);
  });
});

describe("FinanceProvider quick add", () => {
  it("records an expense on Cash", async () => {
    const slot = await mountFinance();
    let transactionId = "";

    act(() => {
      const result = financeOf(slot).addTransactionFromQuickAdd("12 lunch @food");
      if (!result.ok) throw new Error(result.reason);
      transactionId = result.transaction.id;
      expect(result.transaction).toMatchObject({
        kind: "expense",
        amountCents: 1_200,
        accountId: DEFAULT_ACCOUNT_ID,
        categoryId: "cat_food",
        description: "lunch",
      });
    });

    const finance = financeOf(slot);
    expect(finance.transactions.some((transaction) => transaction.id === transactionId)).toBe(true);
    expect(finance.monthSummary).toMatchObject({ incomeCents: 0, expenseCents: 1_200 });
    expect(balanceCents(finance, DEFAULT_ACCOUNT_ID)).toBe(-1_200);
  });

  it("records salary text as income", async () => {
    const slot = await mountFinance();

    act(() => {
      const result = financeOf(slot).addTransactionFromQuickAdd("+2000 salary");
      if (!result.ok) throw new Error(result.reason);
      expect(result.transaction).toMatchObject({
        kind: "income",
        amountCents: 200_000,
        categoryId: UNCATEGORIZED_ID,
        description: "salary",
      });
    });

    const finance = financeOf(slot);
    expect(finance.monthSummary).toMatchObject({ incomeCents: 200_000, expenseCents: 0 });
    expect(balanceCents(finance, DEFAULT_ACCOUNT_ID)).toBe(200_000);
  });

  it("records a refund that raises the balance and lowers spent", async () => {
    const slot = await mountFinance();

    act(() => {
      const result = financeOf(slot).addTransactionFromQuickAdd("+12 lunch @food");
      if (!result.ok) throw new Error(result.reason);
      expect(result.transaction.kind).toBe("refund");
      expect(result.transaction.categoryId).toBe("cat_food");
    });

    const finance = financeOf(slot);
    expect(finance.monthSummary).toMatchObject({ incomeCents: 0, expenseCents: -1_200 });
    expect(balanceCents(finance, DEFAULT_ACCOUNT_ID)).toBe(1_200);
  });

  it("moves a transfer between accounts without changing income or spent", async () => {
    const slot = await mountFinance();
    const destination = await createAccount(slot, { name: "Checking", type: "bank" });

    act(() => {
      const result = financeOf(slot).addTransactionFromQuickAdd("200 #cash -> #checking");
      if (!result.ok) throw new Error(result.reason);
      expect(result.transaction).toMatchObject({
        kind: "transfer",
        amountCents: 20_000,
        accountId: DEFAULT_ACCOUNT_ID,
        toAccountId: destination.id,
      });
    });

    const finance = financeOf(slot);
    expect(finance.monthSummary).toMatchObject({ incomeCents: 0, expenseCents: 0 });
    expect(balanceCents(finance, DEFAULT_ACCOUNT_ID)).toBe(-20_000);
    expect(balanceCents(finance, destination.id)).toBe(20_000);
  });
});

describe("FinanceProvider category changes", () => {
  it("keeps an expense an expense when the category becomes Salary", async () => {
    const slot = await mountFinance();
    let transactionId = "";

    act(() => {
      const result = financeOf(slot).addTransactionFromQuickAdd("12 lunch @food");
      if (!result.ok) throw new Error(result.reason);
      transactionId = result.transaction.id;
    });

    await act(async () => {
      await financeOf(slot).updateTransaction(transactionId, { categoryId: "cat_salary" });
    });

    expect(financeOf(slot).transactions.find((transaction) => transaction.id === transactionId)).toMatchObject({
      kind: "expense",
      categoryId: "cat_salary",
    });
    expect(financeOf(slot).monthSummary).toMatchObject({ incomeCents: 0, expenseCents: 1_200 });
  });

  it("turns a refund into income when the category becomes Salary", async () => {
    const slot = await mountFinance();
    let transactionId = "";

    act(() => {
      const result = financeOf(slot).addTransactionFromQuickAdd("+12 lunch @food");
      if (!result.ok) throw new Error(result.reason);
      transactionId = result.transaction.id;
    });

    await act(async () => {
      await financeOf(slot).updateTransaction(transactionId, { categoryId: "cat_salary" });
    });

    expect(financeOf(slot).transactions.find((transaction) => transaction.id === transactionId)?.kind).toBe("income");
    expect(financeOf(slot).monthSummary).toMatchObject({ incomeCents: 1_200, expenseCents: 0 });
  });
});

describe("FinanceProvider archive and delete", () => {
  it("refuses to archive the last active account", async () => {
    const slot = await mountFinance();

    await act(async () => {
      await financeOf(slot).archiveAccount(DEFAULT_ACCOUNT_ID);
    });

    expect(financeOf(slot).accounts.find((account) => account.id === DEFAULT_ACCOUNT_ID)?.isArchived).toBe(false);
  });

  it("deletes Checking, its transactions and valuations, and applies the planned Cash balance change", async () => {
    const slot = await mountFinance();
    const removed = await createAccount(slot, { name: "Checking", type: "bank" });

    let expenseId = "";
    let transferId = "";
    act(() => {
      const expense = financeOf(slot).addTransactionFromQuickAdd("15 coffee #checking @food");
      if (!expense.ok) throw new Error(expense.reason);
      expenseId = expense.transaction.id;
      const transfer = financeOf(slot).addTransactionFromQuickAdd("200 #cash -> #checking");
      if (!transfer.ok) throw new Error(transfer.reason);
      transferId = transfer.transaction.id;
    });

    let logId = "";
    await act(async () => {
      const log = await financeOf(slot).addValuationLog({
        accountId: removed.id,
        valueCents: 50_000,
        date: "2026-10-01",
      });
      if (!log) throw new Error("expected valuation");
      logId = log.id;
    });

    await waitFor(async () => {
      expect(await db.transactions.get(expenseId)).toBeTruthy();
      expect(await db.transactions.get(transferId)).toBeTruthy();
    });

    const finance = financeOf(slot);
    const before = balanceCents(finance, DEFAULT_ACCOUNT_ID);
    const planned = planAccountDeletion(removed.id, finance.transactions, finance.valuationLogs);
    expect(planned.transactionIds).toEqual(expect.arrayContaining([expenseId, transferId]));
    expect(planned.valuationIds).toEqual([logId]);
    expect(planned.balanceDeltas).toEqual([{ accountId: DEFAULT_ACCOUNT_ID, deltaCents: 20_000 }]);

    await act(async () => {
      expect(await financeOf(slot).deleteAccount(removed.id)).toBe(true);
    });

    const after = financeOf(slot);
    expect(after.accounts.some((account) => account.id === removed.id)).toBe(false);
    expect(after.transactions.some((transaction) => transaction.id === expenseId || transaction.id === transferId)).toBe(
      false,
    );
    expect(after.valuationLogs.some((log) => log.id === logId)).toBe(false);
    expect(balanceCents(after, DEFAULT_ACCOUNT_ID)).toBe(before + 20_000);
    expect(await db.accounts.get(removed.id)).toBeUndefined();
    expect(await db.transactions.get(expenseId)).toBeUndefined();
    expect(await db.transactions.get(transferId)).toBeUndefined();
    expect(await db.valuationLogs.get(logId)).toBeUndefined();
  });
});

describe("FinanceProvider portfolio", () => {
  it("logs a value and keeps a later transfer out of the gain", async () => {
    const slot = await mountFinance();
    const brokerage = await createAccount(slot, {
      name: "Brokerage",
      type: "investment",
      openingBalanceCents: 10_000,
    });

    await act(async () => {
      const log = await financeOf(slot).addValuationLog({
        accountId: brokerage.id,
        valueCents: 11_000,
        date: "2000-01-01",
      });
      expect(log?.valueCents).toBe(11_000);
    });

    const beforeTransfer = financeOf(slot).portfolioSnapshots.find((item) => item.account.id === brokerage.id);
    expect(beforeTransfer).toMatchObject({
      currentValueCents: 11_000,
      investedPrincipalCents: 10_000,
      profitCents: 1_000,
    });
    expect(beforeTransfer?.twrRatio).toBeCloseTo(0.1);

    act(() => {
      const transfer = financeOf(slot).addTransactionFromQuickAdd(`110 #cash -> #${brokerage.slug}`);
      if (!transfer.ok) throw new Error(transfer.reason);
    });

    const afterTransfer = financeOf(slot).portfolioSnapshots.find((item) => item.account.id === brokerage.id);
    expect(afterTransfer).toMatchObject({
      currentValueCents: 22_000,
      investedPrincipalCents: 21_000,
      profitCents: 1_000,
    });
    expect(afterTransfer?.twrRatio).toBeCloseTo(0.1);
    expect(balanceCents(financeOf(slot), brokerage.id)).toBe(22_000);
  });
});

describe("FinanceProvider undo", () => {
  it("removes the transaction Quick Add just wrote", async () => {
    const slot = await mountFinance();
    let transactionId = "";

    act(() => {
      const result = financeOf(slot).addTransactionFromQuickAdd("12 lunch @food");
      if (!result.ok) throw new Error(result.reason);
      transactionId = result.transaction.id;
    });

    await waitFor(async () => {
      expect(await db.transactions.get(transactionId)).toBeTruthy();
    });
    await waitFor(async () => {
      expect(await financeOf(slot).undo()).toBe(true);
    });
    await waitFor(() => {
      expect(financeOf(slot).transactions.some((transaction) => transaction.id === transactionId)).toBe(false);
    });
    expect(await db.transactions.get(transactionId)).toBeUndefined();
  });

  it("stores chip overrides on one undo step and sorts a backdated row below a later date", async () => {
    const slot = await mountFinance();

    act(() => {
      const today = financeOf(slot).addTransactionFromQuickAdd("12 today-lunch");
      if (!today.ok) throw new Error(today.reason);
      const older = financeOf(slot).addTransactionFromQuickAdd("12 old-lunch", {
        categoryId: "cat_food",
        date: "2000-01-01",
      });
      if (!older.ok) throw new Error(older.reason);
      expect(older.transaction).toMatchObject({
        categoryId: "cat_food",
        date: "2000-01-01",
        description: "old-lunch",
        kind: "expense",
      });
    });

    expect(financeOf(slot).transactions.map((transaction) => transaction.description)).toEqual([
      "today-lunch",
      "old-lunch",
    ]);

    await act(async () => {
      expect(await financeOf(slot).undo()).toBe(true);
      expect(await financeOf(slot).undo()).toBe(true);
      expect(await financeOf(slot).undo()).toBe(false);
    });
    expect(financeOf(slot).transactions).toHaveLength(0);
  });

  it("does not insert a second budget when the same cap is saved twice", async () => {
    const slot = await mountFinance();

    await act(async () => {
      await financeOf(slot).upsertBudget("cat_food", 1_000);
      await financeOf(slot).upsertBudget("cat_food", 1_000);
    });

    expect(financeOf(slot).budgets.filter((budget) => budget.categoryId === "cat_food")).toHaveLength(1);
    await act(async () => {
      expect(await financeOf(slot).undo()).toBe(true);
      expect(await financeOf(slot).undo()).toBe(false);
    });
    expect(financeOf(slot).budgets.some((budget) => budget.categoryId === "cat_food")).toBe(false);
  });

  it("does not duplicate a deleted transaction when toast undo is followed by Ctrl+Z", async () => {
    const slot = await mountFinance();
    let transactionId = "";

    act(() => {
      const result = financeOf(slot).addTransactionFromQuickAdd("12 lunch @food");
      if (!result.ok) throw new Error(result.reason);
      transactionId = result.transaction.id;
    });
    await act(async () => {
      await financeOf(slot).deleteTransaction(transactionId);
    });

    let undoToast: (() => void) | undefined;
    const stop = subscribeToasts((items) => {
      undoToast = items.find((item) => item.title === "Deleted")?.action?.onClick;
    });
    expect(undoToast).toBeTypeOf("function");
    await act(async () => {
      undoToast?.();
    });
    stop();

    expect(financeOf(slot).transactions.filter((transaction) => transaction.id === transactionId)).toHaveLength(1);
    await act(async () => {
      expect(await financeOf(slot).undo()).toBe(true);
    });
    expect(financeOf(slot).transactions.filter((transaction) => transaction.id === transactionId)).toHaveLength(0);
  });

  it("restores merchant memory when a category edit is undone", async () => {
    const slot = await mountFinance();
    let transactionId = "";

    act(() => {
      const result = financeOf(slot).addTransactionFromQuickAdd("12 lunch @food");
      if (!result.ok) throw new Error(result.reason);
      transactionId = result.transaction.id;
    });
    await waitFor(() => {
      expect(
        financeOf(slot).merchantMemory.some(
          (memory) => memory.merchantKey === "lunch" && memory.categoryId === "cat_food",
        ),
      ).toBe(true);
    });

    await act(async () => {
      await financeOf(slot).updateTransaction(transactionId, { categoryId: "cat_groceries" });
    });
    expect(financeOf(slot).transactions.find((transaction) => transaction.id === transactionId)?.categoryId).toBe(
      "cat_groceries",
    );
    expect(financeOf(slot).merchantMemory.find((memory) => memory.merchantKey === "lunch")?.categoryId).toBe(
      "cat_groceries",
    );

    await act(async () => {
      expect(await financeOf(slot).undo()).toBe(true);
    });
    expect(financeOf(slot).transactions.find((transaction) => transaction.id === transactionId)?.categoryId).toBe(
      "cat_food",
    );
    expect(financeOf(slot).merchantMemory.find((memory) => memory.merchantKey === "lunch")?.categoryId).toBe(
      "cat_food",
    );
  });
});
