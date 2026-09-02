#!/usr/bin/env node
// Dependency vulnerability gate for CI.
//
// Reads an osv-scanner JSON results file and FAILS the build if any
// remaining High or Critical vulnerability is found.
//
// Exception policy
// ----------------
// - osv-scanner is invoked with `--config=osv-scanner.toml` at the repo root.
//   That file contains the documented exception allowlist ([[IgnoredVulns]]).
//   Excused advisories are removed from the scan output before this script runs,
//   so the findings this script sees are exactly the ones NOT covered by a
//   documented, time-boxed exception.
// - Findings below High severity (Low/Moderate) are reported but do NOT fail
//   the build. Only High/Critical findings gate the pipeline (see
//   CONTRIBUTING.md > Supply-chain security for the full policy).
//
// Usage:
//   node scripts/check-vulnerabilities.mjs [results.json]
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsPath = process.argv[2] ?? path.join(root, 'osv-results.json');

if (!existsSync(resultsPath)) {
  console.error(
    `[vuln-gate] Results file not found: ${resultsPath}\n` +
      `Run osv-scanner first, e.g.:\n` +
      `  osv-scanner --recursive --config=osv-scanner.toml --format json --output=${path.basename(resultsPath)} ./`,
  );
  process.exit(1);
}

const FAIL_SEVERITIES = new Set(['CRITICAL', 'HIGH']);

// ---------------------------------------------------------------------------
// Severity extraction helpers
// ---------------------------------------------------------------------------

// Fallback: compute a CVSS v3 base score from a vector string, then map to a
// severity label. This is only used when database_specific.severity is absent.
function cvssV3BaseScore(vector = '') {
  const m = {};
  for (const part of vector.replace('CVSS:3.1/', '').replace('CVSS:3.0/', '').split('/')) {
    const [k, v] = part.split(':');
    if (k && v) m[k] = v;
  }
  const v = (x) => m[x] ?? 'N';
  const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[v('AV')] ?? 0.55;
  const AC = { L: 0.77, H: 0.44 }[v('AC')] ?? 0.77;
  const PR = v('PR') === 'N' ? 0.85 : v('PR') === 'L' ? (v('S') === 'U' ? 0.62 : 0.68) : v('PR') === 'H' ? (v('S') === 'U' ? 0.27 : 0.5) : 0.85;
  const UI = { N: 0.85, R: 0.62 }[v('UI')] ?? 0.85;
  const C = { N: 0, L: 0.22, H: 0.56 }[v('C')] ?? 0;
  const I = { N: 0, L: 0.22, H: 0.56 }[v('I')] ?? 0;
  const A = { N: 0, L: 0.22, H: 0.56 }[v('A')] ?? 0;
  const S = v('S') === 'C' ? 1 : 0;
  const ISS = 1 - (1 - C) * (1 - I) * (1 - A);
  const Impact = S === 1 ? 7.52 * (ISS - 0.029) - 3.25 * Math.pow(ISS - 0.02, 15) : 6.42 * ISS;
  const Exploitability = 8.22 * AV * AC * PR * UI;
  const base = Impact <= 0 ? 0 : Math.min(1.08 * (Impact + Exploitability), 10);
  return Math.round(base * 100000) / 100000;
}

function cvssScoreToSeverity(score) {
  if (score === 0) return 'NONE';
  if (score < 4) return 'LOW';
  if (score < 7) return 'MODERATE';
  if (score < 9) return 'HIGH';
  return 'CRITICAL';
}

function extractSeverity(vuln, fallbackVectors) {
  const dbSev = vuln.database_specific?.severity;
  if (typeof dbSev === 'string') {
    const upper = dbSev.toUpperCase();
    if (upper === 'MODERATE' || upper === 'MEDIUM') return { label: 'MODERATE', source: 'database_specific' };
    if (upper === 'HIGH' || upper === 'CRITICAL' || upper === 'LOW') {
      return { label: upper, source: 'database_specific' };
    }
  }
  // No GHSA rating: try CVSS vectors (severity array) then the fallback list.
  for (const vec of fallbackVectors) {
    const parsed = parseVector(vec);
    if (parsed) return { label: parsed.label, source: parsed.source };
  }
  if (Array.isArray(vuln.severity) && vuln.severity.length > 0) {
    for (const s of vuln.severity) {
      if (typeof s.score === 'number') {
        return { label: cvssScoreToSeverity(s.score), source: 'severity[].score' };
      }
      if (typeof s.vector === 'string') {
        const p = parseVector(s.vector);
        if (p) return { label: p.label, source: 'severity[].vector' };
      }
    }
  }
  return { label: 'UNKNOWN', source: 'none' };
}

function parseVector(vector) {
  try {
    const score = cvssV3BaseScore(vector);
    return { label: cvssScoreToSeverity(score), source: 'cvss' };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Collect findings
// ---------------------------------------------------------------------------

const resultsJson = JSON.parse(readFileSync(resultsPath, 'utf8'));
const findings = [];
const groups = Array.isArray(resultsJson.results) ? resultsJson.results : [];

for (const group of groups) {
  for (const pkg of group.packages ?? []) {
    const packageName = pkg.package?.name ?? 'unknown';
    const packageVersion = pkg.package?.version ?? '';
    for (const vuln of pkg.vulnerabilities ?? []) {
      const vectors = Array.isArray(vuln.severity)
        ? vuln.severity.map((s) => s.vector).filter(Boolean)
        : [];
      const { label } = extractSeverity(vuln, vectors);
      findings.push({
        id: vuln.id ?? 'unknown',
        severity: label,
        packageName,
        packageVersion,
        summary: vuln.summary ?? '',
        aliases: vuln.aliases ?? [],
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Report + gate
// ---------------------------------------------------------------------------

const bySeverity = {};
for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

console.log(
  `[vuln-gate] osv-scanner found ${findings.length} unexcused finding(s): ` +
    Object.entries(bySeverity)
      .map(([sev, n]) => `${sev}=${n}`)
      .join(', ') || 'none',
);

for (const f of findings) {
  const sev = f.severity.padEnd(8);
  console.log(`  ${sev} ${f.id.padEnd(22)} ${f.packageName}@${f.packageVersion} — ${f.summary}`);
}

const failing = findings.filter((f) => FAIL_SEVERITIES.has(f.severity));
const unknown = findings.filter((f) => f.severity === 'UNKNOWN');

if (failing.length > 0) {
  console.error(
    `\n[vuln-gate] FAIL: ${failing.length} HIGH/CRITICAL finding(s) are not covered by a ` +
      `documented exception in osv-scanner.toml.\n` +
      `To accept an exception, add the advisory ID to osv-scanner.toml [[IgnoredVulns]] with a ` +
      `reason and ignoreUntil date (see CONTRIBUTING.md > Supply-chain security).`,
  );
  process.exit(1);
}

if (unknown.length > 0) {
  console.warn(
    `\n[vuln-gate] WARN: ${unknown.length} finding(s) had no severity rating and were not gated. ` +
      `Please review manually.`,
  );
}

console.log('[vuln-gate] PASS: no unexcused HIGH/CRITICAL findings.');
process.exit(0);
