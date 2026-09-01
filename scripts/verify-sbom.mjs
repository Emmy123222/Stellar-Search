// Verifies that sbom.cyclonedx.json is a valid, non-empty CycloneDX SBOM.
// Intended to run after `npm run sbom` in CI to fail fast if the artifact
// is malformed or empty (upload-artifact's if-no-files-found only guards the
// file's existence, not its contents).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sbomPath = process.argv[2] ?? path.join(root, 'sbom.cyclonedx.json');

if (!existsSync(sbomPath)) {
  console.error(`[verify-sbom] SBOM file not found: ${sbomPath}`);
  process.exit(1);
}

let bom;
try {
  bom = JSON.parse(readFileSync(sbomPath, 'utf8'));
} catch (err) {
  console.error(`[verify-sbom] SBOM is not valid JSON: ${err.message}`);
  process.exit(1);
}

const errors = [];
if (bom.bomFormat !== 'CycloneDX') {
  errors.push(`bomFormat is "${bom.bomFormat}", expected "CycloneDX"`);
}
if (typeof bom.specVersion !== 'string') {
  errors.push('missing specVersion string');
}
if (!Array.isArray(bom.components) || bom.components.length === 0) {
  errors.push('components must be a non-empty array');
}
if (bom.metadata?.component?.type !== 'application') {
  errors.push('metadata.component.type should be "application"');
}

if (errors.length > 0) {
  console.error('[verify-sbom] SBOM validation failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `[verify-sbom] OK: ${bom.bomFormat} ${bom.specVersion} with ${bom.components.length} components`,
);
