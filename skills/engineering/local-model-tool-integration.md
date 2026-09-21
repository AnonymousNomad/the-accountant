---
name: local-model-tool-integration
description: Integrates the loopback model runtime and the scripted fixture provider as untrusted proposal sources behind the provider boundary; use when wiring src/models/ollama-provider.mjs, choosing the proposal transport, changing the prompt or envelope, or diagnosing PROVIDER_ERROR and RESPONSE_NOT_JSON outcomes.
---

## Purpose
Make `src/models/*` the only path from a language model to a proposal. The model proposes; the harness validates. Fix the Ollama contract (loopback base URL, `stream:false`, `format` = envelope schema, temperature 0, fixed seed, no credentials, never `tools`/`tool_calls`) and keep the scripted provider a labelled fixture that traverses the identical pipeline.

## When to use
- Wiring `src/models/provider.mjs` selection, `src/models/ollama-provider.mjs`, or `src/models/scripted-provider.mjs`.
- Changing the system prompt or envelope shape in `src/models/prompt.mjs` or `src/models/response-parser.mjs`.
- Adding or changing provider error mapping, timeout behaviour, or provider metadata recorded as evidence.
- Diagnosing `PROVIDER_ERROR`, `PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `PROVIDER_MODEL_MISSING`, or `REJECTED` paths (F-01..F-06).

## When NOT to use
- Policy, permit, confirmation, or exposure changes (`src/policy/*`, `src/registry/registry.mjs`) — separate authority work.
- Capability schema or registration changes — owned by the capability onboarding SOP (`sops/capability_onboarding.md`); benchmark scoring and reporting live in `local-agent-benchmarking.md`.
- Reaching a hosted or remote model by default. If the provider is not loopback, it is out of scope unless `allowNonLocalProvider` is explicitly enabled and the warning is journaled (R-12, F-29).

## Prerequisites
- `config/harness.config.json` loads and validates; unknown keys are rejected (F-28).
- Zero runtime dependencies; Node standard library only (DEPENDENCY_MATRIX.md).
- A capability pack where every capability declares a registered verifier (I-10).
- Acceptance that Ollama may be absent (verified absent on this machine, 2026-09-21); the provider must fail closed, and deterministic tests must not require a runtime.
- Treat module and test paths here as the templates fixed by `docs/ARCHITECTURE.md` §2 and `docs/REQUIREMENTS_TRACEABILITY.md`; a path missing from the tree is unimplemented, not optional.

## Inputs
- User instruction text (untrusted) and the exposed capability set from `src/registry/registry.mjs`.
- The provider config block: `baseUrl`, `model`, `timeoutMs`, `numCtx`, `keepAlive`, `seed`, `temperature`, `allowNonLocalProvider`.
- The envelope schema sent as `format`, and the fixture file replayed by the scripted provider.

## Procedure
1. Confirm `provider.baseUrl` is loopback. If not, require `allowNonLocalProvider: true` and journal a warning at session start; otherwise refuse to construct the provider (R-12, F-29).
2. Build the request: `POST /api/chat` with `stream:false` explicitly, `model`, `messages` (system prompt first), `format` = envelope schema, `options.num_ctx`, `options.temperature: 0`, `options.seed`, and `keep_alive` (R-04, R-11).
3. Never set `tools`/`tool_calls` and never rely on `tool_choice`; the proposal transport is `format`, not function calling (R-06, R-07, DM-02).
4. Enforce `provider.timeoutMs`; abort the request on expiry and map it to `PROVIDER_TIMEOUT` (F-02).
5. Read `message.content` only. Treat `done_reason` (for example `load`) as informational metadata, not as failure or success (R-05).
6. Map failures to typed provider errors: connection refused to `PROVIDER_UNAVAILABLE`; HTTP 404 to `PROVIDER_MODEL_MISSING`; other 4xx/5xx to `PROVIDER_BAD_RESPONSE`. Never journal the raw provider body; journal shape and diagnostics only (F-01..F-04).
7. Pass content to `src/models/response-parser.mjs` and accept exactly one JSON object, optionally inside one fenced block. Reject prose, arrays, concatenated objects, and truncation with `RESPONSE_NOT_JSON` and the parse position (R-24, DM-07).
8. Validate the envelope: `kind` in `proposal`/`clarification`/`unsupported`; `proposalId` matches `^[A-Za-z0-9._:-]{1,64}$` and is unused in the session; `reasoningSummary` is 1-500 characters; unknown fields are rejected; any `risk` field is rejected (I-4, F-30).
9. Validate `proposal.arguments` against the capability `inputSchema` via `src/core/schema.mjs`; reject unknown capability and non-exposed capability before policy (F-07, F-08).
10. On rejection, emit `PROPOSAL_REJECTED` with the violation list and a bounded excerpt. Do not repair, guess, or re-prompt within the turn; there is no repair loop in v0.1 (DM-07, DM-15).
11. Keep `clarification` and `unsupported` first-class: they must terminate as `CLARIFICATION_REQUIRED` and `UNSUPPORTED`, never as invented actions (F-10, F-11).
12. For tests, CI, and the scripted demo, replay fixtures through `src/models/scripted-provider.mjs`, assert they enter the same validation path, and label every report `scripted`; never present fixture replay as model capability (DM-12).
13. Record provider kind, model, seed, temperature, `num_ctx`, `keep_alive`, and the server version when reachable as evidence metadata (R-13, R-14, R-50).

## Decision points
| Condition | Action |
|---|---|
| Base URL is not loopback and opt-in is false | Refuse config at load; do not start (F-29) |
| Runtime unreachable or request times out | Terminal `PROVIDER_ERROR`; no proposal invented (F-01, F-02) |
| Model returns HTTP 404 | `PROVIDER_MODEL_MISSING`; operator serves the model; no silent model fallback (F-03) |
| Content is not exactly one JSON object | `REJECTED`/`RESPONSE_NOT_JSON`; no extraction or repair (F-05) |
| Envelope valid but arguments invalid | `REJECTED` with per-field issues; new user turn (F-09) |
| Request names no capable operation | `UNSUPPORTED`; state plainly that nothing executed (F-11) |
| Test or demo needs determinism | Scripted provider, labelled; same pipeline as a real provider (DM-12) |

## Failure conditions
- Provider: `PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `PROVIDER_MODEL_MISSING`, `PROVIDER_BAD_RESPONSE` (F-01..F-04).
- Parse: `RESPONSE_NOT_JSON` with position and bounded excerpt (F-05).
- Envelope: missing/extra fields, wrong `kind`, duplicate `proposalId` (F-06, F-30).
- Routing: `UNKNOWN_CAPABILITY`, `CAPABILITY_NOT_EXPOSED` (F-07, F-08).
- Arguments: type, enum, bounds, unknown field, placeholder (F-09).

## Stop conditions
- A non-loopback base URL appears without explicit opt-in — stop and fix config.
- Someone proposes tolerant extraction, regex parsing, or an in-turn repair loop — stop; deferred with a named trigger (DM-15).
- A test passes only because the scripted fixture bypasses validation — stop; the fixture must traverse the pipeline.
- A provider change would send credentials or accept a model-supplied endpoint — stop; forbidden (R-12, I-8).

## Security considerations
- Model output is untrusted input; validate at the boundary, never downstream (R-27).
- No credentials are sent to or received from the runtime; the local API is unauthenticated (R-12).
- Grammar or `format` acceptance is syntax-only; silent feature skipping is documented, so harness-side validation is mandatory (R-15, R-17, R-18, DM-08).
- Raw provider bodies can contain attacker text; do not journal them (F-04, T-13).
- Keep the constrained object minimal and leave only the bounded `reasoningSummary` free-form (R-19).

## Verification
- `npm run verify`; `tests/provider-ollama.test.mjs` asserts `stream:false`, `format` present, no `tools` key, `keep_alive`, sampler options nesting, timeout mapping, 404 and unreachable mapping (SAH-REQ-001, SAH-REQ-003).
- `tests/proposal.test.mjs` asserts envelope accept/reject, prompt contains every exposed capability id, and SOP precedes the catalogue (SAH-REQ-004, R-21).
- `tests/security.test.mjs` asserts malformed output never executes and a non-local base URL is refused (SAH-REQ-002, SAH-REQ-039).
- Record the exact command and output in `docs/EVIDENCE.md`; record the server version in the benchmark report when reachable.

## Expected outputs
- A provider module behind `src/models/provider.mjs` with typed errors, a journal record for every `PROVIDER_ERROR` and `PROPOSAL_REJECTED`, and a proposal or refusal that entered the same validation path regardless of provider.

## Dependencies
- `src/core/config.mjs`, `src/core/errors.mjs`, `src/core/schema.mjs`.
- `src/models/prompt.mjs`, `src/models/response-parser.mjs`, `src/models/scripted-provider.mjs`.
- `src/registry/registry.mjs` (exposure), `src/evidence/journal.mjs`.
- `config/harness.config.json`.

## References
- R-01 Ollama Structured Outputs (PRIMARY); R-02 Ollama chat API schema subset (PRIMARY); R-03 Structured-output guidance (PRIMARY); R-04, R-05 chat request/response shape (PRIMARY).
- R-06, R-07 tool-calling shape and missing argument guarantee (PRIMARY); R-08 error codes (PRIMARY); R-09 residency (PRIMARY); R-10 streaming NDJSON (PRIMARY); R-11 context default (PRIMARY).
- R-12 no local authentication (PRIMARY); R-13 best-effort determinism (PRIMARY); R-14 versioning (PRIMARY).
- R-15 llama.cpp grammar skipping (PRIMARY); R-16 portable strict subset (PRIMARY); R-19 format restriction (PRIMARY peer-reviewed); R-24 refusals/truncation (PRIMARY); R-25 handling tool calls (PRIMARY); R-27 improper output handling (STANDARD); R-28 temperature-0 nondeterminism (AUTHORITATIVE SECONDARY); R-50 seeds do not guarantee reproducibility (PRIMARY).
- Decisions DM-02, DM-07, DM-08, DM-12, DM-15; failures F-01..F-11, F-29, F-30.

## Examples
- Provider config: `{"provider":{"kind":"ollama","baseUrl":"http://127.0.0.1:11434","model":"REPLACE_WITH_YOUR_MODEL","timeoutMs":30000,"numCtx":8192,"keepAlive":"5m","seed":7,"temperature":0,"allowNonLocalProvider":false}}`.
- Scripted arm: replay a `customer.create` or `invoice.issue` case from `benchmarks/prompts.jsonl` through `src/models/scripted-provider.mjs`, then assert the proposal was validated, risked, permitted, and verified exactly as a real-model proposal would be.
- Provider failure drill: point a test server at a closed port and confirm terminal `PROVIDER_ERROR` with code `PROVIDER_UNAVAILABLE` and no execution event.

## Anti-patterns
- Parsing with regex or extracting the first JSON-looking substring.
- Using Ollama `tools` and trusting returned arguments as validated.
- Shipping a fallback provider or model substitution that hides unavailability.
- Reporting scripted-fixture coverage as model capability.
- Assuming `done_reason: "stop"` or bit-equal outputs across runs.
