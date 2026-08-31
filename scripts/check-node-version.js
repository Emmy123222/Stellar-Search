#!/usr/bin/env node
/**
 * check-node-version.js
 *
 * Validates the running Node.js version against the `engines.node` field
 * in package.json. Exits 1 with a clear message when the version is
 * unsupported so CI and local setups fail early.
 *
 * Zero external dependencies — parses semver ranges inline.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const SUPPORTED_RANGE = ">=18.0.0";

/**
 * Parse a major.minor.patch string into a comparable tuple.
 * Returns null when the string is not a valid version.
 */
export function parseVersion(v) {
  const cleaned = v.replace(/^v/i, "");
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compare two version tuples. Returns -1, 0, or 1.
 */
export function compareVersions(a, b) {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
  return 0;
}

/**
 * Coerce a Node version string (e.g. "v18.17.1", "18.17.1") into a
 * clean "MAJOR.MINOR.PATCH" string, or null on failure.
 */
export function coerceVersion(raw) {
  const cleaned = raw.replace(/^v/i, "");
  const parts = parseVersion(cleaned);
  if (!parts) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

/**
 * Test whether a version satisfies a simple range string.
 *
 * Supports the patterns used in package.json engines:
 *   - ">=18.0.0"          (minimum)
 *   - "^20.19.0"          (caret — same major, >= minor.patch)
 *   - ">=22.12.0"         (minimum)
 *   - "20.x" / "20"       (major match)
 *   - "* || >=14"         (the `*` always matches)
 *   - ">=18.0.0 <23"      (range — both bounds must hold)
 *   - "^20.19.0 || >=22.12.0"  (disjunction)
 */
export function satisfiesRange(version, range) {
  const v = parseVersion(version);
  if (!v) return false;

  // Split on || for disjunctions
  const alternatives = range.split("||").map((s) => s.trim());

  for (const alt of alternatives) {
    if (testSingleRange(v, alt)) return true;
  }
  return false;
}

function testSingleRange(v, range) {
  range = range.trim();

  // * matches everything
  if (range === "*" || range === "") return true;

  // Handle space-separated ranges (e.g. ">=18.0.0 <23")
  const spaceParts = range.split(/\s+/);
  if (spaceParts.length > 1) {
    return spaceParts.every((p) => testSingleRange(v, p));
  }

  // Handle x-ranges like "20.x" or "20.x.x" or "20"
  const xMatch = range.match(/^(\d+)(?:\.x(?:\.x)?)?$/);
  if (xMatch) {
    return v[0] === Number(xMatch[1]);
  }

  // Handle >= / > / <= / < / = ranges with full semver
  const opFullMatch = range.match(/^([><=]+)\s*(\d+)\.(\d+)\.(\d+)$/);
  if (opFullMatch) {
    const op = opFullMatch[1];
    const target = parseVersion(
      opFullMatch[2] + "." + opFullMatch[3] + "." + opFullMatch[4],
    );
    if (!target) return false;
    const cmp = compareVersions(v, target);
    switch (op) {
      case ">=":
        return cmp >= 0;
      case ">":
        return cmp > 0;
      case "<=":
        return cmp <= 0;
      case "<":
        return cmp < 0;
      case "=":
      case "==":
        return cmp === 0;
      default:
        return false;
    }
  }

  // Handle operator with major-only (e.g. ">=18" or "<21")
  const opMajorMatch = range.match(/^([><=]+)\s*(\d+)$/);
  if (opMajorMatch) {
    const op = opMajorMatch[1];
    const major = Number(opMajorMatch[2]);
    const cmp = v[0] - major;
    switch (op) {
      case ">=":
        return cmp >= 0;
      case ">":
        return cmp > 0;
      case "<=":
        return cmp <= 0;
      case "<":
        return cmp < 0;
      case "=":
      case "==":
        return cmp === 0;
      default:
        return false;
    }
  }

  // Handle caret ranges like "^20.19.0"
  const caretMatch = range.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
  if (caretMatch) {
    const major = Number(caretMatch[1]);
    const minor = Number(caretMatch[2]);
    const patch = Number(caretMatch[3]);
    // ^X.Y.Z means >= X.Y.Z and < (X+1).0.0
    const lower = [major, minor, patch];
    const upper = [major + 1, 0, 0];
    return compareVersions(v, lower) >= 0 && compareVersions(v, upper) < 0;
  }

  // Handle tilde ranges like "~20.19.0"
  const tildeMatch = range.match(/^~(\d+)\.(\d+)\.(\d+)$/);
  if (tildeMatch) {
    const major = Number(tildeMatch[1]);
    const minor = Number(tildeMatch[2]);
    const patch = Number(tildeMatch[3]);
    // ~X.Y.Z means >= X.Y.Z and < X.(Y+1).0
    const lower = [major, minor, patch];
    const upper = [major, minor + 1, 0];
    return compareVersions(v, lower) >= 0 && compareVersions(v, upper) < 0;
  }

  // Exact version match
  const exact = parseVersion(range);
  if (exact) {
    return compareVersions(v, exact) === 0;
  }

  return false;
}

/**
 * Validate the running Node version against the engines range.
 * @returns {{ ok: boolean, current: string, required: string, message?: string }}
 */
export function checkNodeVersion(currentVersion, enginesRange) {
  const coerced = coerceVersion(currentVersion);
  if (!coerced) {
    return {
      ok: false,
      current: currentVersion,
      required: enginesRange,
      message: `Unable to parse Node version "${currentVersion}". Expected a valid semver string.`,
    };
  }

  if (satisfiesRange(coerced, enginesRange)) {
    return {
      ok: true,
      current: coerced,
      required: enginesRange,
    };
  }

  return {
    ok: false,
    current: coerced,
    required: enginesRange,
    message:
      `Node ${coerced} is not supported — this project requires ${enginesRange}.\n` +
      `  Detected: node@${coerced}\n` +
      `  Required: node ${enginesRange}\n` +
      `  Hint: use nvm, fnm, or volta to switch to a supported version.`,
  };
}

// When run directly (not imported), perform the check and exit.
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("check-node-version.js") ||
    process.argv[1].endsWith("check-node-version.ts"));

if (isDirectRun) {
  let enginesRange = SUPPORTED_RANGE;
  try {
    const pkgPath = join(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (pkg.engines && pkg.engines.node) {
      enginesRange = pkg.engines.node;
    }
  } catch {
    // If we can't read package.json, fall back to default range.
  }

  const result = checkNodeVersion(process.version, enginesRange);

  if (!result.ok) {
    console.error(`\n❌ ${result.message}\n`);
    process.exit(1);
  }

  console.log(`✅ Node ${result.current} satisfies ${result.required}`);
}
