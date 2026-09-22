# Research → Implementation Matrix

Every PHASE 1 finding must have a consequence. A finding with no engineering requirement is
listed as an explicit rejection (Status = REJECTED) with its reason, or as DEFERRED with a
named trigger. Implementation paths are relative to the repository root. Test paths are the
files that fail if the behaviour regresses.

Status legend: **DONE** (implemented + tested) · **PARTIAL** · **DEFERRED** (trigger named) ·
**REJECTED** (not adopted, reason given).

| Finding | Source | Engineering requirement | Implementation | Test | Status |
|---|---|---|---|---|---|
| R-01 | Ollama structured outputs | Send the proposal envelope schema in `format`; never rely on it for correctness | `src/models/ollama-provider.mjs` (`format` in request), `src/models/prompt.mjs` (envelope schema) | `tests/provider.test.mjs` (request body contains `format`; server echo asserted) | DONE |
| R-02 | Ollama schema support subset | Capability and envelope schemas must use only `type/object/properties/required/array/items/enum` + our bounded extras; reject unsupported keywords at registration | `src/registry/capability.mjs` (`assertSupportedSchema`), `src/core/schema.mjs` | `tests/registry.test.mjs` (unsupported keyword rejected) | DONE |
| R-03 | Ollama grounding guidance | Restate the envelope format and the exposed capability schemas in the prompt; send `temperature:0` + fixed `seed` | `src/models/prompt.mjs`, `src/models/ollama-provider.mjs` | `tests/contracts.test.mjs` (prompt contains every exposed capability id), `tests/provider.test.mjs` (options) | DONE |
| R-04 | Chat request shape | `stream:false` explicitly; sampler options nested under `options`; `num_ctx` explicit | `src/models/ollama-provider.mjs`, `config/harness.config.json` | `tests/provider.test.mjs` | DONE |
| R-05 | Response object | Read `message.content`; do not require `done_reason === "stop"`; record usage | `src/models/ollama-provider.mjs` (usage meta → journal), `src/evidence/journal.mjs` | `tests/provider.test.mjs` (allows `load`), `tests/evidence.test.mjs` | DONE |
| R-06 | Tool-call shape | Do **not** use Ollama `tools` in v0.1 (avoids multi-call + no `tool_choice`); use `format` | `src/models/ollama-provider.mjs` (no `tools` field ever sent) | `tests/provider.test.mjs` (asserts no `tools` key) | DONE |
| R-07 | No argument-validation guarantee | Harness owns validation and single-action enforcement | `src/models/response-parser.mjs`, `src/harness.mjs` | `tests/contracts.test.mjs`, `tests/security.test.mjs` | DONE |
| R-08 | Error codes | Map HTTP 400/404/429/500/502/503 and unreachable transport to typed provider errors | `src/models/ollama-provider.mjs`, `src/core/errors.mjs` | `tests/provider.test.mjs` (404 and unreachable) | DONE |
| R-09 | Residency | First-call latency is not a failure; `keepAlive` configurable | `src/models/ollama-provider.mjs`, config | `tests/provider.test.mjs` (request includes `keep_alive`) | DONE |
| R-10 | Streaming | v0.1 sets `stream:false`; a streaming parser is deferred | `src/models/ollama-provider.mjs` | `tests/provider.test.mjs` | DONE (streaming DEFERRED) |
| R-11 | Context defaults | `num_ctx` explicit in config; keep exposure small | `config/harness.config.json`, `src/policy/policy-engine.mjs` (exposure cap) | `tests/registry.test.mjs` (cap enforced) | DONE |
| R-12 | Unauthenticated local API | Enforce localhost unless explicitly enabled; never send secrets to the provider; never set/assume CORS | `src/models/ollama-provider.mjs` (host check), `src/core/config.mjs` | `tests/security.test.mjs` (non-local base URL refused) | DONE |
| R-13 | Best-effort determinism | Record seed/temperature as evidence; no output-equality assertions anywhere | `src/models/ollama-provider.mjs`, `src/evidence/journal.mjs` | `tests/evidence.test.mjs` (metadata recorded) | DONE |
| R-14 | Not strictly versioned | Use native `/api/chat`; record server version when reachable | `src/models/ollama-provider.mjs` (`getVersion`) | `tests/provider.test.mjs` | DONE |
| R-15 | Silent grammar skipping | Independent validation on every proposal; schema restated in prompt | `src/core/schema.mjs`, `src/harness.mjs` | `tests/contracts.test.mjs` (valid JSON, invalid against schema → REJECTED) | DONE |
| R-16 | Portable schema subset + complexity caps | Schema engine supports the documented intersection; registration enforces depth/property/enum caps | `src/core/schema.mjs`, `src/registry/capability.mjs` | `tests/registry.test.mjs` (depth/size caps), `tests/contracts.test.mjs` | DONE |
| R-17 | Syntax-only guarantees | Measure compliance instead of trusting claims | `benchmarks/run-benchmark.mjs` (parse-success metric) | `tests/benchmark.test.mjs` | DONE |
| R-18 | Silent disable of constraints | A response that does not parse as specified is REJECTED, never repaired silently | `src/models/response-parser.mjs`, `src/harness.mjs` | `tests/security.test.mjs` (malformed output) | DONE |
| R-19 | Format restriction degrades reasoning | Keep the constrained object minimal; allow an unconstrained short `reasoningSummary` | `src/models/prompt.mjs` | `tests/contracts.test.mjs` (envelope fields bounded: `maxLength`) | DONE |
| R-20 | Argument errors, placeholders, irrelevance | Bounds + `enum` + `nonPlaceholder` validation; UNSUPPORTED as a first-class outcome | `src/core/schema.mjs` (`nonPlaceholder`), `src/harness.mjs`, `prompts/accounting-resident.sop.md` | `tests/security.test.mjs` (placeholder rejected), `tests/acceptance.test.mjs` (unsupported), benchmark cases B11–B14 | DONE |
| R-21 | Position effects | SOP + capability catalogue first; short catalogue | `src/models/prompt.mjs` (SOP first, catalogue after) | `tests/contracts.test.mjs` (ordering assertion) | DONE |
| R-22 | Tool overload (<20) | Hard exposure cap, deterministic selection | `src/registry/registry.mjs` (`selectFor`), config `exposure.maxCapabilities` | `tests/registry.test.mjs` | DONE |
| R-23 | Consolidate tools; descriptions matter | Namespaced ids; description length gate at registration | `src/registry/capability.mjs` | `tests/registry.test.mjs` (short description rejected) | DONE |
| R-24 | Refusals/truncation legal | Envelope `kind` variants; unparseable output → REJECTED | `src/models/response-parser.mjs` | `tests/contracts.test.mjs`, `tests/security.test.mjs` | DONE |
| R-25 | Bounded repair; untrusted tool output | No auto-retry in v0.1; adapter output never treated as instructions | `src/harness.mjs`, `src/adapters/*` | `tests/security.test.mjs` (injection string in adapter output does not alter flow) | PARTIAL (repair loop DEFERRED) |
| R-26 | Authorization downstream | Policy + permit live in the harness; no shell/URL/eval capability | `src/policy/*`, `src/registry/registry.mjs` | `tests/security.test.mjs` (no arbitrary endpoint), lint rule | DONE |
| R-27 | Model output is untrusted | Strict boundary validation; capabilities implemented in harness code | `src/harness.mjs`, `src/adapters/mock-accounting-adapter.mjs` | `tests/security.test.mjs`, `tests/acceptance.test.mjs` | DONE |
| R-28 | Temperature-0 nondeterminism | Persist accepted arguments as the audit artifact; no equality assertions | `src/evidence/journal.mjs`, `docs/BENCHMARK.md` | `tests/evidence.test.mjs` (arguments recorded verbatim, frozen) | DONE |
| R-29 | Complete mediation, fail-safe defaults | Every execution re-checked at use time; default deny | `src/policy/policy-engine.mjs`, `src/policy/authority.mjs` | `tests/security.test.mjs`, `tests/authority.test.mjs` | DONE |
| R-30 | Confused deputy | The model names a capability only; endpoints/permissions are trusted configuration | `src/adapters/generic-http-adapter.mjs`, `src/core/config.mjs` | `tests/adapters.test.mjs`, `tests/security.test.mjs` | DONE |
| R-31 | Least privilege; log privileged functions | Model is non-privileged; executor is separate; privileged dispatch logged | `src/harness.mjs`, `src/policy/authority.mjs` | `tests/evidence.test.mjs` (AUTHORIZED/EXECUTION_* events) | DONE |
| R-32 | ABAC attributes | Policy inputs are explicit attributes only | `src/policy/policy-engine.mjs` | `tests/security.test.mjs` (model-supplied risk is ignored/rejected) | DONE |
| R-33 | TOCTOU | Check-and-act within one synchronous span; hash binding detects substitution | `src/policy/authority.mjs`, `src/harness.mjs` | `tests/authority.test.mjs` (argument substitution rejected) | DONE |
| R-34 | Single-use, expiring, audience-bound | Permit binding + typed refusals + expiry | `src/policy/authority.mjs` | `tests/authority.test.mjs` (reuse, expiry, mismatch) | DONE |
| R-35 | Idempotency vs single-use | Deny-on-replay for authority; record the proposal hash as the idempotency key; adapter-level idempotency is an integration requirement | `src/policy/authority.mjs`, `docs/INTEGRATION_CONTRACT.md` | `tests/authority.test.mjs` | DONE (adapter idempotency DEFERRED to integration) |
| R-36 | Audit integrity | Append-only, hash-chained, redacted journal outside model reach | `src/evidence/journal.mjs` | `tests/evidence.test.mjs` (chain verify, tamper detection, redaction) | DONE |
| R-37 | Fail-safe defaults (correct attribution) | Cite Saltzer & Schroeder; do not mis-cite NIST | `docs/THREAT_MODEL.md` | documentation review (this matrix) | DONE |
| R-38 | Agentic tool misuse | Pre-execution validation, risk gating, tool-call audit logging; rate limiting deferred | `src/policy/policy-engine.mjs`, `src/evidence/journal.mjs` | `tests/security.test.mjs` | PARTIAL (rate limiting DEFERRED) |
| R-39 | Draft vs posted, reversal | Synthetic domain models DRAFT/POSTED; one-way `invoice.issue`; drafts only for journals | `src/domain/synthetic-accounting/store.mjs` | `tests/acceptance.test.mjs` (deterministic state), `tests/security.test.mjs` (issued invoice cannot be re-issued) | DONE |
| R-40 | Deterministic scoring | No LLM judging in the benchmark | `benchmarks/run-benchmark.mjs` | `tests/benchmark.test.mjs` (metrics are integers/booleans) | DONE |
| R-41 | State + trace; aborts fail | Benchmark records final state and treats incomplete as failure | `benchmarks/run-benchmark.mjs` | `tests/benchmark.test.mjs` | DONE |
| R-42 | Format sensitivity | Record prompt/SOP/schema/fixture hashes per run | `benchmarks/run-benchmark.mjs` (hashes), `docs/BENCHMARK.md` | `tests/benchmark.test.mjs` (hashes present) | DONE |
| R-43 | Reliability over trials | Scripted runs are deterministic; model-quality runs require k trials | `docs/BENCHMARK.md` (method), report schema includes `trials` | `tests/benchmark.test.mjs` (report includes trial count) | DONE (model runs DEFERRED: no Ollama on this machine) |
| R-44 | Version pinning; no LLM attribution | Fixture hash pinned; failure classification is a fixed taxonomy | `benchmarks/run-benchmark.mjs`, `docs/BENCHMARK.md` | `tests/benchmark.test.mjs` (fixture hash recorded) | DONE |
| R-45 | One variable per arm | Arms differ by exactly one factor; harness version recorded | `docs/BENCHMARK.md` (arm definition) | documentation review | DONE |
| R-46 | Reproducibility reporting | Report embeds the exact command, config hash, environment | `benchmarks/run-benchmark.mjs` | `tests/benchmark.test.mjs` | DONE |
| R-47 | Contamination | Fixtures are never training data; declaration in every report | `docs/BENCHMARK.md`, report field `contaminationDeclaration` | `tests/benchmark.test.mjs` | DONE |
| R-48 | Latency discipline | p50/p90/p99/max per step type; model-load time separated | `benchmarks/run-benchmark.mjs` (percentiles) | `tests/benchmark.test.mjs` | DONE |
| R-49 | Instrumentation shape | Fixed-bucket duration records with environment/scripted labels | `benchmarks/run-benchmark.mjs` (`latencyBucketsMs`) | `tests/benchmark.test.mjs` | PARTIAL (OTel export DEFERRED) |
| R-50 | Seeds are not reproducibility | Record seed/temperature/backend; no equality claims | report field `decodeParams`, `backend` | `tests/benchmark.test.mjs` | DONE |
| R-51 | Reference permit lifecycle | One-use, TTL, typed refusals, refuse to issue without ALLOW | `src/policy/authority.mjs` | `tests/authority.test.mjs` | DONE |
| R-52 | Reference policy engine | Three-way decision; fail-closed conversion of internal errors to DENY | `src/policy/policy-engine.mjs` | `tests/security.test.mjs` (throwing capability metadata → DENY) | DONE |
| R-53 | Reference evidence chain | Hash chain + chain verification + redaction | `src/evidence/journal.mjs` | `tests/evidence.test.mjs` | DONE |
| R-54 | Canonical action hash | `canonical-action-json-v1` semantics; permit bound to the hash; no replay | `src/core/canonical.mjs`, `src/policy/authority.mjs` | `tests/authority.test.mjs`, `tests/contracts.test.mjs` | DONE |
| R-55 | Reference architecture laws | Model is not the authority; no shell tool; plane separation | `docs/ARCHITECTURE.md`, `src/registry/registry.mjs` | lint rule forbidding `child_process`/`eval`; `tests/security.test.mjs` | DONE |
| R-56 | Scale-simulation surface measurements (Phase 16, 2026-09-21; `benchmarks/results/scale/surface-measurements.json`) | Any tool surface must be measured against the model's context window before an arm is run; non-fit is declared, never truncated silently | `benchmarks/run-scale-simulation.mjs` (`--measure` / `measureSurfaces`) | measurement record per surface (`fitsContext4096`); failure matrix F-31 | DONE (raw/documented/semantic declared non-executable at 4096) |
| R-57 | Pre-fix live scale-simulation run (2026-09-21) + R-16 | A schema→grammar conversion enforces only `required` fields; therefore require every envelope field, and never treat a model-supplied proposal id as identity | `src/models/prompt.mjs` (`ENVELOPE_FORMAT_SCHEMA`, all fields required), `src/harness.mjs` (`normalizeProposalId`) | `tests/contracts.test.mjs` (all-fields-required form); live evidence `benchmarks/results/scale/bounded-2026-09-21T17-04-25-565Z.json` T004/T008 | PARTIAL (fix in the working tree; the phase's verification pass is pending review) |
| R-58 | Same measurement record | The bounded surface (task-relevant filter + cap) is the only measured arm that fits a 4096-token window; exposure defaults to bounded, and any larger surface requires a deliberate window increase | `benchmarks/run-scale-simulation.mjs` (filter + cap 12), `config/harness.live-230m.json` (`exposure.maxCapabilities`), `src/registry/registry.mjs` (`selectFor`) | `surface-measurements.json` (D fits; A/B/C do not); capability-context arm figures in `docs/BENCHMARK.md` | DONE (mechanism + measurement); no default exposure change is made by this phase |

## Deferrals (with named triggers)

| Deferred item | Trigger to revisit | Recorded in |
|---|---|---|
| Streaming (NDJSON) parser | When a real model run shows latency or token-budget pressure | this matrix, R-10 |
| Automatic repair loop for invalid proposals (bounded, error-typed) | When a real model's parse-success rate is measured and below the acceptance bar | R-25 |
| Rate limiting per capability | Before any multi-user or network-exposed deployment | R-38 |
| Adapter-level idempotency keys | When the collaborator confirms a mutating endpoint and whether it accepts idempotency keys | R-35, INTEGRATION_CONTRACT |
| OpenTelemetry metrics export | When the harness is embedded in a monitored service | R-49 |
| Model-quality benchmark arms (real Ollama runs, k trials) | When Ollama is installed on the measurement machine | R-43 |
