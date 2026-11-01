import { describe, expect, it } from "vitest";
import {
  isPortfolioAccount,
  matchAccountToken,
  matchAccountsByName,
  matchArchivedAccountToken,
  planAccountDeletion,
  suggestTransferDestination,
  uniqueAccountSlug,
} from "@/lib/accounts";
import { makeAccount, makeTransaction, makeValuation } from "@/test/fixtures";

describe("uniqueAccountSlug", () => {
  it("keeps the first slug and suffixes the copies", () => {
    const checking = makeAccount({ id: "1", name: "Checking", slug: "checking" });
    const checking2 = makeAccount({ id: "2", name: "Checking", slug: "checking 2" });

    expect(uniqueAccountSlug("Savings", [])).toBe("savings");
    expect(uniqueAccountSlug("Checking", [checking])).toBe("checking 2");
    expect(uniqueAccountSlug("Checking", [checking, checking2])).toBe("checking 3");
  });
});

describe("matchAccountToken", () => {
  const checking = makeAccount({ id: "checking", name: "Checking", slug: "checking" });
  const checkbook = makeAccount({ id: "checkbook", name: "Checkbook", slug: "checkbook" });
  const archived = makeAccount({
    id: "old",
    name: "Checking",
    slug: "checking",
    isArchived: true,
  });

  it("matches an exact token, then a unique prefix, and ignores archived accounts", () => {
    expect(matchAccountToken("#checking", [checking, checkbook])?.id).toBe("checking");
    expect(matchAccountToken("check", [checking])?.id).toBe("checking");
    expect(matchAccountToken("check", [checking, checkbook])).toBeUndefined();
    expect(matchAccountToken("checking", [archived])).toBeUndefined();
    expect(matchArchivedAccountToken("checking", [archived])?.id).toBe("old");
  });
});

describe("matchAccountsByName", () => {
  const checking = makeAccount({ id: "1", name: "Checking", slug: "checking" });
  const checkbook = makeAccount({ id: "2", name: "Checkbook", slug: "checkbook" });
  const archived = makeAccount({
    id: "3",
    name: "Blue check",
    slug: "blue check",
    isArchived: true,
  });

  it("ranks exact, then prefix, then substring, including archived accounts", () => {
    expect(matchAccountsByName("   ", [checking])).toEqual([]);
    expect(matchAccountsByName("check", [archived, checking, checkbook]).map((hit) => [hit.account.name, hit.rank])).toEqual([
      ["Checkbook", "prefix"],
      ["Checking", "prefix"],
      ["Blue check", "contains"],
    ]);
    expect(matchAccountsByName("Checking", [checking, checkbook, archived])[0]).toMatchObject({
      account: { id: "1" },
      rank: "exact",
    });
  });
});

describe("suggestTransferDestination", () => {
  const cash = makeAccount({ id: "cash", name: "Cash", type: "cash", slug: "cash" });
  const checking = makeAccount({ id: "checking", name: "Checking", slug: "checking" });
  const savings = makeAccount({ id: "savings", name: "Savings", type: "savings", slug: "savings" });
  const accounts = [cash, checking, savings];
  const sameAmount = makeTransaction({
    id: "same",
    kind: "transfer",
    amountCents: 500,
    accountId: "checking",
    toAccountId: "savings",
    description: "Rent",
    date: "2026-01-01",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const newer = makeTransaction({
    id: "newer",
    kind: "transfer",
    amountCents: 800,
    accountId: "checking",
    toAccountId: "cash",
    description: "Later",
    date: "2026-06-01",
    createdAt: "2026-06-01T00:00:00.000Z",
  });

  it("prefers the same amount, then the most recent, then the only other active account", () => {
    expect(suggestTransferDestination("checking", 500, [sameAmount, newer], accounts)).toEqual({
      toAccountId: "savings",
      description: "Rent",
    });
    expect(suggestTransferDestination("checking", 100, [sameAmount, newer], accounts)).toEqual({
      toAccountId: "cash",
      description: "Later",
    });
    expect(suggestTransferDestination("checking", 100, [], [checking, savings])).toEqual({
      toAccountId: "savings",
    });
    expect(suggestTransferDestination("checking", 100, [], accounts)).toBeUndefined();
  });

  it("skips an archived destination", () => {
    const closed = { ...savings, isArchived: true };
    const onlyHistory = makeTransaction({
      id: "old-dest",
      kind: "transfer",
      amountCents: 500,
      accountId: "checking",
      toAccountId: "savings",
      date: "2026-06-01",
    });

    expect(suggestTransferDestination("checking", 500, [onlyHistory], [cash, checking, closed])).toEqual({
      toAccountId: "cash",
    });
  });
});

describe("planAccountDeletion", () => {
  it("lists the rows to remove and the balance change on the account that remains", () => {
    const expense = makeTransaction({
      id: "expense",
      accountId: "checking",
      kind: "expense",
      amountCents: 1_500,
    });
    const incoming = makeTransaction({
      id: "incoming",
      kind: "transfer",
      amountCents: 20_000,
      accountId: "cash",
      toAccountId: "checking",
      categoryId: "cat_transfer",
    });
    const unrelated = makeTransaction({
      id: "unrelated",
      accountId: "cash",
      kind: "expense",
      amountCents: 100,
    });
    const log = makeValuation({
      id: "log",
      accountId: "checking",
      valueCents: 5_000,
      date: "2026-10-01",
    });

    expect(planAccountDeletion("checking", [expense, incoming, unrelated], [log])).toEqual({
      transactionIds: ["expense", "incoming"],
      valuationIds: ["log"],
      incomeExpenseCount: 1,
      transferCount: 1,
      balanceDeltas: [{ accountId: "cash", deltaCents: 20_000 }],
    });
  });
});

describe("isPortfolioAccount", () => {
  it("is true for investment, crypto, and stock", () => {
    expect(isPortfolioAccount({ type: "investment" })).toBe(true);
    expect(isPortfolioAccount({ type: "crypto" })).toBe(true);
    expect(isPortfolioAccount({ type: "stock" })).toBe(true);
    expect(isPortfolioAccount({ type: "bank" })).toBe(false);
    expect(isPortfolioAccount({ type: "cash" })).toBe(false);
    expect(isPortfolioAccount({ type: "savings" })).toBe(false);
  });
});
