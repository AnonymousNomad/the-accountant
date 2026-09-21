---
name: semantic-capability-design
description: Converts an internal operation into a registered semantic capability with a strict argument schema, a trusted risk class, and an independent verifier, and audits the registry for exposure and verifiability defects.
---

## Purpose
Turn a real operation (route, RPC, batch job) into a capability: a named intent the model may select, with arguments the harness validates, risk the harness owns, and an effect the harness verifies. The model never sees or names the transport. This skill merges capability design with registry audit.

## When to use
- Onboarding an operation into `src/registry/capability.mjs` / `src/registry/registry.mjs` (see `sops/capability_onboarding.md`).
- Splitting an over-broad capability, or tightening an argument schema.
- Auditing the 8-capability synthetic pack or any grown registry (Audit procedure below).
- Deciding whether an operation is verifiable enough to expose at all.

## When NOT to use
- To expose a generic `http.request`, shell, eval, or file-path capability: DM-01 rejects it and SAH-REQ-041 lints against it.
- To change risk or permissions from a proposal: risk is registry metadata (I-4).
- To design approval or permit behaviour (see `confirmation-binding`, `execution-authority-design`).

## Prerequisites
- The operation's real semantics written by its owner, including whether the change is one-way (R-39).
- A read path that reflects the effect (A-2); if none exists, the operation is unverifiable (H-4).
- `config/harness.config.json` exposure domains and `policy.grantedPermissions` known; `sops/capability_onboarding.md` open.

## Inputs
- Operation description with argument names, types, bounds, and required/optional status.
- Side effects as state transitions, e.g. `invoice.state: DRAFT->ISSUED`.
- The verifier's read operation with the facts it must assert, and the intended adapter binding (mock operation or HTTP method/path).

## Procedure
1. Name the capability `domain.verb` — a business intent, never a route fragment or version (R-23): `invoice.issue`, not `invoices.post`.
2. Write the description stating semantics and direction; registration rejects descriptions under 20 characters.
3. Write `inputSchema` inside the portable subset (`type`/`object`/`properties`/`required`/`array`/`items`/`enum` plus `pattern`, numeric bounds, `nonPlaceholder`); set `additionalProperties:false` and list every required field (R-16, R-02).
4. Hold the complexity budget: depth ≤ 6, ≤ 24 properties, ≤ 32 enum values; `$ref`, `allOf`, `not`, `if/then/else`, `dependentSchemas` are rejected by design (R-16).
5. Assign `risk` from the operation's effect only: READ, DRAFT (drafts only), MUTATION (creates/updates state), FINANCIAL (money movement or a one-way posting); set `requiresConfirmation:true` for FINANCIAL (SAH-REQ-013).
6. Set `requiredPermissions` to strings already present in `policy.grantedPermissions`; a permission that cannot be granted is a registration error, not a demo obstacle.
7. Name a `verifier` that reads authoritative domain state directly and never calls the adapter's write path or trusts its success flag (DM-14, H-6); it asserts concrete facts (identifier exists, state equals target).
8. Bind the adapter in trusted configuration: `{kind:"mock", operation:"…"}` or `{kind:"http"}` plus `adapters.http.bindings["<capabilityId>"] = {method, path}`; no URL, host, path, or method may come from model output (I-8, R-30, T-09).
9. Add `tags` for the deterministic selector (exposure is domain filter, then keyword tags, then the `exposure.maxCapabilities` cap, with no ranking model) (DM-10, R-22), and declare `sideEffects` and reversibility, since accounting-style corrections are reversing entries, not deletes (R-39).
10. Register through the validated path and prove the rejection cases (missing verifier/permission/adapter, unknown key, non-enum risk, unsupported keyword, depth > 6, > 24 properties, > 32 enums) (I-10, F-25); then add a benchmark case for selection and argument validity before exposure (R-40, R-41).

## Audit procedure
1. Dump the registry; check each row for id shape `domain.verb`, enum risk, `requiresConfirmation` on every FINANCIAL row, a registered verifier id, and a resolvable adapter binding.
2. For each capability, list the arguments the model can supply and confirm all are validated with `additionalProperties:false`; reject any free string that reaches a URL, path, header, or command.
3. Confirm no id, schema, description, or tag contains a route, host, HTTP method, vendor name, or credential (I-8, SAH-REQ-047).
4. Mutation-test verification: make the adapter claim success without changing state; the verifier must report VERIFICATION_FAILED (F-22, A-3); a verifier that passes is a defect.
5. Check one realistic workflow's exposure: ≤ `exposure.maxCapabilities`, only registered ids, every capability the workflow needs, and reproducible with no model, embedding, network, or clock input (M-5, DM-10); record each audit finding with a fix or a `DM-NN` row, since nothing stays "known but unrecorded".

## Decision points
| Condition | Action |
|---|---|
| Operation moves money or performs a one-way posting | risk FINANCIAL, `requiresConfirmation:true`; no config switch silences this quietly |
| No read-back exists for a mutation | Declare unverifiable; do not expose it with a stub verifier; record an integration blocker (H-4) |
| Two routes implement one business intent | One capability, one binding; the other route is a migration concern (R-23) |
| Operation needs more than 24 fields | Decompose by sub-intent; transport noise is not a capability argument (R-16) |
| Argument is a business identifier | Validate with `pattern` and `nonPlaceholder`; existence is a domain error at execution, not schema validity (R-20) |
| Request would need a computed amount or total | Refuse: the domain owns arithmetic (SAH-REQ-030); accept an id or domain-owned reference only |

