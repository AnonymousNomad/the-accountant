---
name: execution-authority-design
description: Designs and audits the policy-to-permit-to-consume path so that no adapter is invoked without a single-use permit bound to the exact frozen proposal hash.
---

## Purpose
Specify, implement, and review complete mediation for the harness: policy decides, authority issues one
permit for one hash, consumption is atomic, and the adapter runs only after consumption in the same
synchronous span. This is where TOCTOU, replay, and substitution are answered (R-33, R-34, T-06..T-08).

## When to use
- Adding or changing any capability's risk, permission, confirmation rule, or adapter binding.
- Reviewing `src/policy/policy-engine.mjs`, `src/policy/authority.mjs`, `src/policy/risk.mjs`.
- Investigating a `DENIED` status or a typed refuse reason.
- Changing `authority.permitTtlSeconds` or the execution block in `src/harness.mjs`.

## When NOT to use
- To decide what a capability *is* (see `semantic-capability-design`).
- To design the user's approval interaction and its turn semantics (see `confirmation-binding`).
- To score benchmark outcomes; it consumes the statuses this design emits.

## Prerequisites
- `src/policy/risk.mjs` defines READ / DRAFT / MUTATION / FINANCIAL from trusted metadata (I-4).
- `config/harness.config.json` carries `policy.riskAllowlist`, `policy.requireConfirmationFor`, `policy.grantedPermissions`, and `authority.permitTtlSeconds`.
- `canonical-action-json-v1` (R-54) is implemented and produces the hash the permit binds to; the execution block has no `await` between consume and adapter call (H-2).

## Inputs
- The deep-frozen validated proposal and its `proposalHash`, the `runId`, and a `confirmationId` when one exists.
- Registry metadata for the capability: risk, `requiredPermissions`, `requiresConfirmation`, adapter binding.
- Adapter availability from config (`adapters.mock.enabled`, `adapters.http.enabled` plus its binding) and the injectable clock for `issuedAt`/`expiresAt`.

## Procedure
1. Evaluate policy over explicit attributes only: capability id, registry risk, granted permissions, adapter enabled and bound, `requireConfirmationFor`, and whether a live confirmation exists (R-32); never read risk or permissions from the proposal (I-4).
2. Return exactly one decision — `ALLOW`, `CONFIRMATION_REQUIRED`, or `DENY` — with a typed reason (R-52); unknown or unclassifiable input is `DENY`.
3. Wrap evaluation so an internal exception becomes `DENY` with `POLICY_ERROR`; a throw must never escape as permission (F-13, R-52).
4. Journal `POLICY_DECISION`; on `DENY`, journal `DENIED` with the precise reason: `PERMISSION_NOT_GRANTED`, `RISK_NOT_AUTHORIZED`, `ADAPTER_DISABLED`, `ADAPTER_NOT_REGISTERED` (F-12, F-20).
5. On `ALLOW`, or after a matching confirmation resolves, issue exactly one permit: `{permitId, runId, capability, proposalHash, risk, confirmationId?, issuedAt, expiresAt = issuedAt + authority.permitTtlSeconds, state: "ACTIVE"}` (ARCHITECTURE §3.3).
6. Refuse to issue without `ALLOW`; derive the permit from the frozen proposal, never from a re-parse or a second model turn (T-08, B-1).
7. Journal `AUTHORIZED` with the permit id, then `consume({permitId, proposalHash, capability, runId})` and the adapter call in one synchronous span with no `await` between them (I-1, I-2, H-2, R-33).
8. On a consume refusal, emit the typed code — `PERMIT_NOT_FOUND`, `PERMIT_EXPIRED`, `PERMIT_CONSUMED`, `PROPOSAL_MISMATCH`, `CAPABILITY_MISMATCH`, `RUN_MISMATCH` — and do not execute (F-16..F-19).
9. Check expiry at use time against the injected clock; refuse and sweep an expired permit, and never extend one.
10. Treat process restart as authority reset: permits are in-memory and are lost (DM-04, fail-closed).
11. Record `proposalHash` in evidence as the idempotency key; deny-on-replay is the chosen semantic (DM-06, R-35), and adapter-level idempotency keys are an integration requirement, not a harness feature.
12. Prove the invariants in tests before claiming the path is complete: reuse (F-18), mismatch (F-19), concurrent double consume (F-23), expiry (F-17), and no adapter invocation without a consumed permit (I-1).

## Decision points
| Condition | Action |
|---|---|
| Registry risk is FINANCIAL | `CONFIRMATION_REQUIRED` even when FINANCIAL is in `riskAllowlist` (SAH-REQ-013) |
| Risk not in `riskAllowlist` | `DENY` / `RISK_NOT_AUTHORIZED`; widen the allowlist only as a reviewed config change (T-16) |
| Permission absent from `grantedPermissions` | `DENY` / `PERMISSION_NOT_GRANTED`; do not grant it to make a case pass |
| HTTP adapter disabled or binding missing | `DENY` before permit issuance; a missing binding is a deny, not a default (F-20, ARCHITECTURE §7) |
| Confirmation id present but proposal hash differs | Refuse with `PROPOSAL_MISMATCH`; treat as a security event (T-08) |
| Two consumes race within one tick | The second observes `PERMIT_CONSUMED`; the synchronous span is the mitigation (F-23) |
| A caller wants a session-wide "trusted mode" | Rejected: per-action mediation only (DM-05) |
| Policy cannot classify the capability's risk | `DENY`; a capability with missing metadata must not reach execution |

