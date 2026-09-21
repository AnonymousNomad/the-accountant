---
name: local-agent-benchmarking
description: Runs the deterministic agent benchmark over benchmarks/prompts.jsonl and produces reproducible per-case reports; use when measuring proposal quality, comparing one changed variable against a baseline, or classifying a failing case with the fixed taxonomy.
---

## Purpose
Answer "what can this harness plus this provider actually do?" with measured, reproducible numbers. Every score is computed by deterministic predicates over parsed output and resulting synthetic state; no model judges another model; no number is estimated or invented.

## When to use
- Running or extending `benchmarks/run-benchmark.mjs` over `benchmarks/prompts.jsonl`.
- Comparing a changed prompt, SOP, schema, exposure setting, or model against a baseline.
- Classifying failed cases and filing data or harness defects.
- Producing a report for `docs/BENCHMARK.md` or a handoff evidence pack.

## When NOT to use
- Judging free-form prose quality. There is no such metric and no LLM-as-judge lane (R-40, R-44).
- Measuring production latency or load. This is a fixture battery, not a load test.
- Training or fine-tuning. v0.1 forbids fine-tuning; benchmark failures become recorded findings, not training runs (SAH-REQ-056).
- Comparing arms across different template, schema, or fixture versions without labelling the comparison non-comparable (R-42, R-44).

## Prerequisites
- `benchmarks/prompts.jsonl` with at least 20 cases covering the required prompt classes, each carrying case id, instruction, expected capability, expected arguments or abstention, and expected outcome (SAH-REQ-033).
- `config/harness.config.json` valid and hashable; a fresh synthetic store per run (FAILURE_MATRIX recovery doctrine).
- A provider choice: the scripted provider for deterministic harness measurement, or a locally installed runtime for model measurements (absent on this machine as of 2026-09-21).
- A report location under the evidence directory; report schema fixed before the first comparison.

## Inputs
- The fixture file and its hash; the prompt/template hash, SOP hash, and capability-schema hash.
- Provider identity, decode parameters (seed, temperature, `num_ctx`, `keep_alive`), and server version when reachable (R-14, R-50).
- Harness version, config hash, exact command, and environment record (R-46).
- For repeated-trial arms: trial count `k` and the reliability statistic to report (R-43).

## Procedure
1. Freeze the report schema before running: case id, expected, actual, terminal status, per-metric booleans, failure class, latency samples, and the run header fields (SAH-REQ-055).
2. Hash and record the run header: fixture, prompt template, SOP, capability schemas, config, harness version, and exact command (R-42, R-46).
3. Choose exactly one changed variable for the arm; hold hardware, quantization, context, sampler settings, and fixture fixed. Document the changed factor in the report (R-45).
4. Run the full fixture. A partial run may not match full-set numbers and is not reportable as a score (R-44).
5. Execute each case end to end through `src/harness.mjs`, then score with deterministic predicates only: parse success, correct capability, argument validity, clarification correctness, hallucination detection, unauthorized-execution attempt, verification outcome, end-to-end completion (SAH-REQ-034, R-40).
6. Record expected versus actual and the terminal status per case; treat any abort, incomplete run, or force-terminated case as a failure with a recorded reason (R-41).
7. Classify every failure with the fixed taxonomy: `MODEL_REASONING`, `MODEL_SCHEMA`, `PROMPT/SOP`, `CONTEXT`, `CAPABILITY_MISSING`, `CAPABILITY_DESCRIPTION`, `ARGUMENT_SCHEMA`, `ROUTING/DISCOVERY`, `AUTHORITY`, `ADAPTER`, `APPLICATION`, `VERIFICATION`, `TEST_DEFECT`, `UNKNOWN`. No model-based attribution is permitted (R-44, SAH-REQ-056).
8. Measure latency per step type from the intended start: report p50, p90, p99, and max, with fixed millisecond buckets; separate model-load and connection time from inference; mark warm-up turns separately and exclude them from headline percentiles (R-48, R-49).
9. Label every record produced by the scripted provider as scripted, and leave model-quality columns explicitly unmeasured when no runtime was used (DM-12, SAH-REQ-035, L-4).
10. For real-model arms, run `k` trials per case and report per-case results plus the reliability statistic; never report a single run as capability (R-43).
11. Include a contamination declaration in every report: fixtures are never training data, and no fixture text enters any corpus (R-47).
12. Compare only arms whose template, schema, and fixture versions match; if any differ, label the comparison non-comparable and re-run rather than interpreting the delta (R-42, R-44).
13. Store the report with raw per-case records; keep the fixture hash stable and bump the fixture version on any change, then re-baseline (R-44).
14. File failures: harness defects as defects, fixture defects as `TEST_DEFECT` with a fixed fixture version, model failures as data for the deferred model-improvement discussion (never as an in-place training run).

