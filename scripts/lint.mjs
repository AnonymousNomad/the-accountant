#!/usr/bin/env node
/**
 * Structural lint: the repository's own invariants, checked without any dependency.
 *
 * This is deliberately not a style linter. It enforces the properties that make the harness
 * trustworthy and the handoff complete: no dynamic code execution, no shell, no cloud calls,
 * no secrets, no dependency creep, no out-of-scope capability, complete required sections in
 * every skill and SOP, and a syntax check of every module.
 *
 * @module scripts/lint
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
/** @type {string[]} */
const violations = [];
/** @type {string[]} */
const notes = [];

/**
 * @param {string} message
 */
function fail(message) {
  violations.push(message);
}

/**
 * @param {string} message
 */
function note(message) {
  notes.push(message);
}

/** @param {string} dir @param {string[]} [out] */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.git', 'var', 'results'].includes(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const allFiles = walk(ROOT);
const srcFiles = allFiles.filter((file) => relative(ROOT, file).startsWith('src'));
const mjsFiles = allFiles.filter((file) => extname(file) === '.mjs');

// ---------------------------------------------------------------- 1. syntax
for (const file of mjsFiles) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) fail(`syntax error in ${relative(ROOT, file)}: ${(check.stderr || '').split('\n')[0]}`);
}

// ---------------------------------------------------------------- 2. forbidden code in src/
// One documented exception: src/models/llama-server-provider.mjs owns a local engine process and
// therefore imports `spawn`. It never uses a shell, never interpolates model or user input into the
// argument list, and is the only module allowed to do this (checked by the rules below).
const PROCESS_OWNER = 'src/models/llama-server-provider.mjs';
const FORBIDDEN = [
  { pattern: /child_process/, message: 'child_process is forbidden in src/ (no shell execution)' },
  { pattern: /\beval\s*\(/, message: 'eval is forbidden' },
  { pattern: /new\s+Function/, message: 'new Function is forbidden' },
  { pattern: /from\s+'node:vm'|require\('node:vm'\)/, message: 'the vm module is forbidden' },
  { pattern: /process\.env/, message: 'process.env is forbidden in src/ (configuration is explicit; secrets never come from the environment)' },
  { pattern: /https?:\/\/(?!127\.0\.0\.1|localhost|\[::1\])/, message: 'non-loopback URL literal is forbidden in src/' },
  { pattern: /\bTODO\b|\bFIXME\b/, message: 'TODO/FIXME markers are not allowed; record deferrals in the docs instead' },
  { pattern: /require\s*\(/, message: 'CommonJS require is forbidden in ESM modules' }
];
for (const file of srcFiles) {
  const rel = relative(ROOT, file).split('\\').join('/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (const rule of FORBIDDEN) {
    lines.forEach((line, index) => {
      const isComment = line.trim().startsWith('*') || line.trim().startsWith('//');
      if (isComment) return;
      if (rule.pattern.test(line)) {
        if (rule.pattern.source === 'child_process' && rel === PROCESS_OWNER) return;
        fail(`${relative(ROOT, file)}:${index + 1} ${rule.message}`);
      }
    });
  }
  // No shell, anywhere, ever.
  lines.forEach((line, index) => {
    if (/shell\s*:\s*true/.test(line)) fail(`${relative(ROOT, file)}:${index + 1} shell: true is forbidden`);
  });
}

// ---------------------------------------------------------------- 3. secret patterns
const SECRET_PATTERNS = [
  { pattern: /AKIA[0-9A-Z]{16}/, message: 'AWS access key pattern' },
  { pattern: /gh[pousr]_[A-Za-z0-9]{30,}/, message: 'GitHub token pattern' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, message: 'private key block' },
  { pattern: /sk-[A-Za-z0-9]{32,}/, message: 'API key pattern' }
];
for (const file of allFiles) {
  const rel = relative(ROOT, file);
  if (rel.endsWith('.jsonl') || rel.includes('benchmarks' + '\\results')) continue;
  if (!['.mjs', '.json', '.md', '.yml', '.yaml'].includes(extname(file))) continue;
  const text = readFileSync(file, 'utf8');
  for (const rule of SECRET_PATTERNS) {
    if (rule.pattern.test(text)) fail(`${rel}: contains a ${rule.message}`);
  }
}

// ---------------------------------------------------------------- 4. out-of-scope capabilities
const OUT_OF_SCOPE = /\b(tax engine|payroll|barcode|face recognition|facial recognition|regulatory submission|payment processing|bank transfer)\b/i;
for (const file of [...srcFiles, join(ROOT, 'config/harness.config.json')]) {
  if (!existsSync(file)) continue;
  // Comments may (and do) name these things in order to forbid them; code may not mention them.
  for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    const hit = OUT_OF_SCOPE.exec(line);
    if (hit) fail(`${relative(ROOT, file)}:${index + 1} mentions out-of-scope functionality "${hit[0]}"`);
  }
}

// ---------------------------------------------------------------- 5. dependencies
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  const deps = pkg[field] ?? {};
  if (Object.keys(deps).length > 0) fail(`package.json declares ${field}: ${Object.keys(deps).join(', ')} (this repository is dependency-free by design)`);
}

