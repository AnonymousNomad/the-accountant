#!/usr/bin/env node
/**
 * Terminal demonstration of the harness.
 *
 * The CLI is an operator surface only: it holds no authority, and it can do nothing the
 * harness does not permit. `--confirm` is an explicit operator shortcut equivalent to typing
 * "yes" (it is the operator's own action, taken with a flag) and is never enabled by default.
 *
 * Exit codes (documented so scripts can rely on them):
 *   0  the harness produced a determinate outcome (verified, clarification, unsupported, or
 *      waiting for confirmation in interactive mode)
 *   1  the action did not succeed and further input will not help (denied, rejected,
 *      execution failed, verification failed, declined, evidence failure)
 *   2  the harness could not run (configuration invalid, provider unavailable)
 *   3  usage error
 *
 * @module cli
 */

import { createInterface } from 'node:readline/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHarnessFromConfig } from './bootstrap.mjs';
import { STATUS, NORMAL_STATUSES } from './harness.mjs';

export const EXIT_CODES = Object.freeze({
  DETERMINATE: 0,
  FAILED: 1,
  COULD_NOT_RUN: 2,
  USAGE: 3
});

export const HELP = `sovereign-action-harness — v0.1

Usage:
  node src/cli.mjs [options]

Options:
  --config <path>        Harness configuration (default: config/harness.config.json)
  --provider <kind>      ollama | scripted   (overrides the configured provider)
  --script <path>        JSONL of { prompt, response } fixtures for the scripted provider
  --prompt <text>        Answer one instruction and exit (non-interactive)
  --confirm              With --prompt: answer yes to a pending confirmation (operator action)
  --json                 Print the raw result object instead of the transcript
  --help                 This text

Interactive commands:
  :help                  This text
  :capabilities          The capability context that would be offered for the next request
  :evidence [n]          The last n evidence records (default 10)
  :verify-chain          Replay the evidence hash chain
  :quit                  Leave

Nothing executes without policy approval, and financial operations require explicit
confirmation bound to the exact proposal you were shown.`;

/** @type {Awaited<ReturnType<typeof createHarnessFromConfig>>|null} */
let bundle = null;
/** @type {Record<string, any>} */
let args = {};

/**
 * Run the CLI. Called at import time only when this file is the process entry point.
 * @param {string[]} [argv]
 * @returns {Promise<number>} exit code
 */
export async function main(argv = process.argv.slice(2)) {
  args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${HELP}\n`);
    return EXIT_CODES.DETERMINATE;
  }

  const script = args.script ? loadScript(String(args.script)) : [];
  try {
    bundle = await createHarnessFromConfig({
      configPath: args.config ? String(args.config) : resolve(process.cwd(), 'config/harness.config.json'),
      ...(args.provider ? { providerKind: String(args.provider) } : {}),
      script
    });
  } catch (err) {
    process.stderr.write(`cannot start: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_CODES.COULD_NOT_RUN;
  }

  if (args.prompt !== undefined) {
    return await runOneShot(String(args.prompt), { json: Boolean(args.json), autoConfirm: Boolean(args.confirm) });
  }
  return await repl();
}

/**
 * @param {string} text
 * @param {{ json: boolean, autoConfirm: boolean }} options
 * @returns {Promise<number>}
 */
async function runOneShot(text, options) {
  const harness = requireBundle().harness;
  let result = await harness.handleUserMessage(text);
  if (result.status === STATUS.CONFIRMATION_REQUIRED && options.autoConfirm) {
    if (!options.json) process.stdout.write('Confirmation required. --confirm was given by the operator: approving once.\n');
    result = await harness.confirm('yes');
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    render(result);
  }
  return exitCodeFor(result.status, options.autoConfirm);
}

/**
 * @returns {Promise<number>}
 */
