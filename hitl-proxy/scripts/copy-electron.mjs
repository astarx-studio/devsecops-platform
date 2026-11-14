import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destDir = path.join(root, "dist", "electron");
const assetsDir = path.join(root, "assets");

fs.mkdirSync(destDir, { recursive: true });

const copies = [
  ["src/electron/main.cjs", "main.cjs"],
  ["assets/icon.ico", "icon.ico"],
  ["assets/icon.png", "icon.png"],
  ["assets/icon-16.png", "icon-16.png"],
  ["assets/icon-32.png", "icon-32.png"],
];

for (const [fromRel, toName] of copies) {
  const from = path.join(root, fromRel);
  const to = path.join(destDir, toName);
  if (!fs.existsSync(from)) {
    console.warn(`skip missing ${fromRel}`);
    continue;
  }
  fs.copyFileSync(from, to);
  console.log(`copied ${fromRel} → dist/electron/${toName}`);
}

// Keep assets folder discoverable as a fallback path from dist/electron.
if (fs.existsSync(assetsDir)) {
  console.log(`assets ready at ${path.relative(root, assetsDir)}`);
}
