import { describe, expect, it } from "vitest";
import { isCaptureShell } from "@/lib/shell";

describe("isCaptureShell", () => {
  it("uses the capture shell on Android and iOS", () => {
    expect(isCaptureShell("android", "", false)).toBe(true);
    expect(isCaptureShell("ios", "?capture=0", false)).toBe(true);
  });

  it("ignores the capture query outside dev", () => {
    expect(isCaptureShell("windows", "?capture=1", false)).toBe(false);
    expect(isCaptureShell(null, "?capture=1", false)).toBe(false);
  });

  it("follows the capture query in dev", () => {
    expect(isCaptureShell(null, "?capture=1", true)).toBe(true);
    expect(isCaptureShell("windows", "capture=1", true)).toBe(true);
    expect(isCaptureShell(null, "?capture=0", true)).toBe(false);
    expect(isCaptureShell("linux", "", true)).toBe(false);
  });
});
