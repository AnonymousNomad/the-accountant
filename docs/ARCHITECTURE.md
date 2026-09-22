# Architecture — Sovereign Action Harness v0.1

Status: PHASE 3 proposal, amended by the PHASE 4 Design Critic Gate
(`docs/reviews/DESIGN_CRITIC.md`). Implementation must match this document; where it does not,
the discrepancy is a defect in one of them.

---

## 1. What this system is

A local-first execution harness that lets a language model *propose* actions against an
application while a deterministic harness owns **authority**, **execution**, and **verification**.

The model is a reasoning component. It is never the authority.

```
User
  │  natural language
  ▼
Provider boundary (Ollama / llama-server / scripted)   src/models/*
  │  untrusted text
  ▼
Response parser: exactly one JSON envelope             src/models/response-parser.mjs
  │  untrusted structured object
  ▼
Proposal validation (envelope + capability schema)     src/core/schema.mjs, src/harness.mjs
  │  validated proposal (still only a request)
  ▼
Policy engine  ── DENY / CONFIRMATION_REQUIRED / ALLOW src/policy/policy-engine.mjs
  │  (CONFIRMATION_REQUIRED: user approves an immutable snapshot; may resume)
  ▼
Authority: one-use permit bound to the proposal hash   src/policy/authority.mjs
  │  permit (consumed atomically)
  ▼
Capability adapter (mock / config-gated HTTP)          src/adapters/*
  │  execution result (a claim)
  ▼
Independent verifier re-reads domain state             src/evidence/verifier.mjs
  │  verified fact
  ▼
Result + append-only hash-chained evidence             src/harness.mjs, src/evidence/journal.mjs
```

## 2. Module map

| Module | Owns | Must never do |
|---|---|---|
| `src/core/config.mjs` | Loading and strict validation of trusted configuration; loopback enforcement | Substitute defaults silently on invalid config |
| `src/core/schema.mjs` | A bounded, tested validator (types, enum, bounds, patterns, `additionalProperties:false`, `nonPlaceholder`) | Execute anything, resolve `$ref`, or ignore unknown schema keywords |
| `src/core/canonical.mjs` | `canonical-action-json-v1` hashing (sorted keys, no insignificant whitespace, SHA-256 lowercase hex) | Depend on object key insertion order |
| `src/core/util.mjs` | Clock, id generation, deep-freeze | Use wall-clock time inside deterministic domain logic |
| `src/core/errors.mjs` | Typed error taxonomy and failure codes | Convert a failure into a success value |
| `src/models/provider.mjs` | The provider interface and selection | Know about capabilities, policy, or adapters |
| `src/models/ollama-provider.mjs` | HTTP contract with a local Ollama server; typed error mapping; `format` schema; no credentials | Send secrets; assume output validity; retry silently |
| `src/models/scripted-provider.mjs` | Deterministic fixture replay for tests, CI, and the scripted demo | Pretend to be a model; bypass the pipeline |
| `src/models/llama-server-provider.mjs` | Spawn/health/model-id/infer/stop for a local llama.cpp engine; schema-constrained output; loopback only, no shell, no retry; kills only the process it started | Accept a non-loopback host; outlive its engine; convert a failure into a value |
| `src/models/prompt.mjs` | System prompt: SOP first, exposed capability catalogue, envelope format | Expose capabilities that are not selected for this turn |
| `src/models/response-parser.mjs` | Deterministic extraction of exactly one JSON envelope | Repair, guess, or accept prose-prefixed JSON |
| `src/registry/capability.mjs` | Capability definition schema, schema-complexity budget, registration-time validation | Accept a capability without a verifier, permission, or risk class |
| `src/registry/registry.mjs` | Registry lookup + deterministic exposure selection (domain, keywords, cap) | Rank by anything non-deterministic |
| `src/policy/risk.mjs` | Risk classes and the trusted-metadata rule | Read risk from a proposal |
| `src/policy/policy-engine.mjs` | Decision: `ALLOW` / `CONFIRMATION_REQUIRED` / `DENY` with a typed reason; fail closed on internal error | Throw without denying; consult the model |
| `src/policy/authority.mjs` | Permit issuance and atomic consumption; binding; expiry; sweep | Issue without `ALLOW`; allow reuse |
| `src/policy/confirmations.mjs` | Pending approvals bound to a frozen proposal, turn, TTL, single-use | Resolve an ambiguous, stale, or mismatched confirmation |
| `src/adapters/mock-accounting-adapter.mjs` | Dispatching validated arguments to synthetic domain operations | Compute accounting outcomes outside the domain store |
| `src/adapters/generic-http-adapter.mjs` | Config-bound HTTP execution with timeouts, no redirects, no credentials in code | Accept a URL/path/method from model output |
| `src/evidence/journal.mjs` | Append-only JSONL, sequence numbers, hash chain, redaction, chain verification | Write unredacted secrets; allow rewriting |
| `src/evidence/verifier.mjs` | Executing a capability's registered verifier and normalising its checks | Treat a missing verifier as success |
| `src/domain/synthetic-accounting/*` | Deterministic synthetic state, the 8 capabilities, their verifiers | Touch real accounting, tax, payroll, banking, or regulatory logic |
| `src/harness.mjs` | Orchestration, session state, closed status set, evidence emission | Execute anything without policy + permit; invent a status |
| `src/cli.mjs` | Operator interface, transcript rendering, `:commands` | Hold authority of its own |
| `src/bootstrap.mjs` | Composition root: config → domain → registry → adapters → provider → harness | Hide a failure to construct a component |