async function repl() {
  const { harness, registry, config, journal, sessionId } = requireBundle();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write(`sovereign-action-harness 0.1  (session ${sessionId})\n`);
  process.stdout.write(
    `provider: ${harness.providerKind}/${harness.providerModel}  ·  capabilities: ${registry.size()} registered, up to ${config.exposure.maxCapabilities} per request  ·  :help\n\n`
  );
  try {
    for (;;) {
      const line = (await rl.question('> ')).trim();
      if (line.length === 0) continue;
      if (line === ':quit' || line === ':q' || line === 'exit') break;
      if (line === ':help') {
        process.stdout.write(`${HELP}\n\n`);
        continue;
      }
      if (line === ':capabilities') {
        process.stdout.write(`${describeContext(harness.previewContext())}\n\n`);
        continue;
      }
      if (line === ':verify-chain') {
        const report = await harness.verifyEvidence();
        process.stdout.write(
          report.valid
            ? `evidence chain valid (${report.entries} records)\n\n`
            : `EVIDENCE CHAIN BROKEN at record ${report.firstBadSeq}: ${report.reason}\n\n`
        );
        continue;
      }
      if (line.startsWith(':evidence')) {
        const parsed = Number.parseInt(line.split(/\s+/)[1] ?? '10', 10);
        const events = await journal.read(Number.isFinite(parsed) ? parsed : 10);
        for (const event of events) {
          process.stdout.write(`#${event.seq} ${event.at} ${event.type}${event.capability ? ` ${event.capability}` : ''}\n`);
        }
        process.stdout.write('\n');
        continue;
      }
      if (line.startsWith(':')) {
        process.stdout.write(`unknown command ${line}; try :help\n\n`);
        continue;
      }

      const result = await harness.handleUserMessage(line);
      render(result);
      if (result.status === STATUS.CONFIRMATION_REQUIRED) {
        const answer = (await rl.question('confirm> ')).trim();
        render(await harness.confirm(answer.length > 0 ? answer : 'no'));
      }
    }
  } finally {
    rl.close();
  }
  await journal.append('SESSION_CLOSED', { data: { phase: 'session-end', turn: harness.turn } });
  process.stdout.write('closed.\n');
  return EXIT_CODES.DETERMINATE;
}

/**
 * Render one result as the operator transcript. This is the ONLY place success wording is
 * produced, and it is derived strictly from the status.
 * @param {any} result
 */
export function render(result) {
  const lines = [];
  switch (result.status) {
    case STATUS.EXECUTED_VERIFIED:
      lines.push(`Proposed: ${result.capability}`);
      lines.push(`Risk: ${result.risk}`);
      lines.push('Authority: one-use permit issued and consumed');
      lines.push('Executed');
      lines.push('Verified');
      break;
    case STATUS.CONFIRMATION_REQUIRED:
      lines.push(`Proposed: ${result.capability}`);
      lines.push(`Risk: ${result.risk}`);
      lines.push('Confirmation required.');
      lines.push(`(this approval is bound to the exact arguments above and expires in ${ttlSeconds()}s)`);
      break;
    case STATUS.CONFIRMATION_REJECTED:
      lines.push(`Not executed: ${result.message}`);
      break;
    case STATUS.CLARIFICATION_REQUIRED:
      lines.push(`I need to ask before proposing anything: ${result.message}`);
      break;
    case STATUS.UNSUPPORTED:
      lines.push('No registered capability can perform that operation.');
      lines.push(`(${result.message})`);
      lines.push('No execution occurred.');
      break;
    case STATUS.REJECTED:
      lines.push(`Rejected: ${result.message}`);
      lines.push('No execution occurred.');
      break;
    case STATUS.DENIED:
      lines.push(`Denied: ${result.message}`);
      lines.push('No execution occurred.');
      break;
    case STATUS.EXECUTION_FAILED:
      lines.push(`Execution failed: ${result.message}`);
      lines.push('Nothing was verified. No success is claimed.');
      break;
    case STATUS.VERIFICATION_FAILED:
      lines.push(`Executed but NOT verified: ${result.message}`);
      lines.push('The effect is unconfirmed. No success is claimed.');
      break;
    case STATUS.COMMIT_UNKNOWN:
      lines.push(`Commit unknown: ${result.message}`);
      lines.push('The request may or may not have reached the application.');
      lines.push('It was NOT retried. Reconcile: re-read the affected state, then decide with the operator.');
      break;
    case STATUS.PROVIDER_ERROR:
      lines.push(`Model runtime unavailable: ${result.message}`);
      lines.push('No proposal was produced and no execution occurred.');
      break;
    case STATUS.EVIDENCE_ERROR:
      lines.push(`Evidence failure: ${result.message}`);
      break;
    default:
      lines.push(`${String(result.status)}: ${String(result.message)}`);
  }
  if (result.status === STATUS.EXECUTED_VERIFIED && result.execution?.data) {
    lines.push(`Result: ${JSON.stringify(result.execution.data)}`);
  }
  lines.push(`Evidence: ${result.runId} #${result.evidence?.seqs?.[0] ?? '-'}..#${result.evidence?.lastSeq ?? '-'}`);
  lines.push(`Latency: ${result.timingsMs?.total ?? 0} ms total (provider ${result.timingsMs?.provider ?? 0} ms)`);
  process.stdout.write(`${lines.join('\n')}\n\n`);
}

