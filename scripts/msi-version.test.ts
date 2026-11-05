import { describe, expect, it } from "vitest";
import { nextMsiVersion, readBuildCount, windowsBundleConfig } from "./msi-version.mjs";

describe("msi version", () => {
  it("advances the Windows installer build without changing the app major and minor", () => {
    expect(nextMsiVersion("0.1.0", 0)).toBe("0.1.1");
    expect(nextMsiVersion("0.1.0", 12)).toBe("0.1.13");
    expect(nextMsiVersion("0.2.0", 4)).toBe("0.2.5");
  });

  it("treats a missing counter as the first build", () => {
    expect(readBuildCount("")).toBe(0);
    expect(readBuildCount("nope")).toBe(0);
    expect(readBuildCount("7\n")).toBe(7);
  });

  it("keeps the upgrade code on the generated Windows config", () => {
    const config = windowsBundleConfig("0.1.0", 0, "27A2CD43-3604-535C-8964-039EC1CD1FEE");
    expect(config.bundle.windows.allowDowngrades).toBe(true);
    expect(config.bundle.windows.wix).toEqual({
      version: "0.1.1",
      upgradeCode: "27A2CD43-3604-535C-8964-039EC1CD1FEE",
    });
  });

  it("rejects a build count Windows cannot store", () => {
    expect(() => nextMsiVersion("0.1.0", 65535)).toThrow(/65535/);
  });
});