## Failure conditions
- Registration accepts a capability without a verifier, permission, adapter, or risk (I-10), or a schema uses a rejected keyword or exceeds the budget.
- The verifier reads through the adapter, or is a function that returns `true`.
- `nonPlaceholder` is missing on identifier fields, so `"INV-XXXX"` validates (F-09, R-20).
- Risk was lowered to make a proposal pass policy, or the capability id/tags expose the transport surface.

## Stop conditions
- The effect cannot be described as observable state — there is nothing to verify.
- Risk cannot be classified unambiguously from the operation's effect.
- Transaction semantics are unknown AND no read-back exists (A-5, H-8).
- The required permission does not exist in config, or onboarding would require the model to supply a target (URL, path, host, command) (I-8).

## Security considerations
- Authority is fixed in trusted configuration; the model names a pre-registered handle only, which is the confused-deputy control (R-30, DM-01).
- Least privilege, concretely: one permission string per capability; policy reads registry metadata, never the proposal (I-4); the exposed set is narrower than the registry (T-03).
- Fail-closed at build time: no verifier, permission, or adapter means no capability (I-10).
- `adapters.http` is disabled by default; enabling it is a reviewed config change with a base URL and explicit bindings (T-09, T-18); never place credentials or real customer identifiers in schemas, tags, or fixtures (T-13).

## Verification
- Registration rejections: `tests/registry.test.mjs` (unsupported keyword, short description, caps, missing verifier); argument validation: `tests/proposal.test.mjs` (unknown field, placeholder, bounds) and `tests/security.test.mjs` (unexposed capability, `risk` field rejected).
- Verification: `tests/verification.test.mjs` (lying adapter) and `tests/acceptance.test.mjs` (8-id pack end to end).
- Exposure cap and determinism asserted in `tests/registry.test.mjs` (SAH-REQ-031/032), and lint in `scripts/lint.mjs` forbidden-capability and forbidden-name scans (SAH-REQ-046/047).

## Expected outputs
- A registry entry: id, description, domain, risk, inputSchema, requiredPermissions, requiresConfirmation, sideEffects, adapter, verifier, tags.
- A verifier that asserts domain facts through a read path, plus a trusted adapter binding (mock operation or HTTP method and path in config).
- One benchmark case and one rejection test proving the declaration is enforced.

## Dependencies
- `src/registry/capability.mjs`, `src/registry/registry.mjs`, `src/core/schema.mjs`, `src/policy/risk.mjs`
- `src/evidence/verifier.mjs`, `src/adapters/*`, `config/harness.config.json`, `sops/capability_onboarding.md`

## References
- R-16 (OpenAI Structured Outputs) — portable strict-schema subset and complexity caps; R-20 (Berkeley Function-Calling Leaderboard) — hallucinated parameters, placeholders, wrong precision.
- R-22 (OpenAI function-calling guide), R-23 (Anthropic "Define tools") — few, consolidated, well-described tools.
- R-26 (OWASP LLM06:2025 Excessive Agency), R-30 (Hardy, "The Confused Deputy") — downstream authorization, pre-registered handles.
- R-36 (NIST SP 800-92; SP 800-53 AU-2/AU-9) and R-39 (Microsoft Learn: reversing entry) — auditability and posting semantics; R-41 (BFCL v3) — state checks and response checks both required for a pass.

## Examples
Reducing `POST /api/v2/invoices/{id}/post` to `invoice.issue`:
- Capability (trusted config): `{"id":"invoice.issue","domain":"accounting.invoices","risk":"FINANCIAL","requiresConfirmation":true,"inputSchema":{"type":"object","additionalProperties":false,"required":["invoiceId"],"properties":{"invoiceId":{"type":"string","pattern":"^INV-[0-9]{4}$","nonPlaceholder":true}}},"requiredPermissions":["accounting.financial"],"sideEffects":["invoice.state: DRAFT->ISSUED"],"adapter":{"kind":"http"},"verifier":"invoice.issued","tags":["invoice","issue","post","finalize"]}`.
- Binding (trusted config, never sent to the model): `adapters.http.bindings["invoice.issue"] = {"method":"POST","path":"/api/v2/invoices/{invoiceId}/post"}`, with the base URL validated at config load.
- Verifier `invoice.issued` re-reads the invoice and fails unless `state === "ISSUED"` with an issuing timestamp present; an HTTP 200 is not evidence (DM-14). The model sees `invoice.issue` and `invoiceId`, never the route.
- Audit outcome for the lazy variant `invoices.post` with a free-string `path` argument: fails Audit steps 2 and 3 and must not be registered.

## Anti-patterns
- Exposing all ~400 routes, or ingesting the collaborator's OpenAPI into runtime-generated tools (DM-01 rejects both).
- A capability id that is a route path, or a description that omits the direction of the state change.
- A verifier that echoes `ok:true`, or that checks only that the adapter was called.
- Accepting a URL, path, method, or shell string as an argument (I-8), lowering risk to make a demo flow, or registering an unverifiable mutation with a stub verifier and calling the result verified (H-4).
