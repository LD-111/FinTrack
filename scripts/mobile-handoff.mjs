import fs from "node:fs";
import path from "node:path";

const CAMERA = "android.permission.CAMERA";
const CLEARTEXT = "android:usesCleartextTraffic";

const IOS_KEYS = [
  ["NSCameraUsageDescription", "FinTrack uses the camera to scan the code on your computer."],
  ["NSLocalNetworkUsageDescription", "FinTrack connects to your computer on the local network to bring transactions home."],
];

const LAUNCHER_ICONS = [
  ["icons/android", "gen/android/app/src/main/res"],
  ["icons/ios", "gen/apple/Assets.xcassets/AppIcon.appiconset"],
];

export function patchMobileHandoff(root) {
  installLauncherIcons(root);
  patchAndroid(path.join(root, "src-tauri", "gen", "android"));
  patchApple(path.join(root, "src-tauri", "gen", "apple"));
}

function installLauncherIcons(root) {
  const tauri = path.join(root, "src-tauri");
  for (const [from, to] of LAUNCHER_ICONS) {
    const source = path.join(tauri, from);
    const dest = path.join(tauri, to);
    if (!fs.existsSync(source) || !fs.existsSync(dest)) continue;
    copyTree(source, dest);
  }
}

function copyTree(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      copyTree(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

function patchAndroid(dir) {
  const file = path.join(dir, "app", "src", "main", "AndroidManifest.xml");
  if (!fs.existsSync(file)) return;
  const original = fs.readFileSync(file, "utf8");
  let next = original;
  if (!next.includes(CAMERA)) {
    if (next.includes("android.permission.INTERNET")) {
      next = next.replace(
        /(<uses-permission\b[^>]*android\.permission\.INTERNET[^>]*\/>)/,
        `$1\n    <uses-permission android:name="${CAMERA}" />`,
      );
    } else {
      next = next.replace(/(<manifest\b[^>]*>)/, `$1\n    <uses-permission android:name="${CAMERA}" />`);
    }
  }
  next = next.replace(/<application\b([^>]*)>/, (_match, attrs) => {
    if (attrs.includes(CLEARTEXT)) {
      return `<application${attrs.replace(/android:usesCleartextTraffic="[^"]*"/, `${CLEARTEXT}="true"`)}>`;
    }
    return `<application ${CLEARTEXT}="true"${attrs}>`;
  });
  if (next !== original) fs.writeFileSync(file, next);
}

function patchApple(dir) {
  if (!fs.existsSync(dir)) return;
  for (const file of walk(dir)) {
    if (path.basename(file) !== "Info.plist" || file.includes(`${path.sep}Pods${path.sep}`)) continue;
    const original = fs.readFileSync(file, "utf8");
    let next = original;
    const additions = [];
    for (const [key, value] of IOS_KEYS) {
      if (!next.includes(`<key>${key}</key>`)) {
        additions.push(`\t<key>${key}</key>\n\t<string>${value}</string>`);
      }
    }
    if (!next.includes("NSAllowsLocalNetworking")) {
      if (next.includes("<key>NSAppTransportSecurity</key>")) {
        next = next.replace(
          /(<key>NSAppTransportSecurity<\/key>\s*<dict>)/,
          `$1\n\t\t<key>NSAllowsLocalNetworking</key>\n\t\t<true/>`,
        );
      } else {
        additions.push(
          "\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsLocalNetworking</key>\n\t\t<true/>\n\t</dict>",
        );
      }
    }
    if (additions.length > 0) {
      const block = `${additions.join("\n")}\n`;
      const last = next.lastIndexOf("</dict>");
      if (last >= 0) next = `${next.slice(0, last)}${block}${next.slice(last)}`;
    }
    if (next !== original) fs.writeFileSync(file, next);
  }
}

function walk(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}
