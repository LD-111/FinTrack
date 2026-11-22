import { describe, expect, it } from "vitest";
import { updaterConfigArgs } from "./updater-config.mjs";

describe("updater config", () => {
  it("signs update artifacts only for a published build", () => {
    const args = updaterConfigArgs(true, ["build"]);
    expect(args[0]).toBe("--config");
    expect(JSON.parse(args[1])).toEqual({ bundle: { createUpdaterArtifacts: true } });
  });

  it("leaves local builds and other commands unsigned", () => {
    expect(updaterConfigArgs(false, ["build"])).toEqual([]);
    expect(updaterConfigArgs(true, ["dev"])).toEqual([]);
    expect(updaterConfigArgs(true, ["android", "build"])).toEqual([]);
  });
});
