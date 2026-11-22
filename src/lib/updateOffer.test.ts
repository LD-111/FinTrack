import { describe, expect, it } from "vitest";
import {
  readUpdatePreferences,
  updateNotice,
  writeChecksOnLaunch,
  writeSkippedVersion,
  type UpdateCheckResult,
  type UpdatePreferences,
} from "@/lib/updateOffer";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function notice(overrides: {
  result?: UpdateCheckResult | null;
  preferences?: UpdatePreferences;
  dismissedVersion?: string | null;
  manual?: boolean;
}) {
  return updateNotice({
    result: { status: "available", version: "0.2.0" },
    preferences: { checksOnLaunch: true, skippedVersion: null },
    dismissedVersion: null,
    manual: false,
    ...overrides,
  });
}

describe("update offer", () => {
  it("stays quiet when there is no update", () => {
    expect(notice({ result: null })).toBe("quiet");
    expect(notice({ result: { status: "up-to-date" } })).toBe("quiet");
  });

  it("hides an offer dismissed for this session", () => {
    expect(notice({ dismissedVersion: "0.2.0" })).toBe("quiet");
  });

  it("hides a version the user kept", () => {
    expect(notice({ preferences: { checksOnLaunch: true, skippedVersion: "0.2.0" } })).toBe("quiet");
  });

  it("stays quiet when launch checks are off", () => {
    expect(notice({ preferences: { checksOnLaunch: false, skippedVersion: null } })).toBe("quiet");
    expect(notice({ result: { status: "failed" } })).toBe("quiet");
  });

  it("offers a newer version after a skipped one", () => {
    expect(
      notice({
        result: { status: "available", version: "0.3.0" },
        preferences: { checksOnLaunch: true, skippedVersion: "0.2.0" },
      }),
    ).toBe("offer");
  });

  it("shows a manual check even when that version was skipped or notices are off", () => {
    expect(
      notice({
        manual: true,
        preferences: { checksOnLaunch: false, skippedVersion: "0.2.0" },
        dismissedVersion: "0.2.0",
      }),
    ).toBe("offer");
    expect(notice({ result: { status: "up-to-date" }, manual: true })).toBe("up-to-date");
    expect(notice({ result: { status: "failed" }, manual: true })).toBe("failed");
  });

  it("remembers launch checks and a skipped version", () => {
    const storage = memoryStorage();
    expect(readUpdatePreferences(storage)).toEqual({ checksOnLaunch: true, skippedVersion: null });
    writeChecksOnLaunch(storage, false);
    writeSkippedVersion(storage, "0.2.0");
    expect(readUpdatePreferences(storage)).toEqual({ checksOnLaunch: false, skippedVersion: "0.2.0" });
    writeChecksOnLaunch(storage, true);
    expect(readUpdatePreferences(storage).checksOnLaunch).toBe(true);
  });
});
