import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commitMsiBuild, prepareMsiVersion } from "./msi-version.mjs";
import { patchMobileHandoff } from "./mobile-handoff.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const stamp = process.platform === "win32" && args[0] === "build" ? prepareMsiVersion(root) : null;
if (stamp) {
  console.log(`MSI version ${stamp.version}`);
}

const mobile = args[0] === "android" || args[0] === "ios";
if (mobile) patchMobileHandoff(root);

const cli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const result = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit", cwd: root });
if (mobile) patchMobileHandoff(root);
const status = result.status === null ? 1 : result.status;
if (stamp && status === 0) {
  commitMsiBuild(stamp.counterPath, stamp.buildCount);
}
process.exit(status);
