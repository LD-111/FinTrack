import { describe, expect, it } from "vitest";
import { planSessionImport } from "@/lib/excel";
import {
  describeHandoff,
  handoffSeed,
  handoffUrl,
  parseHandoffTarget,
  readHandoffBody,
  readHandoffResult,
} from "@/lib/handoff";
import { makeAccount, makeCategory, makeTransaction } from "@/test/fixtures";

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("handoff address", () => {
  it("reads a full link and a typed address with a separate code", () => {
    expect(parseHandoffTarget(handoffUrl("192.168.1.20", 48721, TOKEN))).toEqual({
      host: "192.168.1.20",
      port: 48721,
      token: TOKEN,
    });
    expect(parseHandoffTarget("192.168.1.20:48721", TOKEN.toUpperCase())).toEqual({
      host: "192.168.1.20",
      port: 48721,
      token: TOKEN,
    });
    expect(parseHandoffTarget("https://192.168.1.20:48721", TOKEN)).toBeNull();
    expect(parseHandoffTarget("192.168.1.20:48721", "short")).toBeNull();
  });
});

describe("handoff seed", () => {
  it("returns desktop accounts and categories the phone does not already have", () => {
    const cash = makeAccount({ id: "acct_cash", name: "Cash" });
    const checking = makeAccount({ id: "acct_checking", name: "Checking" });
    const food = makeCategory({ id: "cat_food", name: "Food", kind: "expense" });
    const rent = makeCategory({ id: "cat_rent", name: "Rent", kind: "expense" });
    const desktop = {
      accounts: [cash, checking],
      categories: [food, rent],
      transactions: [],
      budgets: [],
      valuationLogs: [],
    };
    const phone = {
      accounts: [cash],
      categories: [food],
      transactions: [],
      budgets: [],
      valuationLogs: [],
    };

    expect(handoffSeed(desktop, phone)).toEqual({ accounts: [checking], categories: [rent] });
  });
});

describe("handoff body", () => {
  it("drops an invalid meal and plans the valid one", () => {
    const account = makeAccount({ id: "acct_cash", name: "Cash", type: "cash", slug: "cash" });
    const category = makeCategory({ id: "cat_food", name: "Food", kind: "expense" });
    const dinner = makeTransaction({
      id: "tx_dinner",
      accountId: account.id,
      categoryId: category.id,
      amountCents: 4_200,
      description: "Dinner",
      date: "2026-10-16",
    });
    const read = readHandoffBody({
      accounts: [account],
      categories: [category],
      transactions: [dinner, { ...dinner, id: "tx_bad", date: "2026-13-40" }],
      budgets: [],
      valuationLogs: [],
    });

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.issues).toEqual([{ sheet: "Transactions", row: 2, reason: "Need a date" }]);
    const plan = planSessionImport(
      read.snapshot,
      { accounts: [], categories: [], transactions: [], budgets: [], valuationLogs: [] },
      account.id,
    );
    expect(plan.transactions.map((row) => row.id)).toEqual(["tx_dinner"]);
  });

  it("rejects a ledger that is not a snapshot", () => {
    expect(readHandoffBody({ transactions: "lunch" })).toEqual({
      ok: false,
      reason: "Could not read this ledger",
    });
  });
});

describe("handoff result", () => {
  it("reads the accounts the computer sends back and surfaces a decline", () => {
    const cash = makeAccount({ id: "acct_cash", name: "Cash" });
    const accepted = readHandoffResult(200, JSON.stringify({ ok: true, accounts: [cash], categories: [] }));
    expect(accepted).toEqual({ ok: true, accounts: [cash], categories: [] });
    expect(readHandoffResult(409, JSON.stringify({ ok: false, reason: "The computer declined the transfer" }))).toEqual({
      ok: false,
      reason: "The computer declined the transfer",
    });
    expect(readHandoffResult(503, "")).toEqual({ ok: false, reason: "The computer closed the session." });
  });
});

describe("describeHandoff", () => {
  it("asks before adding rows or sending accounts, and skips a repeated transfer", () => {
    expect(
      describeHandoff({
        add: { accounts: 0, categories: 0, transactions: 1, budgets: 0, valuations: 0 },
        issueNote: null,
        seedAccounts: 2,
        seedCategories: 0,
      }),
    ).toMatchObject({
      title: "Add 1 transaction on this computer",
      description: "Send 2 accounts to the phone",
      needsConfirm: true,
      seedLabel: "2 accounts",
    });
    expect(
      describeHandoff({
        add: { accounts: 0, categories: 0, transactions: 0, budgets: 0, valuations: 0 },
        issueNote: null,
        seedAccounts: 0,
        seedCategories: 0,
      }).needsConfirm,
    ).toBe(false);
  });
});
