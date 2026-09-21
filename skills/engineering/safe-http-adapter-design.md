---
name: safe-http-adapter-design
description: Binds validated capabilities to trusted-config HTTP endpoints with no redirects, hard timeouts, and untrusted-response handling; use when enabling src/adapters/generic-http-adapter.mjs, authoring adapter bindings or the gitignored headers file, or debugging an adapter denial or execution failure.
---

## Purpose
Give the harness a generic execution path that a capability can use without ever letting model output name a host, path, method, or credential. Bindings, timeouts, and headers come from trusted configuration; the response is treated as a claim, not as a fact, and never as verification.

## When to use
- Enabling or configuring the HTTP adapter block in `config/harness.config.json` (`adapters.http`).
- Adding a binding for a newly onboarded capability that the collaborator's system will expose later.
- Implementing or reviewing `src/adapters/generic-http-adapter.mjs` timeout, redirect, or expectation logic.
- Diagnosing `ADAPTER_DISABLED`, `ADAPTER_NOT_REGISTERED`, or `EXECUTION_FAILED` for an HTTP-bound capability (F-20, F-21).

## When NOT to use
- App-side changes that the mock adapter covers — the synthetic pack is the default in v0.1 (DM-09).
- Verification design — the verifier never runs through this adapter's code path (use `independent-action-verification.md`).
- Inventing or guessing collaborator routes. If no specification exists, the binding does not exist either (A-1, A-2, A-4).
- Any capability that would need a shell, a dynamic URL, or a credential in source. Those are forbidden, not deferred.

## Prerequisites
- `adapters.http.enabled` is `false` by default; enabling it is a deliberate, diffable config change (DM-09).
- The capability is onboarded with a risk class, permission list, and a registered verifier (I-10, `sops/capability_onboarding.md`).
- A local test server exists for deterministic tests; `node:http` is an accepted test-only dependency (DEPENDENCY_MATRIX.md).
- The optional headers file is gitignored and outside the evidence path; it is never committed.

## Inputs
- `adapters.http`: `enabled`, `baseUrl`, `bindings` (`{"<capabilityId>":{"method":"POST","path":"/..."}}`), `headersFile`, `timeoutMs`.
- The validated, deep-frozen proposal arguments from the confirmation/authority path.
- The capability's declared success expectation (status class and required response fields).

## Procedure
1. Leave `enabled: false` until a real specification and a read-back path exist; record the enabling decision in `COLLABORATOR_AGENT_NOTES.md` (A-2, DM-09).
2. When enabled, validate `baseUrl` as an absolute URL at config load and refuse startup on failure; never substitute a default (F-28).
3. Define bindings only in trusted config: `method` from an allowlist and `path` a fixed template. No URL, host, method, or path may ever arrive from model output or proposal arguments (T-09, I-8, R-30).
4. Ensure policy denies any capability whose binding is absent before a permit is issued, with a typed reason; a missing binding is a denial, never a default target (F-20, H-3).
5. Put required per-request secret headers in the optional `headersFile`; never place credentials, tokens, or keys in source, config, fixtures, or evidence; never journal header values (T-13, M-2, SAH-REQ-023).
6. Execute with `redirect: "manual"` and treat every 3xx as failure; do not follow redirects even to the configured host (T-10).
7. Enforce `adapters.http.timeoutMs`; abort the request and map timeout or transport failure to `EXECUTION_FAILED` (F-21).
8. Serialize only validated arguments into the request. Where the endpoint accepts an idempotency key, send the canonical proposal hash; where it does not, record that as an integration requirement rather than inventing a retry (R-35, DM-06, A-5).
9. Treat the response as an untrusted claim: success requires the declared expectation to be satisfied (expected status class and required response fields); anything else is `EXECUTION_FAILED` with the observed status, never a body dump (H-8, R-27).
10. Never feed response content back into a prompt; v0.1 has no re-prompt loop (T-11, R-25).
11. Journal `EXECUTION_STARTED` before dispatch using the frozen proposal snapshot; journal `EXECUTION_SUCCEEDED` or `EXECUTION_FAILED` after. If the post-execution write fails, the status stays a failure and the CLI exits non-zero (F-26).
12. Hand control to the registered verifier path with the unchanged arguments; do not let the adapter's report stand in for verification (DM-14).
13. For tests, assert redirect non-following, timeout mapping, non-2xx handling, binding resolution, and that a proposal carrying a URL-like field is rejected before execution (T-09, T-10).

## Decision points
| Condition | Action |
|---|---|
| `enabled: false` or binding absent | Policy denies before a permit is issued (F-20) |
| `baseUrl` invalid or missing while enabled | Refuse startup with `CONFIG_INVALID` (F-28) |
| Response is 3xx | Fail; do not follow (T-10) |
| Response is 2xx without required fields | `EXECUTION_FAILED`; the claim is unmet (H-8) |
| Request times out after the server may have committed | `EXECUTION_FAILED`; record the post-commit ambiguity as an integration requirement (H-8, A-5) |
| Endpoint cannot be re-read for verification | Stop; pair a read-back, or declare the capability unverifiable (H-4) |

