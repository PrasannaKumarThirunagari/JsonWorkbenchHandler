/**
 * Copies shippable web + extension assets into extensions/unpacked/
 * so Chrome/Firefox "Load unpacked" can target that folder independently of the repo root.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEST = path.join(ROOT, "extensions", "unpacked");

const FILES = [
  "index.html",
  "app.js",
  "styles.css",
  "theme-init.js",
  "app-extra.css",
  "manifest.json",
  "background.js",
];

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

for (const name of FILES) {
  const src = path.join(ROOT, name);
  if (!fs.existsSync(src)) {
    console.error("Missing required file:", src);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(DEST, name));
}

fs.cpSync(path.join(ROOT, "icons"), path.join(DEST, "icons"), { recursive: true });

console.log("Extension bundle synced to:", path.relative(ROOT, DEST));
console.log("Load unpacked from that folder in chrome://extensions or Firefox debugging.");
