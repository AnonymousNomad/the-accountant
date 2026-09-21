# Integration Contract — Sovereign Action Harness v0.1

What this document is: the checklist the owner of an existing application answers so that one
of its operations can be mapped onto this harness as a semantic capability. It is written to
be answered without reading this repository's source. Nothing here is a claim about the
collaborator's system; every unknown is marked UNKNOWN.

## Epistemic status

| Label | Meaning |
|---|---|
| OBSERVED | Directly seen in this repository or on this machine |
| REPORTED BY COLLABORATOR | Stated by the collaborator or relayed by the operator; not verified |
| INFERRED | A conclusion drawn from reported facts; not verified |
| UNKNOWN | No information; must be asked for |
| VERIFIED | Proven with recorded evidence in `COLLABORATOR_AGENT_NOTES.md` |
| REJECTED | Considered and set aside with a recorded reason |

Current state for the collaborator's system:

| Claim | Label |
|---|---|
| approximately 400 HTTP routes | REPORTED BY COLLABORATOR |
| AES-256-GCM is used somewhere in the system | REPORTED BY COLLABORATOR |
| four tax regions are supported | REPORTED BY COLLABORATOR |
| route architecture, service boundaries, auth model, database design, transaction semantics, key custody, audit behaviour, idempotency behaviour | UNKNOWN |

These three REPORTED claims are neither certified nor challenged here. They require
architectural inspection before any of them can influence design; a REPORTED claim is never
promoted to VERIFIED without evidence recorded in `COLLABORATOR_AGENT_NOTES.md`.

## What we will need from you, per operation

One row per candidate operation. Every value in the illustrative rows is a placeholder; the
real route, schema and permission values must come from the collaborator and are deliberately
left unfilled. The illustrative rows show the shape of an answer only and are NEVER SENT TO
THE MODEL: model-facing descriptors exclude routes, methods, hosts and all transport detail.

| Semantic operation | Existing service or route | HTTP method | Request schema | Response schema | Permission required | Side effects | Transaction semantics | Verification method | Risk class |
|---|---|---|---|---|---|---|---|---|---|
| ILLUSTRATIVE ONLY, NEVER SENT TO THE MODEL: issue a draft invoice | `POST /<your route>` (placeholder) | `POST` (placeholder) | `{ "<your id field>": "<placeholder>" }` | `{ "<your id field>": "<placeholder>", "<your status field>": "<placeholder>" }` | `<your permission string>` (placeholder) | `<draft state>` to `<issued state>`, one-way | UNKNOWN until answered (atomic, partial, compensating) | re-read the invoice via `<your read-back route>` and assert the target state | FINANCIAL (proposed; fixed by a human, never by the model) |
| ILLUSTRATIVE ONLY, NEVER SENT TO THE MODEL: create a customer record | `POST /<your route>` (placeholder) | `POST` (placeholder) | `{ "<your name field>": "<placeholder>" }` | `{ "<your id field>": "<placeholder>" }` | `<your permission string>` (placeholder) | a new customer record exists | UNKNOWN until answered | re-read the customer via `<your read-back route>` | DRAFT (proposed) |
| ILLUSTRATIVE ONLY, NEVER SENT TO THE MODEL: list customers matching a filter | `GET /<your route>` (placeholder) | `GET` (placeholder) | `{ "<your filter field>": "<placeholder>" }` | `{ "<your collection field>": [] }` | `<your permission string>` (placeholder) | none (read-only) | not applicable | compare the returned records against a direct re-read | READ (proposed) |

## Mapping rules

1. One business intent per capability. One route maps to at most one capability; two routes
   that implement one intent are consolidated into one capability, and the duplicate route is
   a migration concern, not a second tool.
2. Name the capability semantically, not after the route. Use `domain.verb` (`invoice.issue`),
   never a route fragment or version (`invoices.post`). A capability description states what
   the operation does and the direction of the change; it must never name another capability
   in prose. Cross-references belong in `relatedCapabilities`, which is validated at registry
   seal and filtered to the exposed set before the model ever sees it.
3. Define a strict argument schema with `additionalProperties: false`. List every required
   field, use patterns, enums and numeric bounds, and mark identifier fields `nonPlaceholder`.
   Stay inside the supported keyword subset and the complexity budget (depth 6, 24 properties,
   32 enum values).
4. Declare the side effects as concrete state transitions, for example
   `<draft state>` to `<issued state>`, and state what is not changed.
5. Fix the risk class by human decision, from the operation's semantics only — READ, DRAFT,
   MUTATION, or FINANCIAL (money movement or a one-way posting). It is never read from the
   model, the route path, or a convenience default. FINANCIAL always requires confirmation.
6. Require a verifier that re-reads state. The verifier must read authoritative state through
   an explicit read path, never the adapter's own report or success flag. An operation with no
   read-back cannot be registered: the harness refuses to start if a capability's verifier is
   not registered, so such an operation stays unregistered rather than shipping with a stub.
7. Require a permission the application actually enforces. Use the least set the operation
   genuinely needs, and only permission strings that exist in trusted configuration; a
   permission that cannot be granted is a registration error, not a demo obstacle.

## What we will provide

Per capability:

