#!/usr/bin/env node
/**
 * Type gate.
 *
 * The repository has no dependencies, so it cannot ship `typescript` or `@types/node`. This
 * script therefore locates a compiler that is already on the machine and runs a real
 * `tsc --checkJs` pass over the source, tests, scripts and benchmark runner. If no compiler is
 * found it FAILS LOUDLY with an exit code of 2 — a missing gate is never reported as a pass.
 *
 * Resolution order:
 *   1. $SAH_TSC                (explicit path to a tsc binary or .cmd)
 *   2. ./node_modules/.bin/tsc (if a developer installed one locally)
 *   3. `tsc` on PATH
 *
 * @module scripts/typecheck
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();

/**
 * @returns {{ command: string, source: string }|null}
 */
function findCompiler() {
  const candidates = [];
  if (process.env.SAH_TSC) candidates.push({ command: process.env.SAH_TSC, source: '$SAH_TSC' });
  candidates.push({ command: join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc'), source: 'node_modules/.bin/tsc' });
  candidates.push({ command: 'tsc', source: 'PATH' });

  for (const candidate of candidates) {
    if (candidate.source !== 'PATH' && !existsSync(candidate.command)) continue;
    const probe = spawnSync(candidate.command, ['--version'], { encoding: 'utf8', shell: candidate.command.endsWith('.cmd') });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const compiler = findCompiler();
if (!compiler) {
  process.stderr.write(
    [
      'typecheck: FAILED — no TypeScript compiler found, so the gate could not run.',
      '',
      'This is reported as a failure on purpose: a skipped gate must never look like a pass.',
      'To run it, provide a compiler in one of these ways:',
      '  - set SAH_TSC to a tsc binary or tsc.cmd path, e.g.',
      '      $env:SAH_TSC = "C:\\path\\to\\node_modules\\.bin\\tsc.cmd"',
      '  - or run `npm i -D typescript @types/node` in this repository (dev-only; the runtime',
      '    dependency list stays empty),',
      '  - or install TypeScript globally so `tsc` is on PATH.',
      ''
    ].join('\n')
  );
  process.exit(2);
}

process.stdout.write(`typecheck: using ${compiler.source} (${compiler.command})\n`);
process.stdout.write(
  'typecheck: scope = src/, tests/, scripts/ and the fixture benchmark. Four experiment tools are excluded in tsconfig.json (three live runners + the simulation data checker): they are validated by execution and by their recorded reports, and their typing is thin by design.\n'
);
const result = spawnSync(compiler.command, ['-p', 'tsconfig.json', '--pretty', 'false'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: compiler.command.endsWith('.cmd')
});
if (result.status === 0) {
  process.stdout.write('typecheck: OK (tsc --checkJs, no errors)\n');
  process.exit(0);
}
process.stderr.write('typecheck: FAILED (see tsc output above)\n');
process.exit(result.status ?? 1);
