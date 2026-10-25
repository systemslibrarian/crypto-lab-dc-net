#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const runtimeDependencies = Object.keys(packageJson.dependencies ?? {});
if (runtimeDependencies.length !== 0) {
  throw new Error(
    `unexpected runtime dependencies: ${runtimeDependencies.join(", ")}`,
  );
}

const htmlPath = path.join(dist, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
if (!html.includes("/crypto-lab-dc-net/assets/")) {
  throw new Error("built HTML does not use the /crypto-lab-dc-net/ base path");
}
const assets = fs.readdirSync(path.join(dist, "assets"));
if (!assets.some((name) => name.endsWith(".js"))) {
  throw new Error("production build contains no JavaScript asset");
}
if (!assets.some((name) => name.endsWith(".css"))) {
  throw new Error("production build contains no CSS asset");
}

const deployedText = [
  html,
  ...assets
    .filter((name) => name.endsWith(".js") || name.endsWith(".css"))
    .map((name) => fs.readFileSync(path.join(dist, "assets", name), "utf8")),
].join("\n");
if (!deployedText.includes("DC-net")) {
  throw new Error("production build does not identify the DC-net lesson");
}
for (const stale of ["Dedup Vault", "dedup-vault", "crypto-lab-dedup-vault"]) {
  if (deployedText.includes(stale)) {
    throw new Error(`production build still contains scaffold text: ${stale}`);
  }
}

if (fs.existsSync(path.join(dist, "THIRD_PARTY_NOTICES.txt"))) {
  throw new Error("obsolete runtime dependency notice was deployed");
}

console.info(
  "build evidence: DC-net base path, production assets, and zero runtime dependencies verified",
);