// ---------------------------------------------------------------- 6. safe defaults
const config = JSON.parse(readFileSync(join(ROOT, 'config/harness.config.json'), 'utf8'));
if (config.adapters?.http?.enabled !== false) fail('config/harness.config.json: adapters.http.enabled must default to false');
if (config.provider?.allowNonLocalProvider !== false) fail('config/harness.config.json: provider.allowNonLocalProvider must default to false');
if (config.provider?.baseUrl !== 'http://127.0.0.1:11434') fail('config/harness.config.json: provider.baseUrl must default to loopback Ollama');
if (!Array.isArray(config.policy?.requireConfirmationFor) || !config.policy.requireConfirmationFor.includes('FINANCIAL')) {
  fail('config/harness.config.json: FINANCIAL must require confirmation');
}
if (!/^REPLACE_WITH_YOUR_MODEL$/.test(String(config.provider?.model))) {
  note('config/harness.config.json: provider.model is set; make sure no model family is presented as required by the harness');
}

// ---------------------------------------------------------------- 7. required artefacts
const REQUIRED_FILES = [
  'README.md',
  'COLLABORATOR_AGENT_NOTES.md',
  'docs/ARCHITECTURE.md',
  'docs/RECONNAISSANCE.md',
  'docs/THREAT_MODEL.md',
  'docs/INTEGRATION_CONTRACT.md',
  'docs/BENCHMARK.md',
  'docs/CAPABILITY_AWARENESS.md',
  'docs/REQUIREMENTS_TRACEABILITY.md',
  'docs/research/RESEARCH_LEDGER.md',
  'docs/research/RESEARCH_TO_IMPLEMENTATION_MATRIX.md',
  'docs/matrices/DEPENDENCY_MATRIX.md',
  'docs/matrices/THREAT_MATRIX.md',
  'docs/matrices/FAILURE_MATRIX.md',
  'docs/matrices/DECISION_MATRIX.md',
  'docs/matrices/ASSUMPTION_MATRIX.md',
  'docs/reviews/DESIGN_CRITIC.md',
  'docs/reviews/IMPLEMENTATION_CRITIC.md',
  'docs/reviews/MINIMALITY_REVIEW.md',
  'docs/reviews/HANDOFF_AUDIT.md',
  'prompts/accounting-resident.sop.md',
  'prompts/resident-base-contract.md',
  'benchmarks/prompts.jsonl',
  'benchmarks/run-benchmark.mjs',
  'config/harness.config.json'
];
for (const file of REQUIRED_FILES) {
  if (!existsSync(join(ROOT, file))) fail(`missing required artefact: ${file}`);
}
for (const dir of ['skills/runtime', 'skills/engineering', 'sops/runtime', 'sops/engineering']) {
  if (!existsSync(join(ROOT, dir))) fail(`missing required directory: ${dir}`);
}

// ---------------------------------------------------------------- 8. skill and SOP sections
const SKILL_SECTIONS = [
  '## Purpose',
  '## When to activate',
  '## When NOT to activate',
  '## Trusted inputs',
  '## Untrusted inputs',
  '## Prerequisites',
  '## Procedure',
  '## Decision points',
  '## Prohibited behaviour',
  '## Stop conditions',
  '## Failure states',
  '## Verification',
  '## Expected outputs',
  '## Dependencies',
  '## References',
  '## Examples',
  '## Anti-patterns'
];
const ENGINEERING_SKILL_SECTIONS = [
  '## Purpose',
  '## When to use',
  '## When NOT to use',
  '## Prerequisites',
  '## Inputs',
  '## Procedure',
  '## Decision points',
  '## Failure conditions',
  '## Stop conditions',
  '## Security considerations',
  '## Verification',
  '## Expected outputs',
  '## Dependencies',
  '## References',
  '## Examples',
  '## Anti-patterns'
];
const SOP_SECTIONS = [
  '## Objective',
  '## Prerequisites',
  '## Procedure',
  '## Gates',
  '## Expected evidence',
  '## Failure conditions',
  '## Completion criteria'
];

/**
 * @param {string} dir
 * @param {string[]} sections
 * @param {string} label
 */
