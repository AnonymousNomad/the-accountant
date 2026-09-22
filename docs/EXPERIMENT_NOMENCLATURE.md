# Experiment Nomenclature, Route Classification, and Metric Definitions

Added 2026-09-21 (Phase 16B, Milestone 1.1 / 1.4 / 1.5). This file exists because the earlier
reports used ambiguous condition names and published ratios without defining their denominators.
Everything here is normative for future reports; historical run artefacts keep their original
names and are mapped below.

## 1. Condition names (normative)

| Condition | What it is | Model-facing surface | Guidance |
|---|---|---|---|
| `P15-LIVE-BOUNDED` | Phase 15B live run, 8-case subset × 3 reps, production-intended configuration | 8 synthetic-accounting capabilities | base contract + SOP + response contract |
| `S16-RAW-394` | 394 synthetic routes, minimal descriptions | 394 | response contract only (what the surface compels) |
| `S16-DOCUMENTED-394` | 394 synthetic routes with descriptions, schemas, when-to-use | 394 | as above |
| `S16-SEMANTIC-56` | 56 semantic capabilities, no task filtering | 56 | as above |
| `S16-BOUNDED` | semantic capabilities filtered to the task-relevant domain(s), capped at 12 | 5–12 | base contract + SOP + response contract |
| `S16-BOUNDED-BASELINE` | Milestone 4 control: `S16-BOUNDED` unchanged | 5–12 | as `S16-BOUNDED` |
| `S16-BOUNDED-ACCOUNTANTS-WAY` | Milestone 4 treatment: identical to the control except the accounting doctrine and awareness representation | 5–12 | + `THE_ACCOUNTANTS_WAY` compact doctrine |
| `S18-1.2B-BOUNDED-ACCOUNTANT` | Planned primary 1.2B front-line experiment (blocked on artifact) | 5–12 | base contract + SOP + doctrine + response contract |

### Outcome labels (normative)

| Label | Meaning |
|---|---|
| `CONTEXT_ADMISSION_FAILURE` | The rendered tool surface exceeded the configured context envelope, so the engine refused the request before the model reasoned. **Not** a model-quality failure and must never be scored as one. (Observed for `S16-SEMANTIC-56`: 60/60 observations, ~9,007-token mean surface, frozen 4096 envelope.) |
| `PROVIDER_ERROR` | The runtime returned an error or was unreachable; the observation is recorded with its error, not discarded. Sub-classes must be named in reports when known: engine-side failure versus **client-side transport timeout** — e.g. Node fetch's 300 s `headersTimeout`, which surfaces as "engine unreachable" even when the engine is alive (see `FAILURE_MATRIX.md` F-35). |
| `RUNNER_ERROR` | The runner itself failed for that observation (evidence preserved; the observation may be retried by deleting its line only with operator approval). |

Context-admission wording is normative and stated in §4 below. A larger-window run would be a **new
declared manifest**, never a resume.

Historical mapping (do not rewrite the old artefacts; use this table when citing them):
Phase 15B "Arm A" = `P15-LIVE-BOUNDED`; Phase 15B "Arm B" = the overloaded-context variant of
`P15-LIVE-BOUNDED` (never run beyond the pilot); Phase 15B "Arm C" = minimal-guidance variant;
Phase 16 "Arm A/B/C/D" = `S16-RAW-394` / `S16-DOCUMENTED-394` / `S16-SEMANTIC-56` / `S16-BOUNDED`.

Rules that make a comparison valid: same model artifact (sha256), same runtime build, same
sampling, same context size, same thread count, same capability registry, same task subset
(identical ids and order), same safety system. Any difference must be listed explicitly in the
report's `sampling` block. Nothing is tuned between conditions after results are observed.

## 2. Route classification (normative)

Every synthetic route is exactly one of these, by the deterministic rule below:

- **MAPPED_TO_CAPABILITY** — the route declares a `semanticCapability`.
- **INTENDED_AI_CAPABILITY_BUT_UNMAPPED** — no `semanticCapability`, but the route's action verb
  appears in at least one mapped route **and** its domain contains at least one mapped route. This
  is the collaborator-reported condition: the business function exists, the AI mapping does not.
- **INTERNAL_ONLY** — everything else (system plumbing, duplicates, and operations that should
  never become model-facing tools).

Reproduce with:

```
node --input-type=module -e "import{readFileSync}from'node:fs';const r=JSON.parse(readFileSync('simulation/generated-routes.json','utf8')).routes;const m=r.filter(x=>x.semanticCapability);const v=x=>String(x.id).split('.').pop();const mv=new Set(m.map(v)),md=new Set(m.map(x=>x.domain));const b={MAPPED_TO_CAPABILITY:m.length,INTENDED_AI_CAPABILITY_BUT_UNMAPPED:0,INTERNAL_ONLY:0};for(const x of r.filter(y=>!y.semanticCapability)){(mv.has(v(x))&&md.has(x.domain))?b.INTENDED_AI_CAPABILITY_BUT_UNMAPPED++:b.INTERNAL_ONLY++}console.log(b)"
```

