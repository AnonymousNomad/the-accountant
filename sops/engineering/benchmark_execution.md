# Benchmark Execution — Scripted Arms, Real-Model Arms, Recording, and Failure Classification

## Objective
Run the full benchmark fixture deterministically, record every field needed to make a bounded claim, and
classify failures with the fixed taxonomy instead of judgement (R-40, R-43, R-44, SAH-REQ-055).

## Prerequisites
- `benchmarks/prompts.jsonl` (>= 20 prompts, 12 classes) and `benchmarks/run-benchmark.mjs` are the only
  fixture and runner; do not create ad-hoc prompt sets.
- `npm run verify` has been run for this commit before any benchmark claim is made.
- The provider arm is chosen in advance: `scripted` (`fixtures/demo-script.jsonl`) or `ollama`.
- For a real-model arm: Ollama answers on loopback (`/api/version`), the intended model is present, and
  `config/harness.config.json` names that model with `temperature: 0`, a fixed `seed`, and the frozen `numCtx`.

## Procedure
1. Freeze the inputs: commit or note the harness version, `config/harness.config.json`, the SOP
   `prompts/accounting-resident.sop.md`, the capability set, and `benchmarks/prompts.jsonl` before running.
2. Confirm the report emits the input hashes (fixture, prompt template, SOP, capability schema); if any is
   missing, fix the reporter first — a result without hashes is not comparable (R-42).
3. Start from a fresh synthetic store and a fresh journal directory; never benchmark against hand-edited state.
4. Run the scripted arm with `npm run bench`; run the CLI transcript arm separately with
   `node src/cli.mjs --provider scripted --script fixtures/demo-script.jsonl`.
5. Verify the scripted run is repeatable: run it twice and require identical per-case outcomes; a difference
   indicates nondeterminism in the harness, not in a model.
6. For a real-model arm, change only the provider selection in `config/harness.config.json` (kind/model) and
   re-run `npm run bench` on the same fixture; do not change the SOP, schema, or prompt template.
7. Mark warm-up turns separately and measure latency from the intended start, reporting p50/p90/p99/max per
   step type (provider, execute, verify) and separating model-load time (R-48).
8. Record the run fields: run id and timestamp; exact command; harness version/commit; config hash; provider
   kind, model, quant, server version, `numCtx`, seed, temperature; capability set and schema hash; SOP hash;
   prompt template hash; fixture hash; contamination declaration; environment.
9. Record per case: prompt id and class, expected outcome, actual terminal status, selected capability,
   argument validity, verifier result, latency in ms, and failure class.
10. Compare arms only when exactly one variable differs (model OR harness OR prompt); hold hardware, quant,
    context, sampler, fixture hash, and templates fixed; state the changed factor and everything held fixed.
11. Classify every non-pass with the fixed taxonomy below; never with model judgement or prose rationale.
12. Publish the report in `docs/BENCHMARK.md` and the raw output as evidence, listing explicitly which
    dimensions remain unmeasured for this arm.

Fixed failure taxonomy (deterministic; keyed to terminal status and stage):
| Class | Terminal status / evidence | Meaning |
|---|---|---|
| `CLASS-PROVIDER` | `PROVIDER_ERROR` (F-01..F-04) | Runtime unreachable, timed out, model missing, malformed payload |
| `CLASS-PARSE` | `REJECTED` + `PROPOSAL_REJECTED` (F-05/F-06) | Not exactly one valid envelope object |
| `CLASS-CAPABILITY` | `REJECTED` (`UNKNOWN_CAPABILITY`, `CAPABILITY_NOT_EXPOSED`) | Wrong or unexposed capability selected (F-07/F-08) |
| `CLASS-ARGUMENTS` | `REJECTED` with per-field issues (F-09) | Type, enum, bounds, unknown field, or placeholder |
| `CLASS-CLARIFY` | `CLARIFICATION_REQUIRED` mismatch | Asked when it should propose, or proposed when information was missing |
| `CLASS-UNSUPPORTED` | `UNSUPPORTED` mismatch | Proposed for an impossible request, or refused a supported one |
| `CLASS-AUTHORITY` | `DENIED` where `ALLOW` was expected, or the reverse | Policy/permit defect; must be zero for the scripted arm |
| `CLASS-CONFIRMATION` | `CONFIRMATION_REJECTED` mismatch (F-14/F-15) | Confirmation stale, ambiguous, replayed, or absent; execution without confirmation is a blocker |
| `CLASS-EXECUTION` | `EXECUTION_FAILED` (F-21) | Adapter error, timeout, or ambiguous success |
| `CLASS-VERIFICATION` | `VERIFICATION_FAILED` (F-22/F-24) | Effect missing or mismatched, or verifier defect |
| `CLASS-LATENCY` | measured duration | Over the recorded per-step budget |
| `CLASS-HARNESS-DEFECT` | any other status, chain mismatch, crash | Escalate; never re-classify as a model failure |

Never claim:
- that a scripted-provider run measures model quality; the scripted provider is a labelled fixture replay (DM-12);
- a partial-fixture score, or a comparison across template/schema/SOP versions (R-42, R-44);
- determinism or reproducibility from a seed alone (R-28, R-50);
- any success for a case whose terminal status is not `EXECUTED_VERIFIED`;
- that tests pass beyond the recorded command output attached to the report.

## Gates
- G1: fixture hash and all input hashes appear in the report before any result is quoted.
- G2: the scripted arm is bit-identical across two runs; otherwise stop and fix the harness.
- G3: an arm comparison changes exactly one factor; two changes void the comparison.
- G4: every non-pass row carries a taxonomy class; unclassified rows block publication.
- G5: the report states the unmeasured dimensions and the contamination declaration.

## Expected evidence
- Raw benchmark output, the report in `docs/BENCHMARK.md`, the scripted repeat-run comparison, the real-model
  arm record with model and server version, and the exact commands executed.

## Failure conditions
- Missing hashes, missing per-case rows, or a fixture subset: refuse to publish; rerun the full fixture.
- Non-identical scripted runs, or any `CLASS-AUTHORITY` hit in the scripted arm: treat as a harness defect and stop.
- Ollama absent or the model missing: record the arm as not run — `PROVIDER_ERROR` is not a score; never
  substitute an estimate or an earlier run.
- Taxonomy divergence from `docs/BENCHMARK.md`: that document governs; correct this SOP and the runner in
  the same change and re-run the affected arm.

## Rollback / recovery
- Discard the run directory and store, restore the frozen config, and re-run from step 1; never patch results.
- If a published report is found wrong, mark it superseded with the reason, keep the raw output, and publish
  the corrected run with a new run id.
- Never re-run only the failing prompts; the full fixture is the unit of comparison.

## Completion criteria
- A report exists that a reviewer can reproduce from the recorded command and hashes alone.
- Every case is classified, every claim is bounded to what was measured, and unmeasured dimensions are named.