## Decision points
| Condition | Action |
|---|---|
| No local runtime available | Run the scripted arm; report harness metrics only; model-quality `UNMEASURED` (L-4) |
| Real runtime available | Run `k` trials per case; report reliability, not a single pass (R-43) |
| More than one factor differs between arms | Split into separate arms; refuse the comparison (R-45) |
| Fixture expectation is wrong | Classify `TEST_DEFECT`, fix the fixture, bump the fixture version, re-run all arms (R-44) |
| A case hangs or is aborted | Score it a failure with the recorded reason (R-41) |
| Model-quality columns are requested without a runtime | Refuse to produce them; state they are unmeasured (SAH-REQ-035) |

## Failure conditions
- A report without fixture/template/schema hashes is not reproducible and must not be circulated (R-42, R-46).
- Partial-run numbers presented as a score violate full-fixture scoring (R-44).
- Any metric computed by an LLM judge violates the deterministic-metric rule (R-40).
- Warm-up latency folded into percentiles understates the tails (R-48).

## Stop conditions
- Someone proposes an LLM judge or model-based failure attribution — stop (R-40, R-44).
- A "quick subset" run is about to be reported as a result — stop (R-44).
- Two variables were changed between arms — stop and split the arms (R-45).
- A fine-tuning run is proposed to improve a benchmark score in v0.1 — stop; out of scope (SAH-REQ-056).
- Fixture text is about to be added to any training corpus — stop; contamination (R-47).

## Security considerations
- The benchmark executes real harness paths; it must not bypass policy, permits, or verification to score a case (DM-14).
- Benchmarks start from a fresh store because manual state edits break determinism assumptions (failure-matrix recovery doctrine).
- Reports and raw records live under the evidence directory; no secrets, credentials, or collaborator data may appear (T-13).
- Model-quality claims stay unmeasured rather than fabricated; wording in reports follows the closed status set (H-9).

## Verification
- `tests/benchmark.test.mjs` asserts: fixture coverage of the required classes, hashes present, metrics are booleans/integers, fixture hash recorded, trial count present, contamination declaration present, percentiles computed (SAH-REQ-033, SAH-REQ-055, SAH-REQ-056).
- `npm run bench` output recorded verbatim in `docs/EVIDENCE.md` with the environment record (R-46).
- Review `docs/BENCHMARK.md` for the arm definition, taxonomy, and the list of what may not be claimed (R-43, R-44, SAH-REQ-035).
- Spot-check one case manually: re-run its instruction, compare the recorded terminal status and store state with the report row.

## Expected outputs
- A report with run header (hashes, decode params, harness version, command, environment), per-case expected/actual rows, terminal statuses, failure classifications, latency percentiles with warm-up separated, reliability statistic when `k > 1`, and a contamination declaration.

## Dependencies
- `benchmarks/prompts.jsonl`, `benchmarks/run-benchmark.mjs`.
- `src/harness.mjs`, `src/models/scripted-provider.mjs`, `src/models/ollama-provider.mjs` (real-model arms only).
- `src/evidence/journal.mjs` (per-case evidence), `config/harness.config.json`.
- `docs/BENCHMARK.md` for the published method and claim limits.

## References
- R-40 BFCL deterministic execution scoring (PRIMARY); R-41 BFCL v3 state and trace (PRIMARY); R-42 BFCL v4 prompt sensitivity (PRIMARY); R-43 tau-bench pass^k reliability (PRIMARY); R-44 BFCL/tau2 version pinning and non-comparable subsets (PRIMARY); R-45 NIST/SEMATECH controlled comparison (STANDARD); R-46 NeurIPS reproducibility checklist (STANDARD); R-47 Zhou et al. contamination (PRIMARY); R-48 Gil Tene latency discipline (PRIMARY); R-49 OpenTelemetry HTTP metric conventions (STANDARD); R-50 OpenAI Cookbook seeds do not guarantee reproducibility (PRIMARY).
- Decision DM-12 (scripted provider labelling), DM-15; critic item L-4; requirement SAH-REQ-055, SAH-REQ-056.

## Examples
- Scripted harness arm: replay all fixture cases through `src/models/scripted-provider.mjs` with `npm run bench`; report parse success, capability match, argument validity, and policy outcomes as harness metrics, with provider labelled `scripted`.
- Model arm (when a runtime exists): same fixture, `k` trials, decode params recorded, latency percentiles per step type, reliability statistic per case.
- Failure classification example: a case where `customer.create` is proposed with a missing email is `ARGUMENT_SCHEMA`; a case where `invoice.issue` never receives confirmation is `AUTHORITY`; a case where the fixture's expected capability was wrong is `TEST_DEFECT`.

## Anti-patterns
- Asking a model to grade another model's output.
- Reporting a single trial as capability instead of reliability.
- Quoting a best-run number without the arm definition and hashes.
- Changing the fixture mid-comparison without bumping its version.
- Blending warm-up and steady-state latencies into one percentile.
- Calling scripted-fixture results "model performance".