/**
 * @param {any} context
 * @returns {string}
 */
export function describeContext(context) {
  return [
    `exposed (${context.budget.capabilityCount} of ${context.registrySize}): ${context.ids.join(', ')}`,
    `filtered: ${context.filtered.map((/** @type {any} */ f) => `${f.id}:${f.reason}`).join(', ') || 'none'}`,
    `budget: ${context.budget.textChars} chars ≈ ${context.budget.approxTokens} tokens · schema bytes ${context.budget.schemaBytes}`,
    `registry hash: ${String(context.registryHash).slice(0, 12)} · context hash: ${String(context.contextHash).slice(0, 12)}`
  ].join('\n');
}

/**
 * @param {string} status
 * @param {boolean} autoConfirmed
 * @returns {number}
 */
export function exitCodeFor(status, autoConfirmed) {
  void autoConfirmed;
  if (status === STATUS.PROVIDER_ERROR) return EXIT_CODES.COULD_NOT_RUN;
  return /** @type {string[]} */ (NORMAL_STATUSES).includes(status) ? EXIT_CODES.DETERMINATE : EXIT_CODES.FAILED;
}

/**
 * @param {string[]} argv
 * @returns {Record<string, any>}
 */
function parseArgs(argv) {
  /** @type {Record<string, any>} */
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '--confirm') {
      parsed.confirm = true;
      continue;
    }
    if (['--config', '--provider', '--script', '--prompt'].includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined) {
        process.stderr.write(`${arg} needs a value\n`);
        process.exit(EXIT_CODES.USAGE);
      }
      parsed[arg.slice(2)] = value;
      i += 1;
      continue;
    }
    process.stderr.write(`unknown argument ${arg}\n`);
    process.exit(EXIT_CODES.USAGE);
  }
  return parsed;
}

/**
 * @param {string} path
 * @returns {Array<{ prompt: string, response: string }>}
 */
function loadScript(path) {
  const absolute = resolve(process.cwd(), path);
  if (!existsSync(absolute)) {
    process.stderr.write(`script file not found: ${absolute}\n`);
    process.exit(EXIT_CODES.USAGE);
  }
  /** @type {Array<{ prompt: string, response: string }>} */
  const entries = [];
  for (const line of readFileSync(absolute, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      process.stderr.write(`script ${path}: bad JSON line: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(EXIT_CODES.USAGE);
    }
    if (typeof parsed.prompt !== 'string' || typeof parsed.response !== 'string') {
      process.stderr.write(`script ${path}: each line needs { prompt, response }\n`);
      process.exit(EXIT_CODES.USAGE);
    }
    entries.push({ prompt: parsed.prompt, response: parsed.response });
  }
  return entries;
}

function ttlSeconds() {
  return bundle?.config?.confirmation?.ttlSeconds ?? 120;
}

function requireBundle() {
  if (!bundle) throw new Error('CLI not initialised');
  return bundle;
}

function isMain() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  process.exit(await main());
}