## Failure conditions
- A permit issued without `ALLOW`, or bound to capability only rather than to the proposal hash.
- An `await` inserted between consume and the adapter call (reopens the TOCTOU window).
- `POLICY_DECISION` or `AUTHORIZED` journaled after execution begins.
- Permit map persisted to disk or restored on restart; a capability executed twice under one permit.
- Allowlist widened, or a permission granted, to make a demo or benchmark case succeed.

## Stop conditions
- Policy cannot classify the input (unknown capability, unknown risk value, missing metadata) — stop at `DENY` and fix registration rather than guessing.
- The canonical hash cannot be computed for the frozen proposal because canonicalisation is undefined for a new type — fix `canonical-action-json-v1` first (R-54).
- A proposed change would let confirmation, config, or the model supply authority without a permit.
- No journal event can be named that proves the permit for a given terminal status (I-5 cannot be checked).

## Security considerations
- Complete mediation (R-29): every adapter invocation is preceded by consume in one synchronous span; no path skips it (I-1).
- Least privilege and separation of duties, concretely: the model is a non-privileged component; policy and permit store are a distinct privilege domain; privileged dispatches are logged as `AUTHORIZED`/`AUTHORITY_CONSUMED` (R-31).
- Confused deputy (R-30): authority is fixed in trusted configuration; the permit binds what the harness validated, never a caller-supplied target.
- TOCTOU (R-33): hash binding detects substitution and synchronous consume-then-execute closes the window; restart is fail-closed because in-memory permits disappear (DM-04).

## Verification
- `tests/authority.test.mjs`: expiry, reuse, hash/capability/run mismatch, concurrent consume.
- `tests/policy.test.mjs`: three-way decisions, and throwing capability metadata resolves to `DENY`.
- `tests/security.test.mjs`: argument substitution between confirmation and execution refused; replay refused.
- Evidence: for one `runId`, `POLICY_DECISION` → `AUTHORIZED` → `AUTHORITY_CONSUMED` appear in order and the terminal status matches the last lifecycle event (I-5, SAH-REQ-024/025); benchmark B11/B18 exercise denial and reuse deterministically (R-40).

## Expected outputs
- One typed decision with its journal row: `ALLOW`, `CONFIRMATION_REQUIRED`, or `DENY` (with reason).
- At most one permit per action: `ACTIVE` then `CONSUMED`, or a typed refusal record instead.
- An execution that either never began (deny/refusal) or began only after consumption was recorded.

## Dependencies
- `src/policy/policy-engine.mjs`, `src/policy/authority.mjs`, `src/policy/risk.mjs`
- `src/core/canonical.mjs`, `src/core/config.mjs`, `src/harness.mjs`, `src/evidence/journal.mjs`, `config/harness.config.json`

## References
- R-29 (Saltzer & Schroeder, "The Protection of Information in Computer Systems") — complete mediation, fail-safe defaults, least privilege.
- R-30 (Hardy, "The Confused Deputy") — pre-registered handles instead of caller-named targets.
- R-31 (NIST SP 800-53 AC-5/AC-6), R-32 (NIST SP 800-162) — attribute-based policy inputs, logged privileged dispatch.
- R-33 (MITRE CWE-367) — TOCTOU; check-and-act atomically with a bound content hash.
- R-34 (RFC 6749 §10.5; RFC 7519) with R-35 (IETF idempotency-key draft; Stripe) — single-use authority; replay resolved as deny-on-replay (DM-06).
- R-51 (reference `permit-issuer.mjs`), R-52 (reference `policy-engine.mjs`), R-54 (`data-contracts.md`) — typed refusals, fail-closed wrapper, `canonical-action-json-v1` binding.

## Examples
- `invoice.issue` (FINANCIAL): policy returns `CONFIRMATION_REQUIRED`; the operator confirms in the same turn; one permit binds `proposalHash = H`; consume succeeds; the adapter posts; the verifier re-reads state; `EXECUTED_VERIFIED` is reachable only through `VERIFIED` (I-6).
- `journal.propose` (DRAFT): policy returns `ALLOW`, yet a permit is still issued, still single-use, still expiring — `ALLOW` is not exemption from mediation.
- The same instruction repeated a minute later is a new proposal, new hash, new confirmation and new permit; the earlier permit's consumption is not reused (DM-06).

## Anti-patterns
- "The model already validated it, so skip the permit."
- A session-wide trust flag, or a cached decision reused across runs.
- Re-deriving arguments at execution time from a re-parsed model message (B-1).
- Restoring permits from the journal after a restart, or treating a repeated instruction as replay instead of a new action.
- Journaling the permit id without ever checking it at the adapter boundary.
