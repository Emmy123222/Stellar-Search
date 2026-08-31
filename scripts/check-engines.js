#!/usr/bin/env node

/**
 * scripts/check-engines.js
 *
 * Validates that the running Node.js version satisfies the engines.node
 * constraint declared in package.json.  Fails early in CI (and locally)
 * with a clear message when a developer tries to use an unsupported
 * runtime.
 *
 * Usage:
 *   node scripts/check-engines.js
 *
 * Exit codes:
 *   0 — version is supported
 *   1 — version is below the minimum
 */

import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const constraint = pkg.engines?.node;

if (!constraint) {
  console.log("ℹ️  No engines.node declared in package.json — skipping check.");
  process.exit(0);
}

// We only support simple ">=X" or ">=X.Y.Z" constraints.
const match = constraint.match(/^>=\s*(\d+)/);
if (!match) {
  console.log(
    `ℹ️  engines.node "${constraint}" is not a >= constraint — skipping check.`,
  );
  process.exit(0);
}

const minMajor = parseInt(match[1], 10);
const current = process.version; // e.g. "v20.11.0"
const currentMajor = parseInt(current.slice(1), 10);

if (currentMajor < minMajor) {
  console.error("");
  console.error(`  ❌  Node.js ${current} is not supported.`);
  console.error("");
  console.error(`  package.json declares engines.node: "${constraint}"`);
  console.error(
    `  Current version (${current}) is below the minimum of ${minMajor}.`,
  );
  console.error("");
  console.error(`  Please upgrade to Node.js ${minMajor} or later.`);
  console.error("");
  process.exit(1);
}

console.log(`✅  Node.js ${current} satisfies engines.node "${constraint}".`);