## 3. Contracts

### 3.1 Proposal envelope (model → harness), `additionalProperties: false`

```json
{
  "kind": "proposal",
  "proposalId": "p-1a2b3c",
  "capability": "customer.create",
  "arguments": { "name": "Acme Electrical", "email": "ops@acme.example" },
  "reasoningSummary": "User asked to create the customer Acme Electrical."
}
```

```json
{ "kind": "clarification", "question": "Which customer should the invoice be issued to?", "reasoningSummary": "…" }
{ "kind": "unsupported",   "reason": "No registered capability can transfer funds.",           "reasoningSummary": "…" }
```

Rules: exactly one JSON object; `proposalId` is optional and, when supplied, a string of at most 64
characters — the harness normalizes it and derives the audit identity from the canonical proposal hash
(a small model should not have to invent a perfect unique id before its reasoning is considered);
`reasoningSummary` is 1–500 characters; a `risk` field is **never** accepted (unknown fields are
rejected). Placeholder strings are rejected where a field declares `nonPlaceholder`.

### 3.2 Capability definition (trusted configuration)

```json
{
  "id": "invoice.issue",
  "version": 1,
  "description": "Issue a previously created draft invoice. One-way transition from DRAFT to ISSUED.",
  "domain": "accounting.invoices",
  "risk": "FINANCIAL",
  "enabled": true,
  "idempotency": "non_idempotent",
  "sensitivity": "high",
  "inputSchema": { "type": "object", "additionalProperties": false, "required": ["invoiceId"], "properties": { "invoiceId": { "type": "string", "pattern": "^INV-[0-9]{4}$", "nonPlaceholder": true } } },
  "requiredPermissions": ["accounting.financial"],
  "requiresConfirmation": true,
  "sideEffects": ["invoice state: DRAFT->ISSUED"],
  "prerequisites": { "descriptions": ["at least one draft invoice must exist"], "checks": ["invoice.has_draft"] },
  "relatedCapabilities": ["invoice.preview", "invoice.create_draft", "ledger.query"],
  "tags": ["invoice", "issue", "post", "finalize"],
  "adapter": { "kind": "mock", "operation": "invoice.issue" },
  "verifier": "invoice.issued"
}
```

Registration rejects: unknown keys, non-enum risk, a `FINANCIAL`/`MUTATION` capability claiming
`naturally_idempotent`, missing verifier/permission/adapter, a description shorter than 20
characters, an unsupported schema keyword, schema depth > 6, more than 24 properties, or an enum
with more than 32 values (complexity budget, R-16/R-22).

