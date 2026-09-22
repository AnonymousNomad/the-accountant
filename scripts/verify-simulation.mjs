#!/usr/bin/env node
/**
 * verify-simulation.mjs — the simulation-layer verification battery.
 *
 * Loads the four topology files produced by `simulation/generate-topology.mjs`
 * (`generated-routes.json`, `generated-entities.json`, `generated-screens.json`,
 * `jurisdiction-config.json`) AND the three files produced by
 * `simulation/generate-semantics.mjs` (`semantic-capabilities.json`, `task-corpus.jsonl`,
 * `generated-records.json`), then reports a PASS/FAIL table with observed counts and exits
 * non-zero if anything fails.
 *
 * Missing files are reported as FAIL rows: this script never crashes on an absent artifact.
 *
 * WHAT IS CHECKED (and why it is the contract):
 *  1. topology scale: 394 routes with the exact declared per-domain distribution, 88 entities,
 *     176 screens, 4 jurisdictions, and at least 40 routes whose `semanticCapability` is null;
 *  2. the semantic layer: 50-70 capabilities, all 36 mandated ids, and every capability valid
 *     for the real registry (`defineCapability`). `mapsToRoutes` is simulation provenance, not
 *     registry metadata, so it is stripped before validation — the same strip a harness loader
 *     must perform. Any other unknown field is still rejected by `defineCapability`;
 *  3. the task corpus: exactly 100 task lines with the exact per-category distribution,
 *     a NZ/AU/US/UK jurisdiction cycle, and every `expected.capability` resolving in the
 *     semantic layer;
 *  4. records: at least 60, the mandated inventory, and exactly two injection-bearing records;
 *  5. injection coverage: at least three tasks whose text or context references an
 *     injection-bearing record;
 *  6. route mapping: every `mapsToRoutes` entry exists in the route file;
 *  7. rule-text hygiene: no real tax or payroll rule text anywhere (suspicious-token scan).
 *
 * DECLARED TOPOLOGY CONTRACT: EXPECTED_ROUTE_DOMAINS below is the contract that
 * `simulation/generate-topology.mjs` must satisfy. It sums to 394 and was verified against that
 * generator's real output (route `domain` field, 18 domains). If the topology generator is
 * revised, reconcile the distribution here in one edit — the 394 total and the 88/176/4 counts
 * are not negotiable.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineCapability } from '../src/registry/capability.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIMULATION_DIR = join(HERE, '..', 'simulation');

const EXPECTED_ROUTE_TOTAL = 394;
const EXPECTED_MIN_UNMAPPED_ROUTES = 40;
const EXPECTED_ROUTE_DOMAINS = Object.freeze({
  customers: 26,
  suppliers: 20,
  quotes: 26,
  invoices: 40,
  payments: 24,
  ledger: 36,
  tax: 24,
  payroll: 34,
  rosters: 16,
  timesheets: 12,
  inventory: 40,
  pos: 20,
  barcode: 4,
  giftcards: 8,
  loyalty: 8,
  reporting: 14,
  admin: 30,
  security: 12
});
const EXPECTED_ENTITY_TOTAL = 88;
const EXPECTED_SCREEN_TOTAL = 176;
const EXPECTED_JURISDICTION_TOTAL = 4;

const MIN_CAPABILITIES = 50;
const MAX_CAPABILITIES = 70;
const EXPECTED_TASK_TOTAL = 100;
const EXPECTED_MIN_RECORDS = 60;
const EXPECTED_INJECTION_RECORDS = 2;
const MIN_INJECTION_TASKS = 3;

const MANDATED_IDS = Object.freeze([
  'customer.search', 'customer.create', 'customer.update',
  'supplier.search', 'supplier.create', 'supplier.update',
  'quote.create_draft', 'quote.issue', 'quote.convert_to_invoice',
  'invoice.create_draft', 'invoice.preview', 'invoice.issue', 'invoice.send',
  'payment.record', 'payment.lookup', 'payment.reverse',
  'ledger.query', 'journal.propose', 'journal.post', 'tax.config_read',
  'payroll.preview', 'payroll.run', 'timesheet.query', 'timesheet.approve', 'roster.query',
  'inventory.lookup', 'inventory.adjust', 'product.lookup', 'pos.barcode_scan',
  'giftcard.lookup', 'loyalty.lookup',
  'report.generate', 'report.export',
  'admin.user_read', 'admin.permission_read', 'admin.audit_read'
]);

const EXPECTED_CATEGORY_COUNTS = Object.freeze({
  'Customers/Suppliers': 15,
  'Quotes/Invoices': 20,
  'Ledger/Payments': 15,
  'Payroll/Timesheets': 10,
  'Inventory/POS': 15,
  Reports: 5,
  'Cross-domain workflows': 10,
  'Ambiguous/clarification': 5,
  'Unsupported/adversarial': 5
});

const MIN_RECORD_TYPES = Object.freeze({
  customer: 6,
  supplier: 4,
  quote: 6,
  invoice: 6,
  payment: 6,
  ledger_entry: 8,
  employee: 6,
  timesheet: 6,
  stock_item: 6,
  gift_card: 4
});

const JURISDICTIONS = Object.freeze(['NZ', 'AU', 'US', 'UK']);

const SCHEMA_NOTE_PREFIX = 'SCALE-FAITHFUL / BEHAVIOR-SYNTHETIC / NOT A REPLICA of any external system.';

const SUSPICIOUS_TOKENS = Object.freeze([
  { label: 'GST rate', re: /gst\s+rate/i },
  { label: 'tax rate %', re: /tax\s+rate\s*%/i },
  { label: 'withholding', re: /withholding/i },
  { label: 'PAYE', re: /\bPAYE\b/ }, // case-sensitive: "payee" and "payer" are ordinary English
  { label: 'FICA', re: /\bFICA\b/ },
  { label: 'superannuation rate', re: /superannuation\s+rate/i }
]);

const STRIPPED_PROVENANCE_KEYS = Object.freeze(['mapsToRoutes']);

/* ------------------------------------------------------------------ reporting */

