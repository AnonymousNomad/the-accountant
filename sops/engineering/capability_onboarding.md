# Capability Onboarding — From an Internal Operation to a Registered Semantic Capability

## Objective
Convert exactly one internal operation into one registered semantic capability with a strict schema, a risk
class, a permission, a trusted adapter binding, a verifier, tests, and benchmark coverage (DM-01, R-54).

## Prerequisites
- The operation is documented by its owner (method, path, request, response, read-back) per `docs/INTEGRATION_CONTRACT.md`.
- Registration rules are known: unknown keys rejected, description >= 20 chars, verifier + permission + adapter
  required, depth <= 6, properties <= 24, enum values <= 32, supported keywords only.
- This is a reviewable change on a branch; no capability enters the registry from unreviewed metadata.

## Procedure
1. Identify the internal operation and record method, path, and owner verbatim — here `POST /api/v2/invoices/{id}/post`.
2. State the business intent in one sentence with no route names: issue a created draft invoice so it becomes final.
3. Name the capability `domain.verb` (`invoice.issue`) with a description >= 20 chars stating the effect and one-way nature.
4. Define `inputSchema` strictly: `additionalProperties:false`, required fields, exact patterns/enums/bounds,
   `nonPlaceholder:true` on free text, no keyword outside the documented subset.
5. List `sideEffects` as concrete transitions (`invoice.state: DRAFT->ISSUED`) and state what is not changed.
6. Assign the risk class from `sops/capability_risk_classification.md`, by operation semantics only — never
   from the model, the route path, or a convenience default.
7. Assign `requiredPermissions` as the least set the operation genuinely needs (`accounting.financial` here).
8. Bind an adapter in trusted config: mock `{ kind: "mock", operation: "<domain-op>" }`, plus a `bindings`
   entry for a real system while `adapters.http.enabled` stays `false` (`sops/adapter_integration.md`).
9. Name a verifier id and implement the read-back check that re-reads authoritative state — never the
   adapter's report — returning per-check pass/fail.
10. Add tests: happy path, argument rejection, policy/confirmation path, adapter failure, verifier failure,
    and a lying-adapter case proving the verifier detects a false success.
11. Register through `registerCapability` so validation runs; a rejection is a result — fix and re-run.
12. Add `benchmarks/prompts.jsonl` cases (positive selection, argument error, irrelevance) and run `npm run bench`.

Worked example — complete vertical slice for `POST /api/v2/invoices/{id}/post`:
```
operation        POST /api/v2/invoices/{id}/post       (internal reality, never exposed to the model)
business intent  issue a draft invoice so it becomes final
capability       invoice.issue   domain: accounting.invoices   tags: invoice, issue, post, finalize
arguments        invoiceId, pattern ^INV-[0-9]{4}$, nonPlaceholder
side effects     invoice.state: DRAFT->ISSUED  (no other field mutated; drafts are discarded afterwards)
risk/permission  FINANCIAL (REQ-013 requires confirmation) / accounting.financial
bindings         mock { kind: "mock", operation: "invoice.issue" }
                 http { "method": "POST", "path": "/api/v2/invoices/{invoiceId}/post" }  (trusted config only)
verifier         invoice.issued — re-reads the store: status ISSUED and issuedAt set; a failed check is
                 VERIFICATION_FAILED (F-22)
tests            happy path; bad id pattern; placeholder; missing permission; no confirmation; re-issue of
                 an issued invoice; lying adapter claiming success without a transition
benchmark        positive selection; argument error; irrelevant prompt (must not select invoice.issue)
```
Exact capability definition object (registered through `registerCapability`):
```js
export const invoiceIssue = Object.freeze({
  id: "invoice.issue",
  description: "Issue a previously created draft invoice. One-way transition from DRAFT to ISSUED.",
  domain: "accounting.invoices",
  risk: "FINANCIAL",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["invoiceId"],
    properties: { invoiceId: { type: "string", pattern: "^INV-[0-9]{4}$", nonPlaceholder: true } }
  },
  requiredPermissions: ["accounting.financial"],
  requiresConfirmation: true,
  sideEffects: ["invoice.state: DRAFT->ISSUED"],
  adapter: { kind: "mock", operation: "invoice.issue" },
  verifier: "invoice.issued",
  tags: ["invoice", "issue", "post", "finalize"]
});
```

## Gates
- G1: `inputSchema` passes registration validation (keywords, depth, property count, enum count, description length).
- G2: risk, permission, side effects, and verifier derive from the documented operation, and the derivation is written into the change.
- G3: the verifier reads state through an explicit read path, never the adapter's write path; the
  lying-adapter test exists and fails when the check is removed.
- G4: the binding is present and `adapters.http.enabled` is still `false` in the committed config.
- G5: `npm run verify` has been run and its recorded output is attached to the change.

## Expected evidence
- The capability definition, the binding delta, the verifier implementation, and the test names.
- `npm run verify` and `npm run bench` output for the full fixture, including the fixture hash.
- A `COLLABORATOR_AGENT_NOTES.md` entry naming operation, capability id, risk class, and reviewer.

## Failure conditions
- Registration rejects the definition (unknown key, complexity budget, short description): fix the
  definition; never relax the validator to fit it.
- No read-back exists: mark the capability unverifiable and stop — it can never produce `EXECUTED_VERIFIED`
  (H-4); record the blocker in `docs/INTEGRATION_CONTRACT.md`.
- The effect cannot be stated in one sentence: stop and ask the owner; do not guess the semantic.
- Two capabilities are proposed for one operation: consolidate before registering (R-23).

## Rollback / recovery
- Remove the definition and binding in one change; the registry is additive, so removal is safe.
- If already exposed and executed, keep the journal intact and record the removal with its reason.
- If a real adapter was enabled for the test, return `enabled` to `false` and re-run `npm run verify`.

## Completion criteria
- The capability is registered, deliberately exposed, risk-classified, bound, verified, tested, and covered
  by at least one benchmark prompt class.
- Nothing about the internal route is visible to the model: no path, method, host, or credential appears in
  any prompt, schema, description, or fixture.