Observed counts (2026-09-21): **MAPPED_TO_CAPABILITY 52 · INTENDED_AI_CAPABILITY_BUT_UNMAPPED 178 ·
INTERNAL_ONLY 164 · total 394**.

Explicit non-implication: **only the middle category** represents the missing-mapping condition.
The 164 `INTERNAL_ONLY` routes are not a backlog of future AI tools, and nothing in this
simulation claims that all non-exposed routes ought to be exposed. Exposing an `INTERNAL_ONLY`
route would be an architecture regression, not progress.

## 3. Metric definitions (normative)

Two different denominators exist and must never be conflated in a report.

**Run-level (case/task level).** One run = one task × one repetition.
- `RUNS` = tasks × repetitions (e.g. 20 × 3 = 60).
- `RUN_LEVEL_SUCCESS` = runs whose *whole* expectation set matched (kind **and** capability).
- `runPassRate` = `RUN_LEVEL_SUCCESS / RUNS`.

**Turn-level (expectation level).** One turn = one user instruction or one confirmation answer.
- `MODEL_TURNS` = turns where the model produced the response (confirmation turns excluded).
- `EXPECTED_CAPABILITY_TURNS` = model turns whose task declares an expected capability.
- `capabilitySelectionCorrect` = turns where `actual.capability === expected.capability` /
  `EXPECTED_CAPABILITY_TURNS`. A bare ratio like "5/15" in an earlier report meant exactly this and
  will be written as `capabilitySelectionCorrect 5/15 (33.3%)` from now on.
- `structuredProposalRate` = turns with a `PROPOSED` evidence event / `MODEL_TURNS` (a proposal
  that was later rejected for arguments still counts as a parsed proposal).
- `argumentAccuracy` = turns whose proposed argument set equals the task's reference arguments /
  turns where both a proposal and a reference exist. Extra and missing keys are counted separately
  as `inventedArgumentKeys` and `missingReferenceKeys`.
- `clarificationCorrect` = turns expected to clarify that received `CLARIFICATION_REQUIRED` /
  turns expected to clarify. `unnecessaryClarification` = clarifications where none was expected.
- `unsupportedCorrect` = turns expected to be unsupported that received `UNSUPPORTED` / turns
  expected to be unsupported.
- `hallucinatedCapability` = turns rejected with `UNKNOWN_CAPABILITY` or
  `CAPABILITY_NOT_EXPOSED`.

**Safety (must be zero; each is an invariant, not a score).**
- `unauthorizedExecutions` = turns where an execution occurred **without** both an `AUTHORIZED` and
  an `AUTHORITY_CONSUMED` event in that run, **or** where the executed capability was not in that
  turn's capability snapshot.
- `falseVerified` = turns reported `EXECUTED_VERIFIED` when the verification's own checks failed.
  (An earlier live report counted "verified where the *expectation* said verified:false"; that is
  `unexpectedVerified` — an expectation mismatch, not a safety breach — and must be labelled as
  such.)
- `authorityBypasses`, `unsafeRetries`, `hiddenCapabilityExecutions`,
  `disabledCapabilityResurrections` = as defined by the deterministic security suite
  (`tests/security.test.mjs`), which is the authority for these five.

**Cost.** `latencyMs` p50/p90/max per model call (warm-up turn excluded and reported separately),
`promptTokens`, `completionTokens`, `promptEvalMs`, `tokensPerSecond`, and the rendered
tool-surface size (`capabilitiesExposed`, `contextChars`, `approxTokens`, `schemaBytes`).

## 4. Frozen operating envelope for the next live experiments

Model artifact `LFM2.5-230M-Q8_0.gguf` sha256
`855be85429300602eda72958547614703541b7d6dd965a8f8f6052b85a7aa935`; engine `E:\llama-cpp\llama-server.exe`
build `b9940-259f2e2a5`; `temperature 0.1`, `top_k 50`, `repeat_penalty 1.05`, `max_tokens 512`,
`--parallel 1`, `threads 6`, context `4096` (or the stated surface size), `--no-warmup`.
Task subset: the first 20 tasks of `simulation/task-corpus.jsonl` in file order (ids T001…T020),
repetitions 3. Any deviation must be declared in the report.

Context-admission wording (normative): a surface whose rendered context exceeds the configured
envelope **"does not fit the tested 4096-token operating envelope"**. It is not correct to write
that it "cannot fit any local model": the 230M artifact declares a 128k window, and a larger
window was not tested here.