`enabled: false` removes a capability from the exposure set, denies it at policy time, and is
re-checked immediately before execution, so a capability revoked after a proposal was built
cannot execute. `idempotency` is recorded metadata only: v0.1 never retries, and
`COMMIT_UNKNOWN` exists precisely because retry safety cannot be inferred from an HTTP method.
Descriptions must not name other capabilities in prose; cross-references belong in
`relatedCapabilities`, which is filtered to the exposed set before rendering.

### 3.3 Permit (authority artifact)

```json
{
  "permitId": "permit-…",
  "nonce": "<32 hex chars>",
  "runId": "run-…",
  "actorId": "operator-local",
  "workspaceId": "synthetic-default",
  "capability": "invoice.issue",
  "capabilityVersion": 1,
  "capabilitySnapshotId": "ctx-…",
  "proposalHash": "<sha256 canonical-action-json-v1 of {capability, arguments}>",
  "argumentHash": "<sha256 canonical-action-json-v1 of {arguments}>",
  "risk": "FINANCIAL",
  "confirmationId": "conf-…",
  "issuedAt": "2026-09-21T12:00:00.000Z",
  "expiresAt": "2026-09-21T12:01:00.000Z",
  "state": "ACTIVE"
}
```

`consume({permitId, runId, actorId, workspaceId, capability, capabilityVersion, capabilitySnapshotId, proposalHash, argumentHash})`
refuses, with a typed code, when the permit is missing, expired, already consumed, or when any
binding does not match — including actor substitution, workspace substitution, capability-version
substitution and snapshot mismatch. Consumption is synchronous and immediately precedes execution
(no `await` between them), which is the TOCTOU mitigation (R-33).

### 3.4 Evidence event

```json
{
  "seq": 12,
  "at": "2026-09-21T12:00:00.000Z",
  "type": "AUTHORIZED",
  "sessionId": "sess-…",
  "runId": "run-…",
  "proposalId": "p-1a2b3c",
  "proposalHash": "…",
  "capability": "invoice.issue",
  "risk": "FINANCIAL",
  "permitId": "permit-…",
  "data": { "…redacted, event-specific…" },
  "prevHash": "…",
  "hash": "…"
}
```

Event set (minimum required by the directive in bold): **PROPOSED**, **DENIED**, **AUTHORIZED**,
**EXECUTION_STARTED**, **EXECUTION_SUCCEEDED**, **EXECUTION_FAILED**, **COMMIT_UNKNOWN**,
**VERIFIED**, **VERIFICATION_FAILED**, plus `USER_INSTRUCTION`, `CAPABILITIES_EXPOSED`,
`PROPOSAL_REJECTED`, `CLARIFICATION_REQUESTED`, `UNSUPPORTED_REQUEST`, `CONFIRMATION_REQUIRED`,
`CONFIRMATION_GRANTED`, `CONFIRMATION_REJECTED`, `AUTHORITY_CONSUMED`, `POLICY_DECISION`,
`PROVIDER_ERROR`, `SESSION_CLOSED`.

Evidence is privacy-minimal. A successful execution records a typed tool result
(`capabilityId`, `ids`, `count`, `digest`, one bounded `summary` line) rather than the adapter's
payload; the full payload exists only in the in-memory result the operator sees. Redaction runs
on every string field before hashing, and the header file used by the HTTP adapter is never
journaled at all. The journal is hash-chained, which makes it **tamper-evident**, not
tamper-proof: a privileged local attacker who rewrites the entire chain from scratch cannot be
detected without an external anchor (recorded as residual risk).

### 3.5 Result status — the closed set