## Failure conditions
- `ADAPTER_DISABLED` / `ADAPTER_NOT_REGISTERED` at policy time (F-20).
- `EXECUTION_FAILED` from HTTP error, timeout, or unmet expectation; verification is not attempted (F-21).
- `EVIDENCE_WRITE_FAILED` on the pre- or post-execution write, with non-zero exit (F-26).
- `CONFIG_INVALID` from an invalid adapter or `baseUrl` configuration (F-28).

## Stop conditions
- A binding would need a URL or method taken from the model — stop (I-8, R-30).
- Credentials would have to live in source, config, fixtures, or tests — stop; use the gitignored headers file or defer the capability.
- The operation mutates state and has neither a read-back nor an idempotency key — stop and record the blocker in `docs/INTEGRATION_CONTRACT.md` (H-4, A-5).
- A retry mechanism is proposed to mask a timeout — stop; no automatic retry in v0.1 (DM-15).

## Security considerations
- Confused-deputy prevention: the capability is a pre-registered handle; the model cannot name an endpoint or permission (R-30).
- SSRF restraint: bindings from trusted config, no redirects, base URL validated at load (T-09, T-10).
- Secrets: headers never journaled, headers file gitignored, redaction covers all journal fields (T-13).
- Config is a trusted-input boundary reviewed and diffed like code; record the config hash at session start (T-18).
- No dynamic code: no `eval`, no shell, no adapter-supplied script; `scripts/lint.mjs` forbids `child_process` and non-local URLs (T-19).

## Verification
- `tests/adapter-http.test.mjs` asserts: redirects not followed, timeout maps to failure, non-2xx maps to failure, unknown binding denied at policy time, no URL/method can come from model output (SAH-REQ-021, SAH-REQ-022).
- `tests/config.test.mjs` asserts HTTP enabled without a valid `baseUrl` refuses startup (SAH-REQ-021).
- `tests/security.test.mjs` asserts an arbitrary-endpoint attempt is rejected and no secret value appears in evidence (SAH-REQ-023, SAH-REQ-026).
- `scripts/lint.mjs` scans for secrets in source and forbidden APIs; run it in `npm run verify` and record output in `docs/EVIDENCE.md`.

## Expected outputs
- A disabled-by-default adapter with explicit bindings; denials with typed reasons for unbound capabilities; execution records on the journal; failures that never read as success.

## Dependencies
- `src/adapters/generic-http-adapter.mjs`, `src/core/config.mjs`, `src/core/errors.mjs`.
- `src/policy/policy-engine.mjs` (binding denial), `src/evidence/journal.mjs`.
- `src/evidence/verifier.mjs` and the domain verifiers for post-execution checks.
- `config/harness.config.json`.

## References
- R-26 excessive agency (STANDARD); R-27 improper output handling (STANDARD); R-29 complete mediation, least privilege (PRIMARY).
- R-30 the confused deputy (PRIMARY); R-33 TOCTOU (STANDARD); R-35 idempotency versus single-use authority (STANDARD + AUTHORITATIVE SECONDARY).
- R-38 agentic tool misuse (AUTHORITATIVE SECONDARY).
- Threats T-09, T-10, T-11, T-13, T-18, T-19; failures F-20, F-21, F-26, F-28; decisions DM-06, DM-09; assumptions A-2, A-5.

## Examples
- Config: `"http": {"enabled": false, "baseUrl": "http://127.0.0.1:9", "bindings": {"customer.create": {"method": "POST", "path": "/synthetic/customers"}}, "headersFile": null, "timeoutMs": 10000}`. The binding above is the local synthetic test target, never a collaborator route.
- Denial drill: disable the HTTP adapter (or remove the `invoice.issue` binding) and confirm the proposal terminates `DENIED` with a typed reason (`ADAPTER_DISABLED` / missing binding) before any `AUTHORIZED` event.
- Redirect drill: point the test server's fixture at a 302 and confirm `EXECUTION_FAILED` with no second request observed by the test server.
- Timeout drill: configure `timeoutMs: 50` against a handler that sleeps, and confirm `EXECUTION_FAILED` plus no verification event.

## Anti-patterns
- Constructing a URL by concatenating model-provided arguments into a path.
- Following redirects "just to the same host".
- Treating HTTP 200 as success without checking the declared expectation.
- Logging request or response headers for debugging.
- Committing a `.env` or headers file; using environment variables as an undeclared credential store.
- Adding adapter-level retry to paper over flaky endpoints.