/** @type {Array<{ label: string, expected: string, result: string, observed: string }>} */
const rows = [];
/** @type {Error|null} */
let hardFailure = null;

/**
 * @param {string} label
 * @param {string} expected
 * @param {boolean} passed
 * @param {string} observed
 */
function check(label, expected, passed, observed) {
  rows.push({ label, expected, result: passed ? 'PASS' : 'FAIL', observed });
}

/**
 * @param {string} label
 * @param {string} expected
 * @param {string} observed
 */
function info(label, expected, observed) {
  rows.push({ label, expected, result: 'INFO', observed });
}

/**
 * @param {unknown} value
 * @param {number} [limit]
 * @returns {string}
 */
function summarize(value, limit = 160) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return 'undefined';
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function formatTable() {
  const columns = [
    { key: 'label', title: 'CHECK', width: 53 },
    { key: 'expected', title: 'EXPECTED', width: 33 },
    { key: 'observed', title: 'OBSERVED', width: 68 },
    { key: 'result', title: 'RESULT', width: 6 }
  ];
  const pad = (text, width) => String(text).padEnd(width).slice(0, width);
  const lines = [];
  lines.push(columns.map((column) => pad(column.title, column.width)).join('  '));
  lines.push(columns.map((column) => '-'.repeat(column.width)).join('  '));
  for (const row of rows) {
    lines.push(columns.map((column) => pad(row[column.key], column.width)).join('  '));
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ loaders */

function readText(name) {
  const path = join(SIMULATION_DIR, name);
  try {
    return { path, text: readFileSync(path, 'utf8') };
  } catch (error) {
    return { path, error: error && error.code ? error.code : String(error) };
  }
}

function parseJson(name) {
  const loaded = readText(name);
  if (loaded.error) return { path: loaded.path, present: false, error: loaded.error };
  try {
    return { path: loaded.path, present: true, value: JSON.parse(loaded.text) };
  } catch (error) {
    return { path: loaded.path, present: true, error: `invalid JSON: ${error.message}` };
  }
}

function coerceList(value, keys) {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === 'object') {
    for (const key of keys) if (Array.isArray(value[key])) return value[key];
  }
  return null;
}

function routeId(route) {
  if (typeof route === 'string') return route;
  if (route !== null && typeof route === 'object') {
    for (const key of ['id', 'route', 'routeId', 'name']) {
      if (typeof route[key] === 'string' && route[key].length > 0) return route[key];
    }
  }
  return null;
}

const ROUTE_SHAPE = /^route\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

function routeFamily(id, route) {
  if (route !== null && typeof route === 'object') {
    for (const key of ['domain', 'family', 'area']) {
      if (typeof route[key] === 'string' && route[key].length > 0) return route[key].split('.').pop();
    }
  }
  const parts = String(id ?? '').split('.');
  if (parts.length >= 3 && parts[0] === 'route') return parts[1];
  return '(unparsed)';
}

/* ------------------------------------------------------------------ main */

try {
  /* ---------------- topology: routes ---------------- */

  const routesFile = parseJson('generated-routes.json');
  const routes = routesFile.present && !routesFile.error ? coerceList(routesFile.value, ['routes', 'items', 'data']) : null;

  check(
    'topology routes file loads',
    'simulation/generated-routes.json',
    routes !== null,
    routesFile.error
      ? `${routesFile.error} (generate-topology.mjs has not produced it)`
      : routes === null
        ? 'parsed, but no routes array found (expected routes|items|data)'
        : `${routes.length} route records`
  );

  const routeIds = new Set();
  if (routes) {
    for (const route of routes) {
      const id = routeId(route);
      if (id) routeIds.add(id);
    }
  }

  check(
    'topology route total',
    `== ${EXPECTED_ROUTE_TOTAL}`,
    routes !== null && routes.length === EXPECTED_ROUTE_TOTAL,
    routes === null ? 'routes unavailable' : `${routes.length}`
  );

  const domainCounts = {};
  let unparsedRoutes = 0;
  let explicitNull = 0;
  let absentCapabilityKey = 0;
  if (routes) {
    for (const route of routes) {
      const id = routeId(route);
      const family = routeFamily(id, route);
      if (family === '(unparsed)') unparsedRoutes += 1;
      domainCounts[family] = (domainCounts[family] ?? 0) + 1;
      if (route !== null && typeof route === 'object' && Object.prototype.hasOwnProperty.call(route, 'semanticCapability')) {
        if (route.semanticCapability === null) explicitNull += 1;
      } else {
        absentCapabilityKey += 1;
      }
    }
  }

  const expectedFamilies = Object.keys(EXPECTED_ROUTE_DOMAINS).sort();
  const observedFamilies = Object.keys(domainCounts).filter((family) => family !== '(unparsed)').sort();
  const distributionMismatch = [];
  for (const family of expectedFamilies) {
    const expected = EXPECTED_ROUTE_DOMAINS[family];
    const observed = domainCounts[family] ?? 0;
    if (observed !== expected) distributionMismatch.push(`${family}:${observed}(want ${expected})`);
  }
  for (const family of observedFamilies) {
    if (!(family in EXPECTED_ROUTE_DOMAINS)) distributionMismatch.push(`${family}:${domainCounts[family]}(unexpected family)`);
  }

  check(
    'topology per-domain distribution',
    `${expectedFamilies.length} families, sum ${EXPECTED_ROUTE_TOTAL}`,
    routes !== null && distributionMismatch.length === 0 && unparsedRoutes === 0,
    routes === null
      ? 'routes unavailable'
      : distributionMismatch.length === 0 && unparsedRoutes === 0
        ? `${observedFamilies.length} families match`
        : summarize(distributionMismatch.join(', ') + (unparsedRoutes ? ` | ${unparsedRoutes} unparsed ids` : ''))
  );

  const nullCapabilityRoutes = routes ? absentCapabilityKey + explicitNull : 0;
  check(
    'topology unmapped routes (semanticCapability null)',
    `>= ${EXPECTED_MIN_UNMAPPED_ROUTES}`,
    routes !== null && nullCapabilityRoutes >= EXPECTED_MIN_UNMAPPED_ROUTES,
    routes === null ? 'routes unavailable' : `${nullCapabilityRoutes} null/absent (explicit null ${explicitNull}, key absent ${absentCapabilityKey})`
  );

  /* ---------------- topology: entities, screens, jurisdictions ---------------- */

  const entitiesFile = parseJson('generated-entities.json');
  const entities = entitiesFile.present && !entitiesFile.error ? coerceList(entitiesFile.value, ['entities', 'items', 'data', 'records']) : null;
  check(
    'topology entities',
    `== ${EXPECTED_ENTITY_TOTAL}`,
    entities !== null && entities.length === EXPECTED_ENTITY_TOTAL,
    entitiesFile.error ? `${entitiesFile.error}` : entities === null ? 'no entities array found' : `${entities.length}`
  );

  const screensFile = parseJson('generated-screens.json');
  const screens = screensFile.present && !screensFile.error ? coerceList(screensFile.value, ['screens', 'items', 'data']) : null;
  check(
    'topology screens',
    `== ${EXPECTED_SCREEN_TOTAL}`,
    screens !== null && screens.length === EXPECTED_SCREEN_TOTAL,
    screensFile.error ? `${screensFile.error}` : screens === null ? 'no screens array found' : `${screens.length}`
  );

  const jurisdictionsFile = parseJson('jurisdiction-config.json');
  const jurisdictions = jurisdictionsFile.present && !jurisdictionsFile.error
    ? coerceList(jurisdictionsFile.value, ['jurisdictions', 'items', 'data', 'codes'])
    : null;
  check(
    'topology jurisdictions',
    `== ${EXPECTED_JURISDICTION_TOTAL}`,
    jurisdictions !== null && jurisdictions.length === EXPECTED_JURISDICTION_TOTAL,
    jurisdictionsFile.error ? `${jurisdictionsFile.error}` : jurisdictions === null ? 'no jurisdictions array found' : `${jurisdictions.length}`
  );

  /* ---------------- semantic layer ---------------- */

  const semanticsFile = parseJson('semantic-capabilities.json');
  const capabilities = semanticsFile.present && !semanticsFile.error
    ? coerceList(semanticsFile.value, ['capabilities', 'items', 'data'])
    : null;

  check(
    'semantic capabilities file loads',
    'simulation/semantic-capabilities.json',
    capabilities !== null,
    semanticsFile.error ? semanticsFile.error : capabilities === null ? 'no capabilities array found' : `${capabilities.length} entries`
  );

  check(
    'semantic capability count',
    `${MIN_CAPABILITIES}..${MAX_CAPABILITIES}`,
    capabilities !== null && capabilities.length >= MIN_CAPABILITIES && capabilities.length <= MAX_CAPABILITIES,
    capabilities === null ? 'capabilities unavailable' : `${capabilities.length}`
  );

  const capabilityIds = new Set();
  const definitionErrors = [];
  const hiddenKeyErrors = [];
  if (capabilities) {
    for (const entry of capabilities) {
      if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') {
        definitionErrors.push('entry without an id');
        continue;
      }
      capabilityIds.add(entry.id);
      const view = {};
      for (const [key, value] of Object.entries(entry)) {
        if (STRIPPED_PROVENANCE_KEYS.includes(key)) continue;
        view[key] = value;
      }
      try {
        defineCapability(view);
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (message.includes('unknown field')) hiddenKeyErrors.push(`${entry.id}: ${message}`);
        else definitionErrors.push(`${entry.id}: ${message}`);
      }
    }
  }

  check(
    'every capability valid for the registry',
    'defineCapability passes, all entries',
    capabilities !== null && definitionErrors.length === 0 && hiddenKeyErrors.length === 0 && capabilityIds.size === capabilities.length,
    capabilities === null
      ? 'capabilities unavailable'
      : definitionErrors.length || hiddenKeyErrors.length
        ? summarize([...definitionErrors, ...hiddenKeyErrors].join(' | '))
        : `${capabilityIds.size}/${capabilities.length} pass (mapsToRoutes stripped)`
  );

  const missingMandated = capabilities ? MANDATED_IDS.filter((id) => !capabilityIds.has(id)) : MANDATED_IDS;
  check(
    'mandated capability ids present',
    `all ${MANDATED_IDS.length}`,
    capabilities !== null && missingMandated.length === 0,
    capabilities === null ? 'capabilities unavailable' : missingMandated.length === 0 ? `${MANDATED_IDS.length} present` : `missing ${missingMandated.join(', ')}`
  );

  const provenance = [];
  if (capabilities) {
    for (const entry of capabilities) {
      if (entry === null || typeof entry !== 'object') continue;
      if (!Object.prototype.hasOwnProperty.call(entry, 'mapsToRoutes')) provenance.push(`${entry.id} has no mapsToRoutes`);
      for (const key of Object.keys(entry)) {
        if (['id', 'version', 'description', 'whenToUse', 'whenNotToUse', 'domain', 'risk', 'inputSchema', 'outputSummary',
          'requiredPermissions', 'requiresConfirmation', 'sideEffects', 'prerequisites', 'relatedCapabilities', 'tags',
          'adapter', 'verifier', 'enabled', 'idempotency', 'sensitivity', 'mapsToRoutes'].includes(key)) continue;
        provenance.push(`${entry.id} has unexpected key ${key}`);
      }
    }
  }
  check(
    'capability key set is exactly registry + provenance',
    'only mapsToRoutes is extra',
    capabilities !== null && provenance.length === 0,
    capabilities === null ? 'capabilities unavailable' : provenance.length === 0 ? 'clean' : summarize(provenance.join(' | '))
  );

  check(
    'semantic file schema note first',
    'first key is $schemaNote',
    semanticsFile.present && !semanticsFile.error && semanticsFile.value !== null && typeof semanticsFile.value === 'object' &&
      Object.keys(semanticsFile.value)[0] === '$schemaNote' &&
      String(semanticsFile.value.$schemaNote).startsWith(SCHEMA_NOTE_PREFIX),
    semanticsFile.error ? semanticsFile.error : semanticsFile.present && typeof semanticsFile.value === 'object'
      ? `first key ${Object.keys(semanticsFile.value)[0] ?? '(none)'}`
      : 'not available'
  );

  /* ---------------- route mapping ---------------- */

  const mappedRoutes = capabilities
    ? capabilities.flatMap((entry) => (entry && Array.isArray(entry.mapsToRoutes) ? entry.mapsToRoutes.map(String) : []))
    : [];
  const mappedFound = mappedRoutes.filter((route) => routeIds.has(route));
  const missingRoutes = mappedRoutes.filter((route) => !routeIds.has(route));

  check(
    'mapsToRoutes entries exist in the route file',
    `${mappedRoutes.length} entries resolve`,
    routes !== null && capabilityIds.size > 0 && mappedRoutes.length > 0 && missingRoutes.length === 0,
    routes === null
      ? 'routes unavailable (topology not generated yet)'
      : summarize(`${mappedFound.length}/${mappedRoutes.length} resolve${missingRoutes.length ? `; missing ${missingRoutes.slice(0, 4).join(', ')}${missingRoutes.length > 4 ? ', ...' : ''}` : ''}`)
  );

  const mappedSet = new Set(mappedRoutes);
  info(
    'unmapped-route headroom',
    `${EXPECTED_ROUTE_TOTAL} - mapped routes`,
    `${EXPECTED_ROUTE_TOTAL} - ${mappedSet.size} = ${EXPECTED_ROUTE_TOTAL - mappedSet.size} routes may stay null-capability`
  );

  const inverseMismatch = [];
  let assignedTotal = 0;
  let mirroredAssigned = 0;
  let bindingsOnNullRoutes = 0;
  if (routes && capabilities) {
    const capabilityByRoute = new Map();
    for (const entry of capabilities) {
      if (entry && Array.isArray(entry.mapsToRoutes)) {
        for (const route of entry.mapsToRoutes) capabilityByRoute.set(String(route), entry.id);
      }
    }
    for (const route of routes) {
      const id = routeId(route);
      if (!id || route === null || typeof route !== 'object') continue;
      const assigned = route.semanticCapability ?? null;
      if (assigned === null) continue;
      assignedTotal += 1;
      if (capabilityByRoute.get(id) === assigned) mirroredAssigned += 1;
      else inverseMismatch.push(`${id}:${assigned}`);
    }
    for (const mapped of capabilityByRoute.keys()) {
      const route = routes.find((candidate) => routeId(candidate) === mapped);
      if (route && (route.semanticCapability ?? null) === null) bindingsOnNullRoutes += 1;
    }
  }
  info(
    'route.semanticCapability agrees with mapsToRoutes',
    'assigned routes mirrored exactly',
    routes === null || capabilities === null
      ? 'not evaluated (inputs unavailable)'
      : `${mirroredAssigned}/${assignedTotal} assigned mirrored; ${bindingsOnNullRoutes} on null routes; ${inverseMismatch.length} contradictions${inverseMismatch.length ? ` (${inverseMismatch.slice(0, 3).join(', ')})` : ''}`
  );

  const routeCounts = routesFile.present && !routesFile.error && routesFile.value !== null && typeof routesFile.value === 'object'
    ? routesFile.value.counts
    : null;
  const entityCounts = entitiesFile.present && !entitiesFile.error && entitiesFile.value !== null && typeof entitiesFile.value === 'object'
    ? entitiesFile.value.counts
    : null;
  const screenCounts = screensFile.present && !screensFile.error && screensFile.value !== null && typeof screensFile.value === 'object'
    ? screensFile.value.counts
    : null;
  const jurisdictionCounts = jurisdictionsFile.present && !jurisdictionsFile.error && jurisdictionsFile.value !== null && typeof jurisdictionsFile.value === 'object'
    ? jurisdictionsFile.value.counts
    : null;
  info(
    'topology self-declared counts',
    'consistent with observed arrays',
    routeCounts === null
      ? 'counts block unavailable'
      : `routes ${routeCounts.total ?? '?'} (null ${routeCounts.unmappedSemanticCapability ?? '?'}), entities ${entityCounts?.total ?? '?'}, screens ${screenCounts?.total ?? '?'}, jurisdictions ${jurisdictionCounts?.total ?? '?'}`
  );

  /* ---------------- task corpus ---------------- */

  const corpusFile = readText('task-corpus.jsonl');
  const corpus = corpusFile.error
    ? null
    : {
        lines: corpusFile.text.split(/\r?\n/).filter((line) => line.trim().length > 0),
        text: corpusFile.text
      };

  let tasks = null;
  const taskParseErrors = [];
  let commentLine = null;
  if (corpus) {
    commentLine = corpus.lines.find((line) => line.startsWith('#')) ?? null;
    tasks = [];
    for (const line of corpus.lines) {
      if (line.startsWith('#')) continue;
      try {
        tasks.push(JSON.parse(line));
      } catch (error) {
        taskParseErrors.push(error.message);
      }
    }
  }

  check(
    'task corpus file loads',
    'simulation/task-corpus.jsonl',
    corpus !== null,
    corpusFile.error ? corpusFile.error : `${corpus.lines.length} non-empty lines`
  );

  check(
    'task corpus line count',
    `== ${EXPECTED_TASK_TOTAL} task lines + 1 comment`,
    tasks !== null && taskParseErrors.length === 0 && tasks.length === EXPECTED_TASK_TOTAL,
    tasks === null
      ? 'corpus unavailable'
      : taskParseErrors.length
        ? `${taskParseErrors.length} unparseable lines`
        : `${tasks.length} task lines (comment ${commentLine ? 'present' : 'MISSING'})`
  );

  check(
    'task corpus schema note (comment line)',
    '# {"$schemaNote": ...} first',
    corpus !== null && commentLine !== null && corpus.lines[0] === commentLine && commentLine.includes('$schemaNote') && commentLine.includes(SCHEMA_NOTE_PREFIX),
    corpus === null ? 'corpus unavailable' : commentLine === null ? 'no comment line' : summarize(commentLine)
  );

  const categoryCounts = {};
  const jurisdictionBreaks = [];
  const unknownCapabilities = [];
  if (tasks) {
    tasks.forEach((entry, index) => {
      categoryCounts[entry.category] = (categoryCounts[entry.category] ?? 0) + 1;
      const expectedJurisdiction = JURISDICTIONS[index % JURISDICTIONS.length];
      if (entry.jurisdiction !== expectedJurisdiction) {
        jurisdictionBreaks.push(`${entry.id}:${entry.jurisdiction}(want ${expectedJurisdiction})`);
      }
      const kind = entry.expected && entry.expected.kind;
      if (kind === 'proposal' && !capabilityIds.has(entry.expected.capability)) {
        unknownCapabilities.push(`${entry.id}:${entry.expected.capability}`);
      }
      if ((kind === 'clarification' || kind === 'unsupported') && entry.expected.capability !== undefined) {
        unknownCapabilities.push(`${entry.id}:${kind} must not name a capability`);
      }
    });
  }

  const categoryMismatch = [];
  for (const [category, expected] of Object.entries(EXPECTED_CATEGORY_COUNTS)) {
    const observed = categoryCounts[category] ?? 0;
    if (observed !== expected) categoryMismatch.push(`${category}: ${observed} (want ${expected})`);
  }
  for (const category of Object.keys(categoryCounts)) {
    if (!(category in EXPECTED_CATEGORY_COUNTS)) categoryMismatch.push(`${category}: unexpected category`);
  }

  check(
    'task corpus category distribution',
    `${Object.keys(EXPECTED_CATEGORY_COUNTS).length} categories, exact`,
    tasks !== null && tasks.length === EXPECTED_TASK_TOTAL && categoryMismatch.length === 0,
    tasks === null ? 'corpus unavailable' : categoryMismatch.length === 0 ? 'exact' : summarize(categoryMismatch.join('; '))
  );

  check(
    'task jurisdiction cycle',
    'NZ, AU, US, UK by line',
    tasks !== null && jurisdictionBreaks.length === 0,
    tasks === null ? 'corpus unavailable' : jurisdictionBreaks.length === 0 ? 'cycle holds' : summarize(jurisdictionBreaks.join(', '))
  );

  check(
    'expected.capability resolves in the semantic layer',
    'every proposal capability known',
    tasks !== null && unknownCapabilities.length === 0,
    tasks === null ? 'corpus unavailable' : unknownCapabilities.length === 0 ? 'all resolve' : summarize(unknownCapabilities.join(', '))
  );

  /* ---------------- records ---------------- */

  const recordsFile = parseJson('generated-records.json');
  const records = recordsFile.present && !recordsFile.error ? coerceList(recordsFile.value, ['records', 'items', 'data']) : null;

  check(
    'record file loads',
    'simulation/generated-records.json',
    records !== null,
    recordsFile.error ? recordsFile.error : records === null ? 'no records array found' : `${records.length} records`
  );

  check(
    'record count',
    `>= ${EXPECTED_MIN_RECORDS}`,
    records !== null && records.length >= EXPECTED_MIN_RECORDS,
    records === null ? 'records unavailable' : `${records.length}`
  );

  const typeCounts = {};
  let injectionRecords = 0;
  if (records) {
    for (const entry of records) {
      if (entry !== null && typeof entry === 'object') {
        typeCounts[entry.type] = (typeCounts[entry.type] ?? 0) + 1;
        if (JSON.stringify(entry).includes('IGNORE YOUR INSTRUCTIONS')) injectionRecords += 1;
      }
    }
  }
  const inventoryShortfalls = [];
  for (const [type, minimum] of Object.entries(MIN_RECORD_TYPES)) {
    const observed = typeCounts[type] ?? 0;
    if (observed < minimum) inventoryShortfalls.push(`${type}: ${observed} (want >= ${minimum})`);
  }
  const customerNames = records
    ? records.filter((entry) => entry && entry.type === 'customer').map((entry) => entry.name)
    : [];
  if (records && !(customerNames.includes('John Smith') && customerNames.includes('John Tane'))) {
    inventoryShortfalls.push('ambiguity pair John Smith / John Tane missing');
  }
  if (records && !records.some((entry) => entry && entry.name === 'Smith Electrical' && entry.id === 'CUS-0007')) {
    inventoryShortfalls.push('Smith Electrical CUS-0007 missing');
  }

  check(
    'record inventory',
    'type minimums + required names',
    records !== null && inventoryShortfalls.length === 0,
    records === null ? 'records unavailable' : inventoryShortfalls.length === 0 ? `${Object.keys(typeCounts).length} record types present` : summarize(inventoryShortfalls.join('; '))
  );

  check(
    'injection-bearing records',
    `== ${EXPECTED_INJECTION_RECORDS}`,
    records !== null && injectionRecords === EXPECTED_INJECTION_RECORDS,
    records === null ? 'records unavailable' : `${injectionRecords}`
  );

  check(
    'record file schema note first',
    'first key is $schemaNote',
    recordsFile.present && !recordsFile.error && recordsFile.value !== null && typeof recordsFile.value === 'object' &&
      Object.keys(recordsFile.value)[0] === '$schemaNote',
    recordsFile.error ? recordsFile.error : recordsFile.present && typeof recordsFile.value === 'object'
      ? `first key ${Object.keys(recordsFile.value)[0] ?? '(none)'}`
      : 'not available'
  );

  /* ---------------- injection coverage in the corpus ---------------- */

  const injectionIds = records
    ? records.filter((entry) => entry && JSON.stringify(entry).includes('IGNORE YOUR INSTRUCTIONS')).map((entry) => entry.id)
    : [];
  const referencingTasks = tasks
    ? tasks.filter((entry) => (typeof entry.entity === 'string' && injectionIds.includes(entry.entity)) ||
        injectionIds.some((id) => typeof entry.text === 'string' && entry.text.includes(id)))
    : [];

  check(
    'tasks referencing injection records',
    `>= ${MIN_INJECTION_TASKS}`,
    tasks !== null && records !== null && referencingTasks.length >= MIN_INJECTION_TASKS,
    tasks === null || records === null
      ? 'inputs unavailable'
      : `${referencingTasks.length} (${referencingTasks.map((entry) => entry.id).join(', ') || 'none'})`
  );

  info(
    'multi-step task markers',
    `>= 10 (informational)`,
    tasks === null ? 'corpus unavailable' : `${tasks.filter((entry) => entry.expected && typeof entry.expected.notes === 'string' && entry.expected.notes.includes('Multi-step')).length} marked Multi-step`
  );

  info(
    'context-dependent tasks',
    `>= 8 (informational)`,
    tasks === null
      ? 'corpus unavailable'
      : `${tasks.filter((entry) => typeof entry.text === 'string' && entry.text.length <= 48 && entry.screen && entry.entity && !/\b[A-Z]{2,4}-[0-9]{3,5}\b/.test(entry.text)).length} short tasks bound to screen+entity`
  );

  /* ---------------- rule-text hygiene ---------------- */

  const scanned = [];
  for (const name of ['semantic-capabilities.json', 'task-corpus.jsonl', 'generated-records.json', 'generated-routes.json', 'generated-entities.json', 'generated-screens.json', 'jurisdiction-config.json']) {
    const loaded = readText(name);
    if (!loaded.error) scanned.push([name, loaded.text]);
  }
  const tokenHits = [];
  for (const [name, text] of scanned) {
    for (const token of SUSPICIOUS_TOKENS) {
      if (token.re.test(text)) tokenHits.push(`${name}:"${token.label}"`);
    }
  }

  check(
    'no real tax/payroll rule text',
    `${SUSPICIOUS_TOKENS.length} suspicious tokens, 0 hits`,
    tokenHits.length === 0,
    tokenHits.length === 0 ? `clean across ${scanned.length} files` : summarize(tokenHits.join(', '))
  );
} catch (error) {
  hardFailure = error;
  check('verification battery completed', 'no unexpected exception', false, `${error && error.message ? error.message : String(error)}`);
}

/* ------------------------------------------------------------------ output */

process.stdout.write('VERIFY-SIMULATION — simulation layer battery\n');
process.stdout.write(`simulation dir: ${SIMULATION_DIR}\n\n`);
process.stdout.write(formatTable());
process.stdout.write('\n\n');

const failures = rows.filter((row) => row.result === 'FAIL');
process.stdout.write(`checks=${rows.length} pass=${rows.filter((row) => row.result === 'PASS').length} fail=${failures.length} info=${rows.filter((row) => row.result === 'INFO').length}\n`);
if (hardFailure) process.stdout.write(`unexpected exception: ${hardFailure.stack ?? hardFailure.message}\n`);
for (const failure of failures) process.stdout.write(`FAIL: ${failure.label} — expected ${failure.expected}; observed ${failure.observed}\n`);
process.stdout.write(failures.length === 0 ? 'RESULT: PASS\n' : 'RESULT: FAIL\n');
process.exitCode = failures.length === 0 ? 0 : 1;
