---
name: integration-contract-mapping
description: Maps a real external system's operation inventory to capability candidates and a written contract, without inventing routes, schemas, field names, or transaction semantics.
---

## Purpose
Convert a collaborator's operation inventory into (a) a reduced set of semantic capability candidates and (b) contract rows carrying the nine required fields: semantic operation, existing service or route, method, request/response schema, permission, side effects, transaction semantics, verification method, risk class (SAH-REQ-043). Unknown cells stay UNKNOWN and become questions; nothing is filled by inference.

## When to use
- The collaborator provides an operation inventory, an OpenAPI description, or a service list.
- Preparing or revising `docs/INTEGRATION_CONTRACT.md` sections.
- Reducing one workflow to ≤ `exposure.maxCapabilities` capabilities (A-1, A-9).
- Answering "can we onboard operation X" before `semantic-capability-design` is applied.

## When NOT to use
- For the synthetic pack: the 8 capabilities exist precisely so no collaborator surface is guessed (DM-09).
- To write adapter code before the binding fields (method, path, read-back) exist in writing.
- To infer anything from a vendor's public documentation; that is not the collaborator's system.
- To decide the harness's own design (that is `docs/ARCHITECTURE.md` plus the matrices).

## Prerequisites
- An operation inventory with per-operation detail; if only a verbal summary exists, request the table first.
- `docs/INTEGRATION_CONTRACT.md` skeleton open, including its epistemic-status section.
- The collaborator's answers available or outstanding for read-back per mutation (A-2), idempotency keys (A-5), local runtime (A-6), and multi-user permission mapping (A-13).
- `config/harness.config.json` exposure cap and `adapters.http` shape known.

## Inputs
- The inventory rows as reported, with a REPORTED/UNKNOWN marker on every cell not taken from a document.
- One target workflow described by the collaborator, end to end.
- Existing registry entries (to avoid duplicating coverage) plus the harness's flat permission model and the collaborator's permission strings.

## Procedure
1. Record the nine fields per operation in a table; mark REPORTED and UNKNOWN cells explicitly and defer the question list to the collaborator instead of completing the table by plausibility (A-1).
2. Reduce the inventory to the operations one workflow needs; expect many routes to collapse into few capabilities (R-23).
3. Name each candidate `domain.verb` as a business intent (DM-01); reject names that mirror routes, versions, or vendor terminology.
4. Answer the verifiability question per candidate: which read-back proves the effect? If none exists, mark the operation unverifiable and record the consequence — it may not be exposed with a stub verifier (H-4, A-2).
5. Classify risk from the effect (READ/DRAFT/MUTATION/FINANCIAL) and record whether confirmation is required; FINANCIAL always requires it (SAH-REQ-013).
6. Record the permission the collaborator's system enforces and whether the harness's flat granted set can express it; multi-user mapping is a named gap, not an assumption (A-13).
7. Record transaction semantics: atomicity, timeout-after-commit behaviour, and whether an idempotency key is accepted; this answer decides whether any retry is safe (A-5, R-35, H-8).
8. Choose the adapter kind: mock for synthetic; `http` only when the base URL, binding, and headers source exist in trusted configuration, since a capability without a binding is denied, never defaulted (F-20, T-09).
9. Write the binding as `{method, path}` with path parameters mapped to capability argument names; the model supplies arguments only and never sees the path (I-8, R-30).
10. Write the acceptance evidence: expected terminal statuses for success, denial, execution failure, and verification failure, plus the read-back assertion that distinguishes `EXECUTED_VERIFIED` from `EXECUTION_SUCCEEDED` (R-41, DM-14).
11. Add the integration-requirement rows: idempotency key or read-back for mutating endpoints (R-35), provider error mapping (F-01..F-04), rate-limit expectations deferred with a trigger (R-38), data-protection obligations for real customer data (v0.1 assumption 4).
12. Version the contract and record the inventory hash; any inventory change is a new revision and requires re-running steps 2–11 for the affected rows.

## Decision points
| Condition | Action |
|---|---|
| A required field is absent from the inventory | Do not onboard; request it; inventing a field name is forbidden (assumption table) |
| No read-back exists for a mutation | Pair it with a read-back or declare it unverifiable and keep it out of the exposed set (H-4) |
| Legacy and v2 routes implement one intent | One capability, one binding; the other is a migration concern (R-23) |
| Workflow exceeds `exposure.maxCapabilities` | Split into sub-workflows with separate exposure domains (A-9); never raise the cap silently |
| Operation moves money, tax, payroll, or is regulatory | Out of scope by decision (DM-09, SAH-REQ-046); document the boundary, do not implement |
| Collaborator cannot host a local runtime | The provider interface permits a hosted one, but sovereignty requires explicit opt-in and a DM row (A-6, R-12) |
| Report claims "AES-256-GCM" or "~400 routes" | Record as REPORTED; ask for the implementation artefact or route list; do not design against the claim |
| Inventory includes "run arbitrary query" or fetch-style operations | Reject the integration shape; a model-named target is not onboardable (I-8, R-26) |

