import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "@/lib/parser";
import { makeCategory } from "@/test/fixtures";

const TODAY = "2026-10-31";

function ok(raw: string) {
  const result = parseQuickAdd(raw, TODAY);
  if (!result.ok) throw new Error(`${raw}: ${result.reason}`);
  return result;
}

function fail(raw: string) {
  const result = parseQuickAdd(raw, TODAY);
  if (result.ok) throw new Error(`${raw} should fail`);
  return result;
}

describe("parseQuickAdd", () => {
  it("parses an expense with a category, an account, and either decimal mark", () => {
    expect(ok("12.50 lunch @food #cash")).toMatchObject({
      amountCents: 1250,
      kind: "expense",
      description: "lunch",
      merchantKey: "lunch",
      categoryToken: "food",
      accountToken: "cash",
      date: TODAY,
    });
    expect(ok("12,50 lunch")).toMatchObject({
      amountCents: 1250,
      kind: "expense",
      description: "lunch",
    });
  });

  it("keeps a leading + as money in, including when an account is named", () => {
    expect(ok("+12 paycheck")).toMatchObject({
      kind: "income",
      amountCents: 1200,
      description: "paycheck",
    });
    expect(ok("+500 paycheck #checking")).toMatchObject({
      kind: "income",
      amountCents: 50_000,
      description: "paycheck",
      accountToken: "checking",
    });
  });

  it("resolves yesterday and last friday from a fixed today", () => {
    expect(ok("12 lunch yesterday").date).toBe("2026-10-30");
    expect(ok("12 lunch last friday").date).toBe("2026-10-30");
  });

  it("treats an amount and accounts with no description as a transfer", () => {
    expect(ok("500 #checking")).toMatchObject({
      kind: "transfer",
      amountCents: 50_000,
      description: "",
      accountToken: "checking",
      toAccountToken: undefined,
    });
    expect(ok("500 #checking #savings")).toMatchObject({
      kind: "transfer",
      amountCents: 50_000,
      accountToken: "checking",
      toAccountToken: "savings",
    });
  });

  it("keeps a description word as an expense", () => {
    expect(ok("500 coffee #checking")).toMatchObject({
      kind: "expense",
      description: "coffee",
      accountToken: "checking",
    });
  });

  it("parses arrow and keyword transfers", () => {
    expect(ok("500 #checking -> #savings")).toMatchObject({
      kind: "transfer",
      amountCents: 50_000,
      accountToken: "checking",
      toAccountToken: "savings",
    });
    expect(ok("transfer 500 from #checking to #savings")).toMatchObject({
      kind: "transfer",
      amountCents: 50_000,
      accountToken: "checking",
      toAccountToken: "savings",
    });
  });

  it("rejects a missing amount, a missing description, the same account twice, and a third account", () => {
    expect(fail("").reason).toBe("Need an amount");
    expect(fail("coffee").reason).toBe("Need an amount");
    expect(fail("12").reason).toBe("Add a description");
    expect(fail("500 #checking #checking").reason).toBe("Pick two different accounts");
    expect(fail("500 #checking -> #checking").reason).toBe("Pick two different accounts");
    expect(fail("500 #checking #savings #cash").reason).toBe("Transfer needs two accounts");
  });

  it("keeps a longer exact category name together", () => {
    const categories = [
      makeCategory({ id: "cat_other", name: "Other", kind: "expense" }),
      makeCategory({ id: "cat_other_income", name: "Other income", kind: "income" }),
    ];
    expect(parseQuickAdd("+12 bonus @Other income", TODAY, categories)).toMatchObject({
      ok: true,
      categoryToken: "Other income",
      description: "bonus",
      kind: "income",
    });
    expect(parseQuickAdd("12 lunch @Other today", TODAY, categories)).toMatchObject({
      ok: true,
      categoryToken: "Other",
      description: "lunch",
      date: TODAY,
    });
  });
});
