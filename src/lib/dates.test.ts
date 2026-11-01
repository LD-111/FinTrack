import { describe, expect, it } from "vitest";
import { addDays, resolveDateHint } from "@/lib/dates";

const SATURDAY = "2026-10-31";

describe("resolveDateHint", () => {
  it("resolves the words Quick Add accepts", () => {
    expect(resolveDateHint("today", SATURDAY)).toBe(SATURDAY);
    expect(resolveDateHint("yesterday", SATURDAY)).toBe("2026-10-30");
    expect(resolveDateHint("tomorrow", SATURDAY)).toBe("2026-11-01");
    expect(resolveDateHint("Last Friday", SATURDAY)).toBe("2026-10-30");
    expect(resolveDateHint("monday", SATURDAY)).toBe("2026-10-26");
    expect(resolveDateHint("nope", SATURDAY)).toBeNull();
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays(SATURDAY, 1)).toBe("2026-11-01");
    expect(addDays(SATURDAY, -1)).toBe("2026-10-30");
  });
});