| Status | Meaning | Terminal |
|---|---|---|
| `EXECUTED_VERIFIED` | Executed **and** independently verified | yes |
| `CLARIFICATION_REQUIRED` | The model needs information; nothing executed | yes |
| `UNSUPPORTED` | No registered capability can perform the request; nothing executed | yes |
| `CONFIRMATION_REQUIRED` | FINANCIAL (or capability-level) approval pending | yes (resumes via `confirm`) |
| `CONFIRMATION_REJECTED` | An answer did not match a live confirmation; nothing executed | yes |
| `DENIED` | Policy or authority refused; no permit issued, or consumption refused | yes |
| `REJECTED` | The proposal was invalid or malformed; nothing executed | yes |
| `EXECUTION_FAILED` | The adapter failed with a definite, non-committing failure | yes |
| `VERIFICATION_FAILED` | Execution may have occurred but verification failed — **reported as failure** | yes |
| `COMMIT_UNKNOWN` | A consequential request may or may not have reached the application; transport certainty was lost. Never retried, never reported as success or failure | yes (reconciliation required) |
| `PROVIDER_ERROR` | The model runtime was unavailable or malformed | yes |
| `EVIDENCE_ERROR` | Evidence could not be written, so the action was not allowed to proceed | yes |

Only `EXECUTED_VERIFIED` may be described as success. `VERIFICATION_FAILED` and `COMMIT_UNKNOWN`
are never rendered as success, and neither is retried automatically.

### 3.6 Execution state machine (equivalent names)

The directive names an explicit state machine; the implementation expresses the same states as
the closed status set plus its evidence events. The mapping is exact and is asserted by tests:

| Directive state | Implementation |
|---|---|
| RECEIVED | `USER_INSTRUCTION` event |
| CONTEXT_BOUND | `CAPABILITIES_EXPOSED` event, which carries `snapshotId`, `actorId`, `workspaceId`, `createdAt`, capability ids + versions, registry hash, config hash, SOP hash, base-contract hash and the context budget |
| CAPABILITIES_SELECTED | the exposed ids inside `CAPABILITIES_EXPOSED`; every filtered capability is recorded with its reason |
| PROPOSED | `PROPOSED` event (validated proposal + canonical hash) |
| VALIDATED | the validation step immediately before `PROPOSED`; failures emit `PROPOSAL_REJECTED` and status `REJECTED` |
| CLARIFICATION_REQUIRED / DENIED / REJECTED | same-named statuses |
| AUTHORITY_REQUIRED | status `CONFIRMATION_REQUIRED` + `CONFIRMATION_REQUIRED` event |
| AUTHORIZED | `AUTHORIZED` event (permit issued, bound to the snapshot and argument hash) |
| EXECUTION_STARTED | `EXECUTION_STARTED` event |
| EXECUTION_FAILED | `EXECUTION_FAILED` event + status |
| EXECUTED_UNVERIFIED | `EXECUTION_SUCCEEDED` event, before the verifier runs |
| VERIFIED / VERIFICATION_FAILED | same-named events and statuses |
| COMMIT_UNKNOWN | `COMMIT_UNKNOWN` event + status, with `commitState: "UNKNOWN"` and a recorded `nextStep` |

## 4. Invariants (each has a test)

| # | Invariant |
|---|---|
| I-1 | No adapter is invoked unless a permit was consumed for the exact same `proposalHash` in the same run. |
| I-2 | A permit is consumed at most once, and consumption is atomic within the event loop turn. |
| I-3 | The object executed after confirmation is byte-identical (canonical hash equal) to the object shown at confirmation time; it is deep-frozen and never re-parsed. |
| I-4 | Risk and permissions are read only from registry metadata; a proposal containing any of those fields is rejected. |
| I-5 | Every terminal status is explained by the journal: for each `runId`, the last lifecycle event matches the status. |
| I-6 | `EXECUTED_VERIFIED` is reachable only via `VERIFIED`; `VERIFICATION_FAILED` is reachable only via a failed verifier result. |
| I-7 | The journal is append-only and hash-chained; a modified record breaks verification at its sequence number. |
| I-8 | No URL, method, host, path, shell command, or process name can enter execution from model output. |
| I-9 | Configuration is validated before the harness is constructed; an invalid config prevents startup. |
| I-10 | A missing verifier, adapter, or permission prevents capability registration (fail at build time, not at run time). |