## Failure conditions
- A contract naming a route, field, or permission the collaborator never provided.
- A verification-method cell reading "trust the response" or "check HTTP 200" (DM-14 rejected), a permission cell reading "admin", or a risk cell left blank.
- An idempotency answer assumed rather than asked (A-5 stays OPEN until answered).
- A capability exposed before its binding, verifier, and permission exist, or two capabilities for one business intent (R-22).

## Stop conditions
- The inventory is unavailable or exists only as a verbal summary.
- Two contract fields conflict for one operation, or the same route appears with different methods and no owner.
- A mutating endpoint has unknown transaction semantics AND no read-back.
- A required permission cannot be expressed by the harness's granted set.
- Onboarding would require the model to supply a URL, host, path, method, or command.

## Security considerations
- The contract must preserve complete mediation for the real system: authorization happens in the harness, not in the collaborator's UI, and every call is permitted and journalled (R-26, R-29).
- Bindings are trusted configuration; the model cannot name a target (R-30, T-09).
- `adapters.http` is disabled by default; the base URL is validated at config load and a non-local URL requires explicit opt-in with a journaled warning (R-12, F-29).
- Headers and credentials live in a gitignored file, are never journaled, and never appear in code (T-13, SAH-REQ-023); real customer data brings data-protection duties named in the contract even though v0.1 is synthetic.

## Verification
- `docs/INTEGRATION_CONTRACT.md` contains all nine fields for every candidate operation, with REPORTED/UNKNOWN markers (SAH-REQ-043, SAH-REQ-044).
- Each onboarded capability has a registry entry, a verifier, an adapter binding, and a contract test.
- `tests/adapter-http.test.mjs` covers binding resolution, redirect refusal (T-10), and status handling (H-8); `tests/security.test.mjs` covers non-local base URL refusal and unknown-argument rejection (T-09, F-29).
- The workflow's exposed set fits the cap, and the benchmark's selection cases are added (A-1, A-9, R-40).

## Expected outputs
- A versioned contract section with the nine-field table and an inventory hash.
- A candidate capability list with risk, permission, verifier, binding, and verifiability status per row.
- An explicit open-questions list covering the A-2/A-5/A-6/A-13 gaps, each marked as a blocker for the affected capability rather than an assumption.
- One end-to-end contract test plan per onboarded capability, including the failure statuses to assert.

## Dependencies
- `docs/INTEGRATION_CONTRACT.md`, `docs/matrices/ASSUMPTION_MATRIX.md`, `docs/matrices/DECISION_MATRIX.md`
- `config/harness.config.json`, `src/adapters/generic-http-adapter.mjs`, `src/registry/capability.mjs`, `sops/capability_onboarding.md`

## References
- R-23 (Anthropic "Define tools") — consolidate related operations; descriptive ids reduce selection ambiguity.
- R-26 (OWASP LLM06:2025 Excessive Agency), R-30 (Hardy, "The Confused Deputy") — no caller-named authority.
- R-34 (RFC 6749) with R-35 (IETF idempotency-key draft; Stripe) — deny-on-replay locally; idempotency negotiated at the collaborator's endpoint.
- R-38 (OWASP Agentic AI threats) — pre-execution validation, risk gating, logging; rate limiting deferred; R-41 (BFCL v3) — state checks and response checks both required for a pass.
- R-12 (Ollama authentication) — localhost-bound, unauthenticated provider boundary; DM-01, DM-09, DM-10; A-1, A-2, A-5, A-6, A-13; H-4, H-8; T-09, T-10, T-13; F-29.

## Examples
- The collaborator reports invoices are posted with `POST /api/v2/invoices/{id}/post` and `GET /api/v2/invoices/{id}` returns status. Contract row: semantic operation `invoice.issue`; verifier `invoice.issued` reads the GET; binding `{method:"POST", path:"/api/v2/invoices/{invoiceId}/post"}` with `invoiceId` mapped to the capability argument; permission `accounting.financial`; risk FINANCIAL; transaction semantics OPEN (timeout-after-commit), so an idempotency key or read-back check is a named requirement before exposure (R-35, H-8).
- The inventory lists 40 invoice endpoints; the workflow needs three — `invoice.create_draft`, `invoice.preview`, `invoice.issue` — and the remaining 37 are not exposed (DM-01, R-22).
- The inventory has no read-back for a "mark as paid" operation: it stays unverifiable, is excluded from the exposed set, and the gap is written into the contract (H-4).

## Anti-patterns
- Reading the collaborator's public docs and treating them as the route contract, or generating runtime tools from an ingested OpenAPI description (DM-01(b) rejected).
- Onboarding an operation with a placeholder verifier that returns success.
- Accepting permission strings the harness cannot grant, or leaving the idempotency question unresolved and hoping retries are not needed.
- Downgrading verification to the adapter's success flag when a read-back turns out to be missing (DM-14 rejected).
