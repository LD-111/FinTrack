import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nextMsiVersion, prepareMsiVersion, readBuildCount, releaseMsiVersion, windowsBundleConfig } from "./msi-version.mjs";

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

  it("uses the app version itself for a published installer", () => {
    expect(releaseMsiVersion("0.1.0")).toBe("0.1.0");
    expect(releaseMsiVersion("0.1.5")).toBe("0.1.5");
    expect(releaseMsiVersion("1.2")).toBe("1.2.0");
    const config = windowsBundleConfig("0.1.5", 40, "27A2CD43-3604-535C-8964-039EC1CD1FEE", {
      release: true,
    });
    expect(config.bundle.windows.wix.version).toBe("0.1.5");
    expect(config.bundle.windows.allowDowngrades).toBe(true);
  });

  it("rejects a release version Windows cannot store", () => {
    expect(() => releaseMsiVersion("0.1.65536")).toThrow(/major\.minor\.patch/);
    expect(() => releaseMsiVersion("0.1.0-beta")).toThrow(/major\.minor\.patch/);
  });
});

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fintrack-msi-"));
  roots.push(root);
  return root;
}

function writeConf(root: string, version: string) {
  const dir = path.join(root, "src-tauri");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "tauri.conf.json"),
    JSON.stringify({
      version,
      bundle: { windows: { wix: { upgradeCode: "27A2CD43-3604-535C-8964-039EC1CD1FEE" } } },
    }),
  );
}

describe("prepare MSI version", () => {
  it("leaves the local counter untouched on a release", () => {
    const root = tempRoot();
    writeConf(root, "0.1.5");
    const counter = path.join(root, "src-tauri", ".msi-build");
    fs.writeFileSync(counter, "40\n");

    const stamp = prepareMsiVersion(root, { release: true });

    expect(stamp).toEqual({ version: "0.1.5", buildCount: null, counterPath: null });
    expect(fs.readFileSync(counter, "utf8")).toBe("40\n");
    const written = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.windows.conf.json"), "utf8"));
    expect(written.bundle.windows.wix.version).toBe("0.1.5");
  });
});
