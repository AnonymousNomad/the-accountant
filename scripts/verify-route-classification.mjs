#!/usr/bin/env node
/**
 * Route-classification gate (Milestone 1.4b).
 *
 * Every synthetic route must be in exactly one class, and the three classes must sum to the
 * generated route count. This turns the recorded observation in docs/EXPERIMENT_NOMENCLATURE.md
 * into a deterministic gate: if the topology generator changes shape, this fails loudly instead of
 * silently changing what the experiment means.
 *
 * Classes (see the nomenclature document for the normative definition):
 *   MAPPED_TO_CAPABILITY              the route declares a semanticCapability
 *   INTENDED_AI_CAPABILITY_BUT_UNMAPPED  no mapping, but the action verb and domain are
 *                                        AI-relevant (present in at least one mapped route)
 *   INTERNAL_ONLY                     everything else; NOT a backlog of future AI tools
 *
 * Expected synthetic parameters (not claims about any real system): 52 / 178 / 164 = 394.
 *
 * @module scripts/verify-route-classification
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROUTES = resolve(process.cwd(), 'simulation', 'generated-routes.json');
const EXPECTED = Object.freeze({
  MAPPED_TO_CAPABILITY: 52,
  INTENDED_AI_CAPABILITY_BUT_UNMAPPED: 178,
  INTERNAL_ONLY: 164,
  total: 394
});

/** @type {{ id: string, domain: string, semanticCapability: string|null }[]} */
let routes;
try {
  routes = JSON.parse(readFileSync(ROUTES, 'utf8')).routes;
} catch (err) {
  process.stderr.write(`route-classification: cannot read ${ROUTES}: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
}

const verbOf = (/** @type {{ id: string }} */ route) => String(route.id).split('.').pop() ?? '';
const mapped = routes.filter((route) => route.semanticCapability);
const mappedVerbs = new Set(mapped.map(verbOf));
const mappedDomains = new Set(mapped.map((route) => route.domain));

/** @type {Record<string, string[]>} */
const classes = {};
for (const route of routes) {
  const label = route.semanticCapability
    ? 'MAPPED_TO_CAPABILITY'
    : mappedVerbs.has(verbOf(route)) && mappedDomains.has(route.domain)
      ? 'INTENDED_AI_CAPABILITY_BUT_UNMAPPED'
      : 'INTERNAL_ONLY';
  (classes[label] ??= []).push(String(route.id));
}

const counts = {
  MAPPED_TO_CAPABILITY: (classes.MAPPED_TO_CAPABILITY ?? []).length,
  INTENDED_AI_CAPABILITY_BUT_UNMAPPED: (classes.INTENDED_AI_CAPABILITY_BUT_UNMAPPED ?? []).length,
  INTERNAL_ONLY: (classes.INTERNAL_ONLY ?? []).length
};
const classified = counts.MAPPED_TO_CAPABILITY + counts.INTENDED_AI_CAPABILITY_BUT_UNMAPPED + counts.INTERNAL_ONLY;

const failures = [];
if (counts.MAPPED_TO_CAPABILITY !== EXPECTED.MAPPED_TO_CAPABILITY) {
  failures.push(`MAPPED_TO_CAPABILITY expected ${EXPECTED.MAPPED_TO_CAPABILITY}, observed ${counts.MAPPED_TO_CAPABILITY}`);
}
if (counts.INTENDED_AI_CAPABILITY_BUT_UNMAPPED !== EXPECTED.INTENDED_AI_CAPABILITY_BUT_UNMAPPED) {
  failures.push(
    `INTENDED_AI_CAPABILITY_BUT_UNMAPPED expected ${EXPECTED.INTENDED_AI_CAPABILITY_BUT_UNMAPPED}, observed ${counts.INTENDED_AI_CAPABILITY_BUT_UNMAPPED}`
  );
}
if (counts.INTERNAL_ONLY !== EXPECTED.INTERNAL_ONLY) {
  failures.push(`INTERNAL_ONLY expected ${EXPECTED.INTERNAL_ONLY}, observed ${counts.INTERNAL_ONLY}`);
}
if (classified !== routes.length) {
  failures.push(`classes sum to ${classified} but there are ${routes.length} routes (no route may be unclassified or double-classed)`);
}
if (routes.length !== EXPECTED.total) {
  failures.push(`route count expected ${EXPECTED.total}, observed ${routes.length}`);
}
// The partial-mapping condition the simulation exists to reproduce must remain present.
if (counts.INTENDED_AI_CAPABILITY_BUT_UNMAPPED < 40) {
  failures.push(`only ${counts.INTENDED_AI_CAPABILITY_BUT_UNMAPPED} intended-but-unmapped routes; the simulation requires at least 40`);
}

process.stdout.write('route classification gate\n');
for (const [label, count] of Object.entries(counts)) {
  const expected = /** @type {Record<string, number>} */ (EXPECTED)[label];
  process.stdout.write(`  ${label.padEnd(36)} ${String(count).padStart(4)}  (expected ${expected})  ${count === expected ? 'PASS' : 'FAIL'}\n`);
}
process.stdout.write(`  ${'total'.padEnd(36)} ${String(classified).padStart(4)}  (expected ${EXPECTED.total})  ${classified === EXPECTED.total ? 'PASS' : 'FAIL'}\n`);
process.stdout.write(
  '  collaborator-facing wording: 342 routes are not directly mapped to AI capabilities in this synthetic simulation; of those, 178 are deliberately modelled as AI-relevant operations awaiting mapping; 164 are intentionally internal-only.\n'
);
if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`route-classification violation: ${failure}\n`);
  process.stderr.write(`route-classification: FAILED with ${failures.length} violation(s)\n`);
  process.exit(1);
}
process.stdout.write('route-classification: OK\n');
process.exit(0);
