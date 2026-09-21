# Threat Model — Sovereign Action Harness v0.1

Companion to the full registers: `docs/matrices/THREAT_MATRIX.md` (T-01..T-20, with the
complete actor, entry-point, asset, likelihood, consequence, detection and residual columns),
`docs/matrices/FAILURE_MATRIX.md` (F-01..F-30) and `docs/matrices/ASSUMPTION_MATRIX.md`
(A-1..A-14). This file summarises the model; the register is authoritative for any single row.

## Scope and trust assumptions

- One operator, one local machine, one process, one session, one provider. Identity is
  `identity.actorId` / `identity.workspaceId` from trusted configuration; permits and
  confirmations live in memory and are discarded on restart (fail closed).
- Model output is untrusted text. It is parsed into exactly one JSON envelope, validated
  against a capability schema, and treated as a request — never as authority, risk,
  permission, endpoint, or proof of success.
- The model runtime is an unauthenticated, localhost-bound HTTP service (Ollama or the
  scripted fixture). Its base URL must be loopback unless the operator explicitly sets
  `allowNonLocalProvider: true`; the harness does not expose the runtime further.
- Responses from any HTTP endpoint are untrusted claims. Independent verification re-reads
  domain state; the adapter's success flag is not evidence.
- Configuration is a trusted boundary, reviewed like code (T-18). It owns granted
  permissions, the risk allowlist, exposure domains and adapter bindings; unknown keys are
  rejected, the HTTP adapter is disabled by default, and bindings are explicit and loopback.
- Stated plainly: a compromised host defeats every local-only control in v0.1. A privileged
  local attacker can edit configuration, read process memory and rewrite the journal. This is
  accepted scope (A-7), recorded here rather than hidden.
- Synthetic fixtures contain no real customer data; data-protection threats are out of scope
  for v0.1 and are carried as integration requirements for the real system
  (`docs/INTEGRATION_CONTRACT.md`).

## Assets and boundaries

| Asset | Boundary that protects it | Enforcement point | Control |
|---|---|---|---|
| Execution authority | Model output to harness | Proposal validation, policy, permit | One-use permit bound to run, actor, workspace, capability + version + snapshot, risk, proposal hash, argument hash; issued only for `ALLOW`; consumed synchronously immediately before execution (I-1, I-2) |
| Application state | Proposal to adapter | Policy engine and registry | Risk and permissions read only from trusted metadata; exposure enforced at validation and re-checked in policy; unknown or unexposed capability denied (I-4) |
| Financial integrity | Confirmation to execution | `confirmations.mjs`, `authority.mjs` | The approved proposal is a deep-frozen snapshot bound to its canonical hash; confirmation is turn-bound, TTL-bound and single-use; execution never re-parses the object (I-3) |
| Endpoint control | Model to HTTP request | `generic-http-adapter.mjs` and config | No URL, method, host, path or header field exists in any capability schema; bindings come from trusted config; origin check; `redirect: 'manual'`; timeout; no credentials in code (I-8) |
| Audit trail | Harness to journal | `evidence/journal.mjs` | Append-only JSONL, sequence numbers, hash chain, redaction before hashing, chain verification; a write failure aborts the action (I-7, F-26) |
| Result integrity | Adapter claim to result | `evidence/verifier.mjs` | A registered verifier re-reads authoritative state; a missing, empty or throwing verifier is a failed verification; only `VERIFIED` yields `EXECUTED_VERIFIED` (I-6) |
| Credentials | Config and headers to process | `core/config.mjs`, `.gitignore` | Secrets live only in the gitignored headers file referenced by `adapters.http.headersFile` (`.gitignore` covers `config/http-headers.local.json` and `var/`); they are never committed, journaled, or sent to the provider |
| Tool surface and attention budget | Registry to model prompt | `registry/context.mjs` | Bounded deterministic exposure (domain filter, keyword relevance, `maxCapabilities` cap); model-safe descriptors omit adapter and transport details; `relatedCapabilities` is filtered to the exposed set |

## Threat register

Status: **D** designed in and tested · **P** partially mitigated, residual recorded ·
**X** explicitly deferred with a named trigger. Proof cites the test files present in this
repository; where the register's Test column names a file that is not present, this summary
cites the present file that holds the coverage. Full analysis: `docs/matrices/THREAT_MATRIX.md`.