- A trusted record: the validated capability definition (id, version, description, whenToUse,
  whenNotToUse, domain, risk, inputSchema, outputSummary, requiredPermissions,
  requiresConfirmation, sideEffects, prerequisites, relatedCapabilities, tags, adapter,
  verifier, enabled, idempotency, sensitivity, definitionHash). Registration rejects unknown
  keys, a missing verifier, permission or adapter, a non-enum risk, a short description, and
  schemas outside the complexity budget.
- A model-safe descriptor: what the model is told (id, domain, description, usage guidance,
  argument names and constraints, output summary, side effects, risk, confirmation
  requirement, permissions, prerequisites, related references filtered to the exposed set,
  retry safety, version, definition hash). It never contains the route, method, host, headers,
  or adapter operation.
- A proposal schema: the strict envelope (kind `proposal` with `capability`, `arguments` and
  `reasoningSummary`; kind `clarification` with `question`; kind `unsupported` with `reason`);
  exactly one JSON object; unknown fields rejected; a risk or permission field is never accepted.
- Policy and permit gating: `ALLOW`, `CONFIRMATION_REQUIRED`, or `DENY`, with a typed reason
  and fail-closed handling of internal errors. `ALLOW` issues a one-use permit bound to the
  run, actor, workspace, capability plus version and snapshot, risk, proposal hash and
  argument hash, consumed synchronously immediately before execution.
- Evidence: an append-only, hash-chained, redacted journal with the lifecycle events, the
  frozen proposal hash, the policy decision, the execution outcome, and the verification
  checks.
- A verifier: a registered function that re-reads authoritative state and returns per-check
  pass or fail; a missing, empty or throwing verifier is a failed verification, never a pass.

Plus the onboarding procedure (`sops/engineering/capability_onboarding.md`, with a worked
example) and the adapter package boundary: the generic HTTP adapter is disabled by default,
its method, path, expected status and required response fields come from trusted
configuration, and the model can never supply a URL, method, host or header.

## Where the adapter lives

- Option A: `integrations/<collaborator>/` inside this repository, if the collaborator's IP
  boundaries allow his routes, schemas and product details to be committed here. (This
  repository currently contains no `integrations/` directory; it would be created only under
  this option.)
- Option B: a private adapter package in the collaborator's own repository, consuming these
  interfaces: the capability definition format, the config binding format, the verifier
  interface, and the journal format. `sops/engineering/collaborator_handoff.md` currently
  records Option B as the working decision for the first integration, because a real adapter
  carries proprietary routes, product names and credentials.
- The choice depends on his IP boundary and is his to make, not ours. It is recorded here as
  an open decision.

## Integration requirements we cannot satisfy alone

- A read-back endpoint for each mutation. Without one, verification would degrade to trusting
  the adapter's report, which this harness refuses, and the capability can never reach
  `EXECUTED_VERIFIED`.
- Confirmation of whether mutating endpoints accept an idempotency key, and what the
  application does on a repeated identical request.
- Transaction semantics for partial failure: which mutations are atomic, which can partially
  commit, and what compensating action exists.
- Per-endpoint permission requirements: the exact permission or attribute the application
  enforces, and whether it can be granted to this operator.
- Who holds credentials. The harness never puts secrets in source; adapter headers come from
  the gitignored file referenced by `adapters.http.headersFile` (`.gitignore` covers
  `config/http-headers.local.json` and `var/`), are loaded at startup, and are never journaled.
- Error and status semantics for mutating routes: what a 4xx, a 5xx, and an ambiguous 2xx mean
  for commit certainty.

## Onboarding path

1. Inventory operations (routes, methods, owners, one sentence of intent each).
2. Group them by business intent; consolidate duplicates and drop anything outside the pilot.
3. Classify each intent's risk by semantics (READ, DRAFT, MUTATION, FINANCIAL).
4. Define strict schemas for the selected capabilities.
5. Map adapter bindings in trusted configuration (method, path, expected status, required
   response fields).
6. Write verifiers that re-read authoritative state.
7. Register the capabilities; registration fails loudly on anything missing or over-complex.
8. Run the benchmark for selection accuracy and argument validity.
9. Review the evidence: the verification run, the journal, and the chain check.

## Questions for you

1. Does every candidate mutation have a read-back endpoint that reflects the effect? Which
   one, and what does it return after the mutation?
2. Do your mutating endpoints accept an idempotency key? If not, what happens on a repeated
   identical request?
3. What are the transaction semantics of each candidate mutation (atomic, partial, unknown),
   and what compensating action exists after a partial commit?
4. What permission model does the application actually enforce, and can the harness operate
   with a least-privilege permission set?
5. Is the system single-user or multi-user for the first integration, and does it require
   per-user permission mapping and per-user credentials?
6. What confirmation experience is acceptable for FINANCIAL operations (terminal prompt, GUI
   dialog, external approval), and what TTL is workable for a human operator?
7. Which single workflow should be the pilot, and can it be expressed in at most about twelve
   capabilities?
8. What local model runtime will you run (Ollama or equivalent), on which machine, and what
   model family and size? The exposed capability count depends on its context and reliability
   budget.
9. How do the candidate operations report errors and status codes, and what does a 2xx with an
   unexpected body mean for commit certainty?
10. Are there rate limits, timeouts or concurrency constraints the harness must respect?
