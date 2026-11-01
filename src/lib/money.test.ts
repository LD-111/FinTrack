import { describe, expect, it } from "vitest";
import { formatSignedMoney, parseAmountToken } from "@/lib/money";

describe("parseAmountToken", () => {
  it("reads dollars, either decimal mark, a currency symbol, and thousands separators", () => {
    expect(parseAmountToken("12")).toBe(1200);
    expect(parseAmountToken("12.50")).toBe(1250);
    expect(parseAmountToken("12,50")).toBe(1250);
    expect(parseAmountToken("$12.50")).toBe(1250);
    expect(parseAmountToken("1,250.50")).toBe(125050);
    expect(parseAmountToken("coffee")).toBeNull();
  });
});

describe("formatSignedMoney", () => {
  it("leaves a transfer unsigned and signs expenses and refunds", () => {
    expect(formatSignedMoney(1250, "transfer", "USD", "en-US")).toBe("$12.50");
    expect(formatSignedMoney(1250, "expense", "USD", "en-US")).toBe("-$12.50");
    expect(formatSignedMoney(1250, "refund", "USD", "en-US")).toBe("+$12.50");
    expect(formatSignedMoney(1250, "income", "USD", "en-US")).toBe("+$12.50");
  });
});
