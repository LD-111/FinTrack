import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const MSI_BUILD_MAX = 65535;

function versionParts(appVersion) {
  const parts = String(appVersion).split(".");
  const major = Number(parts[0]);
  const minor = Number(parts[1] ?? 0);
  if (!Number.isInteger(major) || major < 0 || major > 255) {
    throw new Error(`MSI major version must be 0–255 (from ${appVersion})`);
  }
  if (!Number.isInteger(minor) || minor < 0 || minor > 255) {
    throw new Error(`MSI minor version must be 0–255 (from ${appVersion})`);
  }
  return { major, minor, rest: parts.slice(2) };
}

export function nextMsiVersion(appVersion, buildCount) {
  const { major, minor } = versionParts(appVersion);
  const build = buildCount + 1;
  if (build > MSI_BUILD_MAX) {
    throw new Error(`MSI build count is above ${MSI_BUILD_MAX}`);
  }
  return `${major}.${minor}.${build}`;
}

export function releaseMsiVersion(appVersion) {
  const { major, minor, rest } = versionParts(appVersion);
  const patch = rest.length === 0 ? 0 : Number(rest[0]);
  if (rest.length > 1 || !Number.isInteger(patch) || patch < 0 || patch > MSI_BUILD_MAX) {
    throw new Error(`MSI release version must be major.minor.patch (from ${appVersion})`);
  }
  return `${major}.${minor}.${patch}`;
}

export function readBuildCount(text) {
  const count = Number.parseInt(String(text).trim(), 10);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

export function windowsBundleConfig(appVersion, buildCount, upgradeCode, options = {}) {
  const release = options.release === true;
  return {
    bundle: {
      windows: {
        allowDowngrades: true,
        wix: {
          version: release ? releaseMsiVersion(appVersion) : nextMsiVersion(appVersion, buildCount),
          upgradeCode,
        },
      },
    },
  };
}

export function prepareMsiVersion(root, options = {}) {
  const release = options.release === true;
  const confPath = path.join(root, "src-tauri", "tauri.conf.json");
  const conf = JSON.parse(readFileSync(confPath, "utf8"));
  const upgradeCode = conf.bundle?.windows?.wix?.upgradeCode;
  if (!upgradeCode) {
    throw new Error("tauri.conf.json is missing bundle.windows.wix.upgradeCode");
  }
  const counterPath = path.join(root, "src-tauri", ".msi-build");
  let previous = 0;
  if (!release) {
    try {
      previous = readBuildCount(readFileSync(counterPath, "utf8"));
    } catch {
      previous = 0;
    }
  }
  const config = windowsBundleConfig(conf.version, previous, upgradeCode, { release });
  writeFileSync(
    path.join(root, "src-tauri", "tauri.windows.conf.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  if (release) {
    return { version: config.bundle.windows.wix.version, buildCount: null, counterPath: null };
  }
  return { version: config.bundle.windows.wix.version, buildCount: previous + 1, counterPath };
}

export function commitMsiBuild(counterPath, buildCount) {
  writeFileSync(counterPath, `${buildCount}\n`);
}
