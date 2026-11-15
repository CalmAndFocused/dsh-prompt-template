/**
 * Verify that this plugin is listed in the dsh-market catalog(s).
 *
 * dsh-market reads `awesome-dsh-plugin.com/plugins.json` live on every open,
 * and the built-in Discover reads the same data from `dsh-plugin-catalog` on
 * npm. Both are checked, so a listing that only reached one of them shows up.
 *
 * Usage:
 *   node scripts/check-listing.mjs            # check now
 *   node scripts/check-listing.mjs --wait     # poll every 60s until listed
 *
 * Exit code 0 when every source lists the plugin with the expected version.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

/** The `name` a listing is expected to carry (owner/repo), from our submission. */
const EXPECTED_NAME = 'CalmAndFocused/dsh-prompt-template';
const EXPECTED_CATEGORY = 'ui';

const SOURCES = [
  { label: 'dshmarket', url: 'https://awesome-dsh-plugin.com/plugins.json' },
  { label: 'discover', url: 'https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json' },
];

/**
 * Read one catalog and report the entry, when present.
 * @param source - label and URL.
 * @returns a finding record.
 */
async function inspect(source) {
  try {
    const response = await fetch(source.url, { headers: { accept: 'application/json' } });
    if (!response.ok) return { ...source, status: `HTTP ${response.status}` };
    const document = await response.json();
    const plugins = Array.isArray(document?.plugins) ? document.plugins : [];
    // The catalog keys entries by `name`; older/other forks may reuse the same
    // name for a different repo, so the repository URL is the tiebreaker.
    const matches = plugins.filter((plugin) => plugin?.name === EXPECTED_NAME);
    if (matches.length === 0) return { ...source, status: 'not listed', total: plugins.length };
    const entry = matches[0];
    const versions = (entry.versions ?? []).map((version) => version.version);
    return {
      ...source,
      status: 'listed',
      total: plugins.length,
      matches: matches.length,
      category: entry.metadata?.category ?? '(none)',
      versions,
      hasExpectedVersion: versions.includes(manifest.version),
      engines: entry.versions?.at(-1)?.engines?.dsh ?? '(none)',
      repository: entry.repository?.url ?? '(none)',
      title: entry.title?.en ?? '(none)',
    };
  } catch (error) {
    return { ...source, status: `error: ${error.message}` };
  }
}

/** Print one source's result and return whether it fully passed. */
function report(finding) {
  const head = `[${finding.label}] ${finding.status}`;
  if (finding.status !== 'listed') {
    console.log(head + (finding.total === undefined ? '' : ` (catalog has ${finding.total} plugins)`));
    return false;
  }
  console.log(head);
  console.log(`  name:      ${EXPECTED_NAME}${finding.matches > 1 ? ` (${finding.matches} entries share it)` : ''}`);
  console.log(`  title:     ${finding.title}`);
  console.log(`  category:  ${finding.category}${finding.category === EXPECTED_CATEGORY ? '' : '  <- expected ' + EXPECTED_CATEGORY}`);
  console.log(`  versions:  ${finding.versions.join(', ')}`);
  console.log(`  version ${manifest.version}: ${finding.hasExpectedVersion ? 'present' : 'MISSING'}`);
  console.log(`  engines:   ${finding.engines}`);
  console.log(`  repo:      ${finding.repository}`);
  const ok = finding.category === EXPECTED_CATEGORY
    && finding.hasExpectedVersion
    && String(finding.repository).toLowerCase().includes('calmandfocused');
  if (!ok) console.log('  -> listed, but a field does not match this package');
  return ok;
}

const wait = process.argv.includes('--wait');
let allOk = false;

for (;;) {
  console.log(`checking ${SOURCES.length} catalog(s) for ${EXPECTED_NAME} ...`);
  const findings = [];
  for (const source of SOURCES) findings.push(await inspect(source));
  allOk = findings.map(report).every(Boolean);
  if (allOk || !wait) break;
  console.log('\nnot listed yet; retrying in 60s (Ctrl+C to stop)\n');
  await new Promise((resolve) => setTimeout(resolve, 60_000));
}

console.log(allOk ? '\nLISTED AND CONSISTENT' : '\nNOT LISTED OR INCONSISTENT');
process.exitCode = allOk ? 0 : 1;
