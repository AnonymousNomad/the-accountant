# Adapter Integration — Mock Discipline and Bringing Up the Generic HTTP Adapter

## Objective
Add or validate a capability adapter so that execution uses only validated arguments and trusted bindings,
with no URL, method, host, path, or credential reachable from model output (I-8, T-09, REQ-021/022).

## Prerequisites
- The capability is onboarded or being onboarded (`sops/capability_onboarding.md`) with a registered verifier.
- `src/adapters/mock-accounting-adapter.mjs` and `src/adapters/generic-http-adapter.mjs` are the only
  execution paths; no other adapter kind is accepted.
- For a real system: `docs/INTEGRATION_CONTRACT.md` fields are answered or explicitly marked UNKNOWN.
- You have write access to `config/harness.config.json` only through review; the file is a trusted input (T-18).

## Procedure
1. Keep the mock adapter as the reference implementation: it dispatches validated arguments to synthetic
   domain operations and never computes an outcome outside the deterministic store.
2. Add the mock binding to the capability definition as `{ kind: "mock", operation: "<domain-op>" }` and
   prove the whole lifecycle against it before touching HTTP.
3. Confirm the enable gate: in the committed `config/harness.config.json`, `adapters.http.enabled` is
   `false`; enabling is a separate reviewed change with a recorded reason.
4. Set `baseUrl` to the target origin only — scheme + host + optional port, no query, no fragment, valid URL;
   prefer loopback; a non-loopback host is a deliberate operator decision, never a default.
5. Add one `bindings` entry per capability: `{ "<capabilityId>": { "method": "POST", "path": "/…" } }`.
   A capability with no binding is denied by policy — deny-by-default, not a fallback (F-20).
6. Keep any placeholder tokens in a binding path fixed in configuration and validated against the
   capability schema; the model supplies argument values only, never a path, method, or host.
7. Move credentials into the headers file referenced by `adapters.http.headersFile`; verify the path is
   covered by `.gitignore` and, if it is not, add the ignore rule in the same change; never journal, print,
   or commit the file's contents (T-13).
8. Set `timeoutMs` (default 10000) below the provider deadline; a timeout is an adapter failure
   (`EXECUTION_FAILED`), never a success and never auto-retried (DM-15).
9. Confirm redirects are refused: the adapter sends `redirect: "manual"` and treats any 3xx as failure
   (T-10); do not add redirect following, and treat DNS rebinding as out of scope and recorded.
10. Declare the success expectation for the binding (expected status plus required response fields); an
    ambiguous 2xx body without the expected identifier is `EXECUTION_FAILED` (H-8). A 200 or `ok:true` is a
    claim, not a fact.
11. Pair every HTTP binding with a registered verifier that re-reads authoritative state; if the operation
    has no read-back, mark it unverifiable so it can never reach `EXECUTED_VERIFIED` (H-4).
12. Test against a local HTTP test server: success, non-2xx, timeout, redirect, missing binding, disabled
    adapter, and a body missing the expected field; then run `npm run verify`.
13. Record the enable/disable decision, the binding, and the reviewer in `COLLABORATOR_AGENT_NOTES.md`.

Exact configuration shape (only these keys; unknown keys are rejected):
```json
"adapters": {
  "mock": { "enabled": true },
  "http": {
    "enabled": false,
    "baseUrl": "http://127.0.0.1:8088",
    "bindings": {
      "invoice.issue": { "method": "POST", "path": "/api/v2/invoices/{invoiceId}/post" }
    },
    "headersFile": "var/http-headers.json",
    "timeoutMs": 10000
  }
}
```
Binding rules: `enabled:false` plus a non-empty `baseUrl` is itself a config error; a binding that is not
referenced by any registered capability is dead configuration and must be removed; every binding must have
a verifier-backed capability.

## Gates
- G1: committed config keeps `adapters.http.enabled` false and contains no credential material.
- G2: the headers file, if referenced, exists outside version control and is ignored by `.gitignore`.
- G3: every enabled binding resolves to a registered capability with a registered verifier.
- G4: adapter tests cover failure, timeout, redirect, and ambiguous-success cases and have been run.
- G5: no capability schema, description, prompt, or fixture contains a URL, method, or host string.

## Expected evidence
- The config diff (enable flag, `baseUrl`, bindings, `timeoutMs`), the `.gitignore` line for the headers file.
- Adapter test names and `npm run verify` output.
- Journal shape for a real execution: `EXECUTION_STARTED` -> `EXECUTION_SUCCEEDED`/`EXECUTION_FAILED`, then
  `VERIFIED`/`VERIFICATION_FAILED`, with the resolved binding recorded but no secrets.

## Failure conditions
- Adapter disabled or binding absent: policy denies before any permit; nothing executes.
- HTTP error, timeout, or malformed/ambiguous response: `EXECUTION_FAILED`; verification is not attempted.
- Adapter reports success but the verifier finds missing or mismatched state: `VERIFICATION_FAILED`, reported
  as not verified, never as success (F-22).
- A credential appears in a committed file, a journal record, or a transcript: stop, rotate the credential
  outside this repository, and record the incident entry; do not rewrite the journal.

## Rollback / recovery
- Set `adapters.http.enabled` back to `false`, remove the binding, re-run `npm run verify`, and record the
  rollback with the reason.
- If an operation has no read-back, keep the capability unexposed and leave the integration blocker in
  `docs/INTEGRATION_CONTRACT.md`; do not ship a placeholder verifier.
- After any partial execution, do not retry automatically; a compensating action is a recorded operator
  decision, not harness behaviour (H-5).

## Completion criteria
- Every executed capability has either a passing mocked lifecycle or a reviewed enabled binding plus a
  verifier, with tests and `npm run verify` output recorded.
- No model-reachable field anywhere can influence endpoint, method, path, headers, or credentials.
