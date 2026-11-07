import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchMobileHandoff } from "./mobile-handoff.mjs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("mobile launcher icons", () => {
  it("replaces the generated Tauri mark with the tracked logo", () => {
    const root = tempRoot();
    const androidIcon = path.join(root, "src-tauri", "icons", "android", "mipmap-mdpi");
    const androidRes = path.join(root, "src-tauri", "gen", "android", "app", "src", "main", "res", "mipmap-mdpi");
    const iosIcon = path.join(root, "src-tauri", "icons", "ios");
    const iosSet = path.join(root, "src-tauri", "gen", "apple", "Assets.xcassets", "AppIcon.appiconset");
    fs.mkdirSync(androidIcon, { recursive: true });
    fs.mkdirSync(androidRes, { recursive: true });
    fs.mkdirSync(iosIcon, { recursive: true });
    fs.mkdirSync(iosSet, { recursive: true });
    fs.writeFileSync(path.join(androidIcon, "ic_launcher.png"), "logo");
    fs.writeFileSync(path.join(androidRes, "ic_launcher.png"), "tauri");
    fs.writeFileSync(path.join(iosIcon, "AppIcon-60x60@2x.png"), "logo");
    fs.writeFileSync(path.join(iosSet, "AppIcon-60x60@2x.png"), "tauri");

    patchMobileHandoff(root);

    expect(fs.readFileSync(path.join(androidRes, "ic_launcher.png"), "utf8")).toBe("logo");
    expect(fs.readFileSync(path.join(iosSet, "AppIcon-60x60@2x.png"), "utf8")).toBe("logo");
  });

  it("leaves a machine with no generated project alone", () => {
    const root = tempRoot();
    const androidIcon = path.join(root, "src-tauri", "icons", "android", "mipmap-mdpi");
    fs.mkdirSync(androidIcon, { recursive: true });
    fs.writeFileSync(path.join(androidIcon, "ic_launcher.png"), "logo");

    patchMobileHandoff(root);

    expect(fs.existsSync(path.join(root, "src-tauri", "gen"))).toBe(false);
  });
});

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fintrack-icons-"));
  roots.push(root);
  return root;
}
