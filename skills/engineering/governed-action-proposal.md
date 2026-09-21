---
name: governed-action-proposal
description: Turns one user instruction into exactly one validated, frozen proposal — or a typed clarification, unsupported, or rejection — before any policy or execution step.
---

## Purpose
Own the untrusted boundary between model text and a typed request: strict parsing, envelope validation,
capability resolution against the exposed set, argument validation against registry metadata, and freezing of
the accepted object. Nothing here executes or authorizes; this skill produces the `proposalHash` later steps bind to.

## When to use
- In the per-turn path of `src/harness.mjs`, from user instruction to `PROPOSED` evidence.
- When changing `src/models/prompt.mjs` (SOP injection, catalogue ordering, envelope restatement).
- When classifying a `REJECTED` proposal or a parse failure during benchmarking.
- When adding a new `kind` or envelope field (rare; the envelope is `additionalProperties:false`).

## When NOT to use
- To decide policy, issue permits, or gate confirmations (see `execution-authority-design`, `confirmation-binding`).
- To add a repair or retry loop: DM-15 defers it with a named trigger (measured parse-failure rate, R-25).
- To make an unregistered operation reachable: that is `semantic-capability-design`.

## Prerequisites
- A resident SOP exists and is injected first in the system prompt (`prompts/accounting-resident.sop.md`; SAH-REQ-029/030).
- The envelope schema and capability schemas are registered and inside the portable subset (R-16).
- The session has a run counter and a proposal-id set for replay detection (ARCHITECTURE §6).

## Inputs
- The user's instruction text and the new `runId`; the deterministically selected exposure set for this turn.
- The raw provider response (`message.content`, or the typed provider error) and the session's seen proposal ids.
- Registry metadata: risk, argument schema, and `nonPlaceholder` markers for the selected capabilities.

## Procedure
1. Journal `USER_INSTRUCTION` with the new `runId` before calling the provider.
2. Select exposure deterministically: declaration order filtered by `exposure.domains`, then keyword tags, capped at `exposure.maxCapabilities` (DM-10); journal `CAPABILITIES_EXPOSED` with the exact ids.
3. Build the prompt with the SOP first, the catalogue after it, and the envelope schema restated; request `format` = envelope schema, `stream:false`, `temperature:0`, fixed `seed` (R-21, R-03, R-18, DM-02, R-04).
4. Parse strictly: exactly one JSON object, optionally inside one fenced block; no prose-prefixed extraction, no repair (DM-07); failure yields `PROPOSAL_REJECTED` with `RESPONSE_NOT_JSON` (F-05).
5. Validate the envelope: `kind` in `{proposal, clarification, unsupported}`; `proposalId` matches `^[A-Za-z0-9._:-]{1,64}$` and is unseen this session (F-30); `reasoningSummary` is 1–500 characters; unknown fields — including `risk` or any permission notation — are rejected (I-4, T-01).
6. Resolve the capability: it must exist in the registry (F-07) and be in this turn's exposed set (F-08); reject with the exposed id list, not a generic message.
7. Validate `arguments` against the registered `inputSchema` in harness code, independent of `format` (DM-08, R-15, R-18); reject placeholders where `nonPlaceholder` is declared (R-20).
8. Deep-freeze the validated proposal: this object — not a re-parse, not a summary — is what confirmation shows and execution uses (I-3, T-08, B-1).
9. Compute `canonical-action-json-v1` over `{capability, arguments}` and journal `PROPOSED` with capability, registry risk, redacted arguments, and the hash.
10. Handle the other kinds without inventing intent: `clarification` → `CLARIFICATION_REQUIRED` plus `CLARIFICATION_REQUESTED` (F-10); `unsupported` → `UNSUPPORTED` plus `UNSUPPORTED_REQUEST` (F-11).
11. Hand the frozen proposal to policy; execute nothing here (I-1).
12. On rejection, emit the per-field violation list with paths and the terminal `REJECTED` status (F-06, F-09).

## Decision points
| Condition | Action |
|---|---|
| Prose wraps or follows the JSON object | `REJECTED` / `RESPONSE_NOT_JSON`; do not extract a substring (DM-07) |
| Valid JSON, capability not registered | `REJECTED` / `UNKNOWN_CAPABILITY`; return the exposed ids (F-07) |
| Capability registered but outside this turn's exposure | `REJECTED` / `CAPABILITY_NOT_EXPOSED`; widening exposure is a config act (T-03, F-08) |
| Model asks for clarification where the catalogue can answer | Treat as an SOP/prompt defect; fix wording, not the parser |
| Model returns `unsupported` for an operation that exists | Exposure/selector defect; record a benchmark case, do not add a fallback tool |
| `proposalId` already seen this session | `REJECTED` / `PROPOSAL_ID_REPLAY` (F-30) |
| Arguments carry a syntactically valid but nonexistent id | Validation passes; existence is a domain error surfaced at execution, not a schema error |
| Provider returns an error or malformed payload | `PROVIDER_ERROR`; never synthesise a proposal (F-01..F-04) |

