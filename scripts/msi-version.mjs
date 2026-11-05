import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const MSI_BUILD_MAX = 65535;

export function nextMsiVersion(appVersion, buildCount) {
  const parts = String(appVersion).split(".");
  const major = Number(parts[0]);
  const minor = Number(parts[1] ?? 0);
  if (!Number.isInteger(major) || major < 0 || major > 255) {
    throw new Error(`MSI major version must be 0–255 (from ${appVersion})`);
  }
  if (!Number.isInteger(minor) || minor < 0 || minor > 255) {
    throw new Error(`MSI minor version must be 0–255 (from ${appVersion})`);
  }
  const build = buildCount + 1;
  if (build > MSI_BUILD_MAX) {
    throw new Error(`MSI build count is above ${MSI_BUILD_MAX}`);
  }
  return `${major}.${minor}.${build}`;
}

export function readBuildCount(text) {
  const count = Number.parseInt(String(text).trim(), 10);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

export function windowsBundleConfig(appVersion, buildCount, upgradeCode) {
  return {
    bundle: {
      windows: {
        allowDowngrades: true,
        wix: {
          version: nextMsiVersion(appVersion, buildCount),
          upgradeCode,
        },
      },
    },
  };
}

export function prepareMsiVersion(root) {
  const confPath = path.join(root, "src-tauri", "tauri.conf.json");
  const conf = JSON.parse(readFileSync(confPath, "utf8"));
  const upgradeCode = conf.bundle?.windows?.wix?.upgradeCode;
  if (!upgradeCode) {
    throw new Error("tauri.conf.json is missing bundle.windows.wix.upgradeCode");
  }
  const counterPath = path.join(root, "src-tauri", ".msi-build");
  let previous = 0;
  try {
    previous = readBuildCount(readFileSync(counterPath, "utf8"));
  } catch {
    previous = 0;
  }
  const config = windowsBundleConfig(conf.version, previous, upgradeCode);
  writeFileSync(
    path.join(root, "src-tauri", "tauri.windows.conf.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  return { version: config.bundle.windows.wix.version, buildCount: previous + 1, counterPath };
}

export function commitMsiBuild(counterPath, buildCount) {
  writeFileSync(counterPath, `${buildCount}\n`);
}
