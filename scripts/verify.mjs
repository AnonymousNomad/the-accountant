#!/usr/bin/env node
/**
 * The verification battery: lint -> typecheck -> tests -> benchmark.
 *
 * Each step runs as a child process with inherited stdio so the real output is visible, and the
 * battery stops at the first failure. Nothing here can report success on behalf of a step that
 * did not run: a step that cannot run exits non-zero, and so does this script.
 *
 * Usage: node scripts/verify.mjs [--skip-bench] [--skip-typecheck]
 *
 * @module scripts/verify
 */

import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const skipBench = argv.includes('--skip-bench');
const skipTypecheck = argv.includes('--skip-typecheck');

const steps = [
  { name: 'lint', command: process.execPath, args: ['scripts/lint.mjs'] },
  ...(skipTypecheck ? [] : [{ name: 'typecheck', command: process.execPath, args: ['scripts/typecheck.mjs'] }]),
  { name: 'tests', command: process.execPath, args: ['--test'] },
  ...(skipBench ? [] : [{ name: 'benchmark', command: process.execPath, args: ['benchmarks/run-benchmark.mjs', '--arm', 'bounded'] }])
];

const results = [];
for (const step of steps) {
  process.stdout.write(`\n=== ${step.name} ===\n`);
  const result = spawnSync(step.command, step.args, { cwd: process.cwd(), stdio: 'inherit' });
  const status = result.status ?? 1;
  results.push({ name: step.name, status });
  if (status !== 0) {
    process.stderr.write(`\nverify: FAILED at step "${step.name}" (exit ${status})\n`);
    process.exit(status);
  }
}

process.stdout.write('\nverify: all steps passed\n');
for (const result of results) process.stdout.write(`  ${result.name}: exit ${result.status}\n`);
process.exit(0);