| Id | Threat | Mitigation class | Status | Proof |
|---|---|---|---|---|
| T-01 | Prompt injection leading to an unintended action | Untrusted model output; binding; confirmation | D | `tests/security.test.mjs` (S12), `tests/adapters.test.mjs` (injected text stays data), benchmark B29 |
| T-02 | Tool/capability hallucination | Registry-only resolution | D | `tests/security.test.mjs` (S01), benchmark B14 |
| T-03 | Arbitrary capability invocation (not exposed for the task) | Exposure set enforced at validation and in policy | D | `tests/security.test.mjs` (S13), `tests/capability-awareness.test.mjs` (A05), benchmark B28 |
| T-04 | Privilege escalation via capability metadata | Registration-time validation plus human review | D | `tests/registry.test.mjs` |
| T-05 | Stale confirmation ("yes" much later) | Turn-bound, TTL-bound, single-use approval | D | `tests/authority.test.mjs`, benchmark B17, B18 |
| T-06 | Replay of a previous action | Single-use permits and proposal-id replay guard | D | `tests/authority.test.mjs`, `tests/security.test.mjs` (S14) |
| T-07 | Permit reuse | Atomic single-use consumption with full binding check | D | `tests/authority.test.mjs`, `tests/security.test.mjs` (S05) |
| T-08 | Argument substitution between confirmation and execution | Frozen approved snapshot plus canonical hash binding | D | `tests/security.test.mjs` (S04), `tests/authority.test.mjs`, benchmark B36 |
| T-09 | Arbitrary HTTP endpoint execution | Trusted configuration owns endpoints | D | `tests/adapters.test.mjs`, `tests/config.test.mjs`, benchmark B34 |
| T-10 | SSRF-like adapter misuse via redirects | No redirect following; typed failure | D | `tests/adapters.test.mjs` |
| T-11 | Untrusted tool output influencing the model | No re-prompt loop in v0.1 | P | `tests/adapters.test.mjs` (injection stays inert); trigger is any future re-prompt loop |
| T-12 | Evidence tampering | Append-only hash chain | D | `tests/evidence.test.mjs` |
| T-13 | Secret leakage into evidence | Redaction; adapter headers never journaled | D | `tests/evidence.test.mjs` |
| T-14 | Model failure interpreted as success | Closed terminal status set; explicit failure statuses | D | `tests/security.test.mjs` (S09, S10), `tests/acceptance.test.mjs` (G09, G10), `tests/cli.test.mjs` |
| T-15 | Verification bypass | Registered verifier required at startup; failure is terminal | D | `tests/verification.test.mjs`, `tests/registry.test.mjs` |
| T-16 | Excess autonomy or unattended operation | Default-denied risks; FINANCIAL confirmation mandatory | D | `tests/acceptance.test.mjs` (G03), benchmark B11 |
| T-17 | Resource exhaustion (unbounded consumption) | Bounded exposure; one action per turn; no auto-retry | P | `tests/benchmark.test.mjs` (measured arms); no rate limiting (deferred, R-38) |
| T-18 | Configuration tampering | Strict config schema; config hash journaled at session start | D | `tests/config.test.mjs` |
| T-19 | Dependency or supply-chain compromise | Zero runtime dependencies; lint bans dynamic execution | D | `scripts/lint.mjs` |
| T-20 | Memory poisoning across sessions | No memory or learning loop in v0.1 | X | Deferred; no test exists because no such feature exists |

## Controls that are deliberately NOT implemented in v0.1

| Control | Why it is deferred | What would trigger it |
|---|---|---|
| Per-capability rate limiting | No multi-user or network-exposed deployment exists yet; T-17 is a recorded residual (R-38) | Before any multi-user or network-exposed deployment |
| Signed evidence or an external anchor | Signing needs key custody, a whole subsystem deferred from v0.1; the collaborator's key custody is UNKNOWN, so guessing it would be worse (T-12, DM-11) | A requirement that evidence survive a privileged local actor, or any multi-host deployment |
| Streaming responses | v0.1 sets `stream: false` and asserts one JSON object; a streaming parser adds surface with no v0.1 need (R-10) | A real model run shows latency or token-budget pressure |
| Automatic repair loops | A failed proposal ends the turn; repair doubles model calls and its safety depends on idempotency guarantees the collaborator has not confirmed (DM-15) | A measured parse-failure rate below the acceptance bar (R-25) |
| Persistent memory | v0.1 has no memory or learning loop; state is per-process and synthetic (T-20) | Any persistent memory feature (OWASP ASI T1) |
| Multi-user identity | v0.1 is single-operator with a flat granted permission set (A-13) | A second user, or per-user permission mapping required by the first integration |
| Key custody | No key store exists; the collaborator's key design is UNKNOWN (M-3) | Signed evidence or BYOK-style credential custody becomes a requirement |

## Residual risks

- A compromised host (A-7): a privileged local attacker defeats every local-only control —
  configuration, in-memory authority, and the journal are all reachable.
- A full-chain rewrite of the journal (T-12): an attacker who rewrites the whole chain from
  scratch is undetectable without an external anchor; signing is deferred.
- Redaction of novel secret shapes (T-13): pattern-based redaction can miss a credential shape
  it has never seen; the main secret source, adapter headers, is never journaled at all.
- Verifier correctness (A-3): a verifier that checks the wrong facts can pass a bad execution;
  review and mutation tests reduce this, they do not eliminate it.
- An operator widening the configuration (T-16, T-18): widening `riskAllowlist`, exposure
  domains, or enabling the HTTP adapter is a deliberate, journaled change that increases
  authority; the harness cannot stop an operator from widening its own configuration.
- Ambiguous post-commit failure (H-8, A-5): a non-idempotent request that times out may have
  been applied; the adapter reports commit certainty as `NOT_SENT` or `UNKNOWN`, the action is
  never retried automatically, and compensation needs the collaborator's transaction semantics.
- Verification depends on a read-back (A-2, H-4): without one, a mutation cannot reach
  `EXECUTED_VERIFIED`; the capability must stay unregistered rather than ship with a stub verifier.

## How to extend this model

1. Add a row to `docs/matrices/THREAT_MATRIX.md` with actor, entry point, asset, likelihood,
   consequence, mitigation, detection, residual and test.
2. Add the test or evidence that proves the mitigation; a threat row without proof is a claim.
3. If the mitigation is deferred, record the trigger in the register's deferral table and in
   the "deliberately NOT implemented" section above.
4. State the residual risk plainly; never leave it implicit.
5. Update this file in the same change; if the asset or boundary table changes, update the
   enforcement point and control for the affected row.
6. Update `COLLABORATOR_AGENT_NOTES.md` in the same change.