## 5. Trust boundaries

1. **Model output → parser:** untrusted text; the parser is a boundary, not a convenience.
2. **Parsed proposal → validator:** untrusted structure; validated against trusted metadata.
3. **Validator → policy:** the proposal is a request; policy consults only trusted state.
4. **Policy → authority:** `ALLOW` produces a permit; nothing else does.
5. **Permit → adapter:** the adapter receives validated arguments and a binding from trusted
   config; it receives no authority of its own.
6. **Adapter response → verifier:** the response is a claim; the verifier reads authoritative
   domain state instead.
7. **Verifier → result:** only a passed verification may produce `EXECUTED_VERIFIED`.
8. **Harness → journal:** append-only, redacted, hash-chained, outside model reach.
9. **Config → everything:** configuration is a trusted input; it is reviewed like code
   (documented in `docs/THREAT_MODEL.md`, T-18).
10. **Any component → model:** the model receives no credentials, no internal routes, and no
    authority; it receives capability descriptions and the user's request.

## 6. Session model

- One process, one session id, one operator, one provider.
- A session holds: run counter, proposal-id set (replay guard), pending confirmations, active
  permits, the synthetic store.
- Restart discards all authority (permits are in-memory) — fail closed.
- Every user instruction gets a fresh `runId`; the instruction text itself is journaled.

## 7. Configuration surface (v0.1)

`config/harness.config.json` — strictly validated, unknown keys rejected:

```json
{
  "provider": { "kind": "ollama", "baseUrl": "http://127.0.0.1:11434", "model": "REPLACE_WITH_YOUR_MODEL", "timeoutMs": 30000, "numCtx": 8192, "keepAlive": "5m", "seed": 7, "temperature": 0, "allowNonLocalProvider": false },
  "policy": { "riskAllowlist": ["READ", "DRAFT", "MUTATION", "FINANCIAL"], "requireConfirmationFor": ["FINANCIAL"], "grantedPermissions": ["accounting.read", "accounting.write", "accounting.financial"] },
  "confirmation": { "ttlSeconds": 120 },
  "authority": { "permitTtlSeconds": 60 },
  "exposure": { "maxCapabilities": 12, "domains": ["accounting.customers", "accounting.invoices", "accounting.ledger"] },
  "adapters": { "mock": { "enabled": true }, "http": { "enabled": false, "baseUrl": "", "bindings": {}, "headersFile": null, "timeoutMs": 10000 } },
  "evidence": { "dir": "var/evidence", "redactKeys": ["password", "secret", "token", "key", "credential", "authorization"] }
}
```

Hard rule: `adapters.http.enabled` defaults to `false` and its `baseUrl` must be a valid URL when
enabled; bindings are `{ "<capabilityId>": { "method": "POST", "path": "/…" } }` and a capability
whose binding is absent is denied by policy.

## 8. Why these boundaries exist (the questions a collaborator will ask)

**Why not expose all ~400 routes?** Tool-selection accuracy degrades with tool count (R-22,
R-23), and each exposed route becomes an unaudited authority path (R-30). Exposure is a
deliberate, reviewable act.

**Why isn't the model runtime responsible for discovering the API?** Because authorization must
be decided by a component that cannot be argued with (R-26, R-29). Discovery produces tools
whose risk nobody classified.

**Why separate proposal from execution?** So that intent can be validated, risked, confirmed, and
recorded before anything changes state — and so the executor never has to trust the proposer
(R-29, R-30).

**Why is confirmation bound to a proposal?** So that "yes" applies to exactly the arguments that
will execute, at the moment it was given (T-08; DM-05, DM-13).

**Why verify after execution?** Because execution success is a claim, and the harness's job is to
produce facts (R-41; DM-14).

**Why is risk never taken from the model?** Because a model can be induced to describe an action
as harmless (R-26, R-27). Risk is a property of the operation, fixed in code, reviewed by a human.
