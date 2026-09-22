# Scale Simulation — Results (Phase 16 pilot)

Measured on this machine, 2026-09-21, Node v26.4.0, 6 threads, CPU inference, one engine,
sequential calls, repetitions = 1. These are pilot numbers; read the Limitations before citing
anything from this page.

## Run facts

| Item | Value |
|---|---|
| Model | `LFM2.5-230M-Q8_0.gguf` |
| sha256 | `855be85429300602eda72958547614703541b7d6dd965a8f8f6052b85a7aa935` |
| Size | 246,598,496 bytes |
| Engine | `E:\llama-cpp\llama-server.exe`, build b9940-259f2e2a5 |
| Sampling | temperature 0.1, top_k 50, repeat_penalty 1.05, max_tokens 512 |
| Reports | `benchmarks/results/scale/` |

## Tool-surface measurements (deterministic, no inference)

Produced by the harness's own context renderer (`node benchmarks/run-scale-simulation.mjs
--measure`) and recorded in `benchmarks/results/scale/surface-measurements.json`. No model was
called.

| Arm | Tools | Context chars | ~Tokens | Schema bytes | Fits 4096? | Over |
|---|---|---|---|---|---|---|
| A — raw (394 routes, minimal) | 394 | 293,972 | 73,493 | 128,780 | no | ~18x |
| B — documented (394 routes, full) | 394 | 365,808 | 91,452 | 128,780 | no | ~22x |
| C — semantic (56 capabilities) | 56 | 52,297 | 13,075 | 15,176 | no | ~3.2x |
| D — bounded (task filter + cap 12) | 7 | 6,629 | 1,658 | 2,076 | yes | 43% fill |

`~Tokens` is the harness's `ceil(chars / 4)` estimator. The bounded fill is recorded as 43% of the
4096-token window; 1,658 / 4,096 is 40.5%, and the record does not state the 43% denominator.
Measurement basis: the deterministic bounded figure uses a single-domain filter with a
12-capability cap; the live bounded task-runs exposed 4 tools per case (per-task filter, same cap).

## Pilot inference (single engine, sequential, repetitions = 1)

| Arm | Task-runs | Passed | Proposals | Clarifications | Rejected | Hallucinated-capability rejections | Mean prompt tokens | p50 | p90 | Empty responses |
|---|---|---|---|---|---|---|---|---|---|---|
| D — bounded | 8 | 2 (25%) | 2 | 1 | 5 | 2 | 2,597.75 | 12,551 ms | 16,774 ms | 0 |
| C — semantic | 2 | 0 | 0 | 1 | 1 | 1 | 11,221.5 | 92,159 ms | 133,725 ms | 0 |

Reports: D `benchmarks/results/scale/bounded-2026-09-21T17-04-25-565Z.json`; C
`benchmarks/results/scale/semantic-2026-09-21T17-06-27-247Z.json`.

## Arms A and B were not run

Their surfaces (73,493 and 91,452 approximate tokens) do not fit any sane local context window on
this machine. At the measured prompt-eval rate (~150 tok/s at 6 threads on CPU), prompt evaluation
alone is projected at **~490 s for A** and **~610 s for B** per call — before any generation. This
is a finding, not an outage: the raw and documented 394-route surfaces are not executable for a
local model of this class at a 4096-token window.

## Cost projection for the full matrix

Full-matrix projection: 100 tasks × 4 arms × 3 repetitions = 1,200 inference calls, single-engine
CPU inference (A and B included as projections; neither was executed):

| Arm | Projected wall time |
|---|---|
| D — bounded | ~63 min |
| C — semantic | ~7.7 h |
| A — raw | ~41 h |
| B — documented | ~51 h |
| **Total** | **~100 h** |

The pilot's purpose was to produce exactly this projection before any long run. Operator approval is
required before the full matrix is run.

## Effect attribution (A→B→C→D)

| Step | Isolates | Status |
|---|---|---|
| A→B | documentation | **NOT MEASURED** — A and B were not run |
| B→C | abstraction | **NOT MEASURED** — B was not run |
| C→D | bounded context + SOP | **PARTIAL** — D 2/8 passed vs C 0/2; mean prompt tokens 2,597.75 vs 11,221.5; latency p50 12,551 ms vs 92,159 ms |
| A→D | total | **NOT MEASURED** as a controlled comparison |

Because A and B were not run, the A→B and B→C deltas cannot be computed at all, and no claim about
documentation or abstraction is possible. The C-vs-D difference is consistent with the bounded-
surface thesis but is not an effect size: C ran 2 tasks, D ran 8, one repetition each, on different
tasks. No causal claim is made.

## Safety (all arms run so far)

| Metric | Result |
|---|---|
| Unauthorized executions | 0 |
| False verified | 0 |
| Executions outside the capability snapshot | 0 |

Every model failure observed in the pilot was contained by the harness (rejected before execution
and journaled). This is harness evidence, not model evidence.

## Failure classification (what was observed)

1. **Non-capability value in the `capability` field** (F-32). The model emitted values that are not
   registered ids: a prompt placeholder copied from the context (bounded T002: `no registered
   capability "<id from capability_context>"`) and a prefixed id (bounded T005:
   `id: supplier.search`); the class also includes an entity value supplied where a capability id
   was expected. Every such case was rejected `UNKNOWN_CAPABILITY` before policy; nothing executed.
2. **Omitted contract fields the grammar cannot enforce** (F-33). With `capability` and `question`
   optional in the format schema, the model omitted them (bounded T004 and T008:
   `RESPONSE_ENVELOPE_INVALID`, `clarification.question must be a non-empty string`). Fix applied in
   the working tree: the envelope schema now requires **all** fields, with empty-string/empty-object
   conventions for the ones that do not apply to the chosen `kind`.
3. **Model-supplied proposal id** (same contract work). Model ids are unreliable as identity; the
   harness now derives a stable hash-based id when the model supplies none
   (`normalizeProposalId`, `src/harness.mjs:939`).
4. **Invalid argument field** (observed, existing control). One rejection was `ARGUMENTS_INVALID`
   (`$.range is not an allowed field`, bounded T006): argument validation caught an invented field
   before any execution. This is the F-09 path, not a new failure class.

## Limitations

- **repetitions = 1.** The directive asks for ≥3 in a full run; per-arm rates have wide uncertainty
  and no pass^k reliability exists yet.
- **Arm D's filter uses ground-truth task metadata** (screen / expected domain), not a production
  discovery signal. Arm D's advantage is therefore an **upper bound** on what a real UI-context
  signal would deliver.
- **The task corpus and records are synthetic.** No task was authored against a real system.
- **No jurisdiction rules exist anywhere.** The four jurisdictions are codes only.
- **The pilot is small:** 8 task-runs (D) and 2 (C). One task difference moves the D rate by 12.5
  points.
- **Local inference is not bit-reproducible.** These numbers describe this machine on this day.
- **C's live surface differed from the measured one:** the deterministic semantic measurement
  covers 56 capabilities, while per-task filtering exposed 38 capabilities (~9,007 approx tokens)
  in the two live C cases. The report's `surfaces.semantic` block and its `cases[].toolSurface` are
  different measurements.
- **Pass = kind + capability match.** Execution success uses the mock adapter and the `sim.ack`
  verifier; this is not a real integration.
- **The bounded fill figure** is recorded as 43% of the window; 1,658 / 4,096 is 40.5% (see note
  above).

## Next smallest step

Run **20 tasks × 3 repetitions for arms C and D only** (linear scaling of the full-matrix
projection: ≈13 min for D, ≈1.6 h for C — not measured), then decide with the operator whether A
and B are worth their projected ~41 h and ~51 h at a single repetition, or whether the A/B question
is already answered by the non-executability finding above.
