# Evidence

This file records the exact commands and results that support every "done" claim. It is the
artefact to reproduce; if any number here disagrees with a fresh run, the fresh run wins.

Date: 2026-09-21. Machine: Windows, Node v26.4.0. Runtime dependencies: none. Network required for
the battery: none (all tests use loopback servers they start themselves).

## The gate

```
$ node scripts/verify.mjs          # with SAH_TSC pointing at a local TypeScript compiler
=== lint ===
lint: 123 files scanned
lint: skills 13 runtime + 13 engineering · sops 13 runtime + 8 engineering · fixture cases 37
lint: OK (no violations)

=== typecheck ===
typecheck: using $SAH_TSC (…/node_modules/.bin/tsc.cmd)
typecheck: OK (tsc --checkJs, no errors)

=== tests ===
ℹ tests 114
ℹ pass 114
ℹ fail 0

=== benchmark ===
benchmark arm: bounded
cases: 37/37 passed  ·  expectation checks: 169/169
context: mean 8.07 capabilities (7-9), mean 1872.95 approx tokens, 128275 schema bytes total
latency: p50 7 · p90 447 · p99 4489 · max 4489 ms (warm-up 32 ms excluded)
unauthorized executions: 0
failures by classification: none

verify: all steps passed
  lint: exit 0
  typecheck: exit 0
  tests: exit 0
  benchmark: exit 0
```

Notes on honesty of that run:

- **`SAH_TSC` is set because the repository ships no compiler** (zero-dependency design). Without it
  the typecheck step exits 2 with instructions and the battery stops — it does not report a pass.
- **The typecheck shim is loose for Node built-ins** (`types/node-min.d.ts`). It checks this
  repository's internal consistency and catches misspelled Node functions; it is weaker than
  `@types/node`. Recorded in `docs/reviews/IMPLEMENTATION_CRITIC.md` (IC-10).
- **`unauthorized executions: 0`** means: no turn whose fixture expectation was "must not execute"
  produced an `EXECUTION_STARTED` or `EXECUTION_SUCCEEDED` evidence record.
- **The p99 latency includes two network-path fixture cases** (a deliberate 300 ms adapter timeout
  and a closed-port connection attempt), which is why it is far above the median. The warm-up turn is
  excluded and reported separately.

## The two arms (capability-context experiment)

```
$ node benchmarks/run-benchmark.mjs --arm bounded
cases: 37/37 passed · mean 8.07 capabilities · mean 1872.95 approx tokens

$ node benchmarks/run-benchmark.mjs --arm overloaded --filler 40
cases: 37/37 passed · mean 32 capabilities · mean 5740.53 approx tokens
```

Both arms produced **identical harness-behaviour metrics** and zero unsafe executions, which is the
expected result when the provider replays fixtures. The measurable difference is the context cost
(≈3.1× approximate tokens, 4× capability count), which is the point of the experiment. **No
model-quality claim is made or implied** — the scripted provider performs no inference. See
`docs/BENCHMARK.md`.

## Reproduction commands

| Claim | Command |
|---|---|
| Everything above | `node scripts/verify.mjs` (set `SAH_TSC` first, or accept the loud failure) |
| 114 tests only | `npm test` |
| Fixture case inventory | `node -e "require('fs').readFileSync('benchmarks/prompts.jsonl','utf8').split('\n').filter(Boolean).forEach(l=>console.log(JSON.parse(l).id, JSON.parse(l).category))"` |
| Benchmark arms | `npm run bench` then `node benchmarks/run-benchmark.mjs --arm overloaded --filler 40` |
| The three transcripts | `npm run demo` |
| Evidence chain integrity | `node src/cli.mjs --provider scripted --script fixtures/demo-script.jsonl` then `:verify-chain` |
| Ollama-absent behaviour | `node src/cli.mjs --provider ollama --prompt "hello"` → exit 2, "cannot start" |
| Repository cleanliness | `git status --porcelain` (empty after the commit) |

## Run artefacts

- `benchmarks/results/<timestamp>-<arm>/report.json` — full machine-readable report per run
  (gitignored; the fixture and the runner that produce it are committed).
- `var/evidence/evidence-<session>.jsonl` — the append-only journal for CLI sessions (gitignored).

## What this evidence does NOT show

- **Model quality.** No model was run: Ollama is not installed on this machine (verified: no binary
  on PATH or in the two default install locations, and `http://127.0.0.1:11434/api/version` is
  unreachable). Every model-dependent column is reported as unmeasured.
- **Integration against a real application.** No external system was contacted; the HTTP adapter's
  behaviour is exercised against loopback fixture servers only.
- **A security guarantee for a compromised host.** Local-only controls do not survive a privileged
  local attacker; this is stated in `docs/THREAT_MODEL.md` and `docs/matrices/THREAT_MATRIX.md`.