function checkSections(dir, sections, label) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return;
  const files = /** @type {string[]} */ (readdirSync(full)).filter((name) => name.endsWith('.md') && name !== 'README.md');
  if (files.length === 0) fail(`${dir}: no ${label} files found`);
  for (const name of files) {
    const text = readFileSync(join(full, name), 'utf8');
    const label2 = label === 'skill' ? text.match(/^---[\s\S]*?---/) : null;
    for (const section of sections) {
      // A section entry may offer alternatives separated by '|': SOP authors legitimately used
      // both "Rollback / recovery" and "Recovery / rollback".
      const alternatives = section.split('|');
      if (!alternatives.some((candidate) => text.includes(candidate))) {
        fail(`${dir}/${name}: missing section "${alternatives[0]}"`);
      }
    }
    if (label === 'skill') {
      if (!text.startsWith('---')) fail(`${dir}/${name}: missing YAML frontmatter`);
      if (!/name:\s*\S+/.test(text)) fail(`${dir}/${name}: frontmatter is missing "name"`);
      if (!/description:\s*\S+/.test(text)) fail(`${dir}/${name}: frontmatter is missing "description"`);
    }
    void label2;
  }
  return files.length;
}

const runtimeSkills = checkSections('skills/runtime', SKILL_SECTIONS, 'runtime skill') ?? 0;
const engineeringSkills = checkSections('skills/engineering', ENGINEERING_SKILL_SECTIONS, 'engineering skill') ?? 0;
const runtimeSops = checkSections('sops/runtime', [...SOP_SECTIONS, '## Rollback / recovery|## Recovery / rollback|## Rollback/recovery|## Recovery/rollback'], 'runtime SOP') ?? 0;
const engineeringSops = checkSections('sops/engineering', [...SOP_SECTIONS, '## Recovery / rollback|## Rollback / recovery|## Recovery/rollback|## Rollback/recovery'], 'engineering SOP') ?? 0;

// ---------------------------------------------------------------- 9. resident SOP prohibitions
const sop = readFileSync(join(ROOT, 'prompts/accounting-resident.sop.md'), 'utf8');
for (const required of [
  'Never invent capability names',
  'Never assume execution occurred',
  'Never try to bypass confirmation',
  'Never perform accounting arithmetic the domain owns',
  'Never pretend missing information exists'
]) {
  if (!sop.includes(required)) fail(`prompts/accounting-resident.sop.md: missing required prohibition "${required}"`);
}

// ---------------------------------------------------------------- 10. collaboration record headings
const notesText = readFileSync(join(ROOT, 'COLLABORATOR_AGENT_NOTES.md'), 'utf8');
for (const heading of [
  '## Project Purpose',
  '## Current State',
  '## Known Facts',
  '## Unverified Claims / Unknowns',
  '## Constraints',
  '## Architectural Laws',
  '## Decisions',
  '## Decision Reversals',
  '## Research Findings',
  '## Dependencies',
  '## Threats',
  '## Failure Modes',
  '## Assumptions',
  '## Tests / Evidence',
  '## Work Completed',
  '## Work Rejected',
  '## Current Blockers',
  '## Open Questions',
  '## Next Smallest Step',
  '## Handoff Instructions',
  '## Change Log'
]) {
  if (!notesText.includes(heading)) fail(`COLLABORATOR_AGENT_NOTES.md: missing section "${heading}"`);
}

// ---------------------------------------------------------------- 11. benchmark fixture sanity
const fixtureLines = readFileSync(join(ROOT, 'benchmarks/prompts.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line.trim().length > 0 && !line.trim().startsWith('#'));
if (fixtureLines.length < 25) fail(`benchmarks/prompts.jsonl: only ${fixtureLines.length} cases; the directive requires at least 25`);
for (const line of fixtureLines) {
  const entry = JSON.parse(line);
  if (!entry.id || !entry.category || !Array.isArray(entry.turns)) fail(`benchmarks/prompts.jsonl: malformed case ${line.slice(0, 60)}`);
}

// ---------------------------------------------------------------- report
process.stdout.write(`lint: ${allFiles.length} files scanned\n`);
process.stdout.write(
  `lint: skills ${runtimeSkills} runtime + ${engineeringSkills} engineering · sops ${runtimeSops} runtime + ${engineeringSops} engineering · fixture cases ${fixtureLines.length}\n`
);
for (const message of notes) process.stdout.write(`lint note: ${message}\n`);
if (violations.length === 0) {
  process.stdout.write('lint: OK (no violations)\n');
  process.exit(0);
}
for (const message of violations) process.stderr.write(`lint violation: ${message}\n`);
process.stderr.write(`lint: FAILED with ${violations.length} violation(s)\n`);
process.exit(1);