## Failure conditions
- More than one JSON object, or trailing prose, accepted as a proposal.
- A `risk`, permission, URL, method, or path field survives envelope validation.
- Placeholder values such as `"INV-XXXX"` where `nonPlaceholder` is declared, or numeric fields sent as strings.
- A proposal executed without a `PROPOSED` record and a hash (I-1 violated downstream).
- The raw provider body journaled verbatim (F-04 forbids it; it may contain attacker text).

## Stop conditions
- The response is ambiguous between two capabilities and argument sets.
- An exposure set cannot be computed for a request the operator clearly intends (empty or truncated set).
- A proposed capability's semantics cannot be stated from registry metadata alone.
- Satisfying the proposal would require model-computed arithmetic the domain owns (SAH-REQ-030).
- Canonicalisation of the accepted arguments is undefined for a new value type — fix `canonical-action-json-v1` first (R-54).

## Security considerations
- Model output is untrusted input, handled like any external payload (R-27); the parser and validator are a trust boundary, not a convenience (ARCHITECTURE §5.1–5.2).
- Injection in user text, retrieved data, or adapter output can cause a *proposal*; it cannot lower risk, skip confirmation, or grant authority (T-01).
- The model receives capability descriptions and the user request only — no credentials, no internal routes, no permit state (ARCHITECTURE §5.10).
- Validation runs in harness code even when `format` constrained decoding is active, because grammar acceptance is syntax-only (R-15, DM-08).

## Verification
- `tests/proposal.test.mjs`: envelope violations, unknown capability, missing/extra fields, placeholder rejection, prompt contains every exposed id with the SOP first (R-21).
- `tests/security.test.mjs`: an injection string in adapter output stays inert; a proposal carrying `risk` is rejected; malformed output is never repaired.
- Benchmark metrics computed non-LLM: parse success, capability match, argument validity, abstention (R-40, R-41).
- Evidence reconstruction: for one `runId`, the journal shows `USER_INSTRUCTION`, `CAPABILITIES_EXPOSED`, `PROPOSED` with hash, and a terminal status consistent with the last lifecycle event (I-5).

## Expected outputs
- A deep-frozen validated proposal plus a `PROPOSED` event carrying the canonical hash; or
- `PROPOSAL_REJECTED` with typed violations and offending paths; or
- `CLARIFICATION_REQUIRED` / `UNSUPPORTED` with the corresponding event — each mapped to a status from the closed set in ARCHITECTURE §3.5.

## Dependencies
- `src/models/response-parser.mjs`, `src/models/prompt.mjs`, `src/models/provider.mjs`
- `src/core/schema.mjs`, `src/core/canonical.mjs`, `src/registry/registry.mjs`
- `src/evidence/journal.mjs`, `src/harness.mjs`, `prompts/accounting-resident.sop.md`

## References
- R-01 (Ollama Structured Outputs), R-04 (Ollama chat API) — `format`, `stream:false`, sampler locations; R-03 (structured-output guidance), R-18 (vLLM structured outputs), R-21 ("Lost in the Middle") — restate the schema, SOP and catalogue first.
- R-15 (llama.cpp GBNF guide), R-20 (Berkeley Function-Calling Leaderboard), R-24 (OpenAI refusals) — validate independently; refusals and truncation are legal outputs.
- R-27 (OWASP LLM05:2025/LLM01:2025), R-40 (BFCL deterministic scoring).
- DM-02, DM-07, DM-08, DM-10, DM-15; F-05..F-11, F-30; T-01, T-02, T-03.

## Examples
- Instruction "bill Acme for last week's work": the domain owns amounts, so the correct outcomes are `invoice.create_draft` with domain-owned line references, or a `clarification` asking which customer — never an amount computed by the model.
- Proposal `{"kind":"proposal","capability":"invoice.issue","arguments":{"invoiceId":"INV-2026"},"reasoningSummary":"Issue the invoice."}`: `invoiceId` fails the pattern `^INV-[0-9]{4}$`, so the status is `REJECTED` with violation path `/arguments/invoiceId`.
- A proposal naming `invoice.issue` with an added `"risk":"READ"` field is `REJECTED` on the unknown field; risk is read only from registry metadata (I-4).

## Anti-patterns
- Regex-extracting the first JSON-looking substring from a paragraph.
- Asking the model to repair its own output in v0.1 (DM-15 defers this and names the trigger).
- Accepting a model-supplied `risk`, permission, or endpoint.
- Inventing a capability so the user's request appears serviceable, or treating `UNSUPPORTED` as a bug to paper over.
- Executing inside the parse path "because the arguments already validated".
