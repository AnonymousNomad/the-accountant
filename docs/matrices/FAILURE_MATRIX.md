# Failure Matrix

Every failure below is a **tested** path: the test fails if the safe behaviour regresses or
if a failure is ever converted into a success-shaped result.

Stage legend: PROV = provider, PARSE = response parsing, VAL = proposal validation,
POL = policy, AUTH = authority/permit, CONF = confirmation, EXEC = adapter execution,
VER = verification, EV = evidence, CFG = configuration.

| # | Stage | Failure | Observable symptom | Safe system behaviour | Evidence produced | Recovery | Test |
|---|---|---|---|---|---|---|---|
| F-01 | PROV | Ollama not running | Connection refused | Terminal status `PROVIDER_ERROR`; **no proposal is invented, nothing executes**; the CLI exits non-zero in one-shot mode | `PROVIDER_ERROR` record with code `PROVIDER_UNAVAILABLE` | Start Ollama and retry the instruction; the action must be re-proposed | `tests/provider.test.mjs` (unreachable port), `tests/acceptance.test.mjs` |
| F-02 | PROV | Timeout | No response within `timeoutMs` | `PROVIDER_ERROR` / `PROVIDER_TIMEOUT`; abort the request; nothing executes | `PROVIDER_ERROR` with the configured deadline | Retry the instruction (new proposal, new authority) | `tests/provider.test.mjs` (hanging server) |
| F-03 | PROV | Model missing (HTTP 404) | `{"error":"model 'x' not found"}` | `PROVIDER_ERROR` / `PROVIDER_MODEL_MISSING` with the operator-visible message | `PROVIDER_ERROR` with status 404 | Pull/serve the model; no automatic fallback to another model (no silent substitution) | `tests/provider.test.mjs` |
| F-04 | PROV | Unexpected/invalid provider payload | Missing `message.content` | `PROVIDER_ERROR` / `PROVIDER_BAD_RESPONSE`; the raw body is **not** journaled (could contain attacker text), only its shape/diagnostic | `PROVIDER_ERROR` | Investigate runtime version; no parsing "best effort" | `tests/provider.test.mjs` |
| F-05 | PARSE | Malformed JSON (prose, truncation, refusal) | Text is not a single JSON object | `REJECTED` with `RESPONSE_NOT_JSON`; nothing executes | `PROPOSAL_REJECTED` with the parse position and a bounded excerpt | User rephrases; operator may inspect the excerpt | `tests/contracts.test.mjs`, `tests/security.test.mjs` |
| F-06 | PARSE | Valid JSON, wrong envelope (missing/extra fields, bad `kind`) | Schema violations | `REJECTED` with the exact violation list; nothing executes | `PROPOSAL_REJECTED` with violations | Model/prompt fix or user rephrase | `tests/contracts.test.mjs` |
| F-07 | VAL | Unknown capability | Capability id not in registry | `REJECTED` (`UNKNOWN_CAPABILITY`) | `PROPOSAL_REJECTED` | Choose a real capability; the error lists the exposed ids | `tests/contracts.test.mjs`, benchmark B13 |
| F-08 | VAL | Capability exists but is not exposed for this task | Not in the exposed set | `REJECTED` (`CAPABILITY_NOT_EXPOSED`) | `PROPOSAL_REJECTED` | Widen exposure deliberately via config, or use an exposed capability | `tests/security.test.mjs` |
| F-09 | VAL | Invalid arguments (type, enum, bounds, unknown field, placeholder) | Schema violations with paths | `REJECTED`; nothing executes | `PROPOSAL_REJECTED` with per-field issues | Model corrects on a new turn | `tests/contracts.test.mjs`, `tests/security.test.mjs` |
| F-10 | VAL | Missing required information | Model returns `kind:"clarification"` (or the harness rejects an incomplete proposal) | `CLARIFICATION_REQUIRED`; the question is shown; nothing executes | `CLARIFICATION_REQUESTED` | User answers; a new proposal follows | `tests/acceptance.test.mjs`, benchmark B07–B09 |
| F-11 | VAL | Request has no capable operation (e.g. "transfer money") | Model returns `kind:"unsupported"` | `UNSUPPORTED`; the harness states plainly that no capability exists and that nothing executed | `UNSUPPORTED_REQUEST` | Out of scope for v0.1 by design | `tests/acceptance.test.mjs`, benchmark B14 |
| F-12 | POL | Capability exists but the policy denies it | Decision DENY | `DENIED`; no permit is issued | `DENIED` with reason (`PERMISSION_NOT_GRANTED`, `RISK_NOT_AUTHORIZED`, `ADAPTER_DISABLED`, …) | Operator changes config deliberately | `tests/security.test.mjs`, benchmark B11 |
| F-13 | POL | Policy engine throws (defect or hostile metadata) | Internal error | Fail closed: decision is DENY with `POLICY_ERROR`; nothing executes | `DENIED` with `POLICY_ERROR` | Fix the defect; the failure is loud | `tests/security.test.mjs` |
| F-14 | CONF | Confirmation required but not given | `CONFIRMATION_REQUIRED` status | No permit is issued until a matching confirmation arrives | `CONFIRMATION_REQUIRED`, then nothing | User answers `yes`/`no` | `tests/authority.test.mjs`, `tests/acceptance.test.mjs` |
| F-15 | CONF | Confirmation is stale / ambiguous / replayed / consumed / expired | `yes` that does not match exactly one live, current-turn confirmation | `CONFIRMATION_REJECTED` with a typed reason; nothing executes | `CONFIRMATION_REJECTED` | Re-issue the instruction and confirm it fresh | `tests/authority.test.mjs`, benchmark B17, B19 |
| F-16 | AUTH | Permit missing / not issued | No permit id | `DENIED` (`PERMIT_NOT_FOUND`); execution never starts | `DENIED`/`EXECUTION_FAILED` with the reason | Re-run the instruction through policy | `tests/authority.test.mjs` |
| F-17 | AUTH | Permit expired | Past `expiresAt` | Refused with `PERMIT_EXPIRED`; the permit is swept | typed refusal record | Re-run the instruction | `tests/authority.test.mjs` |
| F-18 | AUTH | Permit reused | Second consume of the same id | Refused with `PERMIT_CONSUMED`; **the second execution does not happen** | typed refusal record | None needed; a new action needs new authority | `tests/authority.test.mjs`, `tests/security.test.mjs` |
| F-19 | AUTH | Permit does not match the proposal (substitution) | Hash/capability/run mismatch | Refused with `PROPOSAL_MISMATCH` / `CAPABILITY_MISMATCH` / `RUN_MISMATCH` | typed refusal record | Investigate as a security event | `tests/authority.test.mjs`, `tests/security.test.mjs` |
| F-20 | EXEC | Adapter disabled or unregistered | `ADAPTER_DISABLED` / `ADAPTER_NOT_REGISTERED` | Denied at policy time (before any permit); nothing executes | `DENIED` | Enable deliberately in config with a binding | `tests/adapters.test.mjs`, `tests/security.test.mjs` |
| F-21 | EXEC | Adapter failure (HTTP error, timeout, network) | Adapter returns `ok:false` | `EXECUTION_FAILED`; verification is **not** attempted; no success claim | `EXECUTION_STARTED` then `EXECUTION_FAILED` with code | Operator inspects; the action is not retried automatically | `tests/adapters.test.mjs`, `tests/acceptance.test.mjs` |
| F-22 | EXEC | Partial execution (adapter reports success but state is incomplete) | Verifier finds missing/mismatched state | `VERIFICATION_FAILED`; the result is reported as **not verified** with the failing checks | `EXECUTION_SUCCEEDED` then `VERIFICATION_FAILED` | Investigate; a compensating action is required (recorded, not implemented) | `tests/verification.test.mjs` |
| F-23 | EXEC | Double submission race | Two consumes in one tick | The second consume observes `PERMIT_CONSUMED` (synchronous consume-then-execute) | typed refusal record | — | `tests/authority.test.mjs` (concurrent consume) |
| F-24 | VER | Verifier throws | Exception during verification | `VERIFICATION_FAILED` (fail closed); the exception message is recorded as a check failure | `VERIFICATION_FAILED` | Fix the verifier | `tests/verification.test.mjs` |
| F-25 | VER | Verifier not registered for a capability | Missing id | Capability registration fails loudly at startup; the capability cannot be exposed | `CONFIG_INVALID` / registration error | Fix the pack | `tests/registry.test.mjs` |
| F-26 | EV | Journal write failure (disk full, permission) | I/O error | The action **fails closed**: if the pre-execution evidence cannot be written, execution does not start; if post-execution evidence cannot be written, the status stays a failure and the CLI exits non-zero with the I/O error | `EVIDENCE_WRITE_FAILED` (stderr), process exit code non-zero | Fix storage, re-run | `tests/evidence.test.mjs` |
| F-27 | EV | Journal chain broken (tampering) | `:verify-chain` mismatch | Reported as invalid with the first broken sequence number; remaining records are still shown | chain verification report | Investigate; the journal is the audit trail | `tests/evidence.test.mjs` |
| F-28 | CFG | Invalid config (unknown key, bad type, HTTP enabled without base URL) | Startup error | Refuse to start (`CONFIG_INVALID`); never start with defaults silently substituted | `CONFIG_INVALID` on stderr, exit code non-zero | Fix the config | `tests/config.test.mjs` |
| F-29 | CFG | Non-local provider base URL | Host not loopback | Refuse unless `allowNonLocalProvider` is explicitly true AND a warning is journaled | `CONFIG_INVALID` / `PROVIDER_ERROR` | Deliberate opt-in | `tests/security.test.mjs` |
| F-30 | ANY | Duplicate `proposalId` in one session | Same id twice | `REJECTED` (`PROPOSAL_ID_REPLAY`); second action cannot execute under the first one's identity | `PROPOSAL_REJECTED` | Use a fresh id (the model must generate one per proposal) | `tests/security.test.mjs` |

## Recovery doctrine

1. There is **no automatic retry** in v0.1. A retry is a new user turn, a new proposal, and
   new authority. This is deliberate: retrying an action that may have partially executed
   amplifies harm (R-35 disagreement resolved by denial).
2. A failure never invalidates the evidence of what was attempted.
3. Any manual recovery that changes state outside the harness (e.g. an operator editing the
   synthetic store) breaks the determinism assumptions of the benchmark; the benchmark
   therefore always starts from a fresh store.
