# Known Limitations

The single collaborator-facing statement of what is **not** proven. Do not weaken this language.

## Synthetic workload ≠ production proof

```
SCALE-FAITHFUL
BEHAVIOR-SYNTHETIC
NOT A REPLICA
```

The evaluated workload is a synthetic accounting simulation sized from *reported* scale
characteristics (394 routes, 88 entities, 176 screens, 4 jurisdictions, 56 semantic capabilities,
100 tasks). It contains no real accounting, tax, payroll or regulatory logic, and it is not any
particular application. It exists to exercise the harness under a realistic *shape*, not to model a
product.

## Unknown until the real system is inspected

| Fact | Status | Why it matters |
|---|---|---|
| Real authentication and session behaviour | UNKNOWN | determines who the actor is at each layer |
| Real permission model and enforcement point | UNKNOWN | a "permission" the application does not enforce is not a control |
| Real transaction semantics and partial-commit behaviour | UNKNOWN | decides what `COMMIT_UNKNOWN` must reconcile |
| Real idempotency behaviour of mutating endpoints | UNKNOWN | decides whether any retry is ever safe |
| Real read-back endpoints (and cache behaviour) | UNKNOWN | without an authoritative read, a capability is UNVERIFIABLE |
| Real application performance and timeouts | UNKNOWN | the harness's deadlines must be sized against them |
| Real multi-user / workspace identity requirements | UNKNOWN | the permit binds actor and workspace; they must exist in the app |
| Real route, schema and versioning details | UNKNOWN | every mapping row in the worksheet needs them |

Reported-but-unverified claims about any external system (including security properties) are recorded
elsewhere as REPORTED BY COLLABORATOR and are neither endorsed nor challenged here.

## Measured limits of the evidence

- **Latency figures are machine-specific.** p50 ≈ 144 s per model call at ~5.6 k prompt tokens was
  measured on a 6-core mobile CPU with CPU-only inference. Do not generalise it to other hardware;
  a GPU or a larger machine will differ, and no optimisation was attempted.
- **The canonical Resident did not clear the pre-registered quality gate.** On the synthetic workload
  (S22, 60 observations): selection 44/50 = 88.0 % and proposal validity 50/60 = 83.3 % against ≥95 %
  targets, with argument accuracy 100 %, zero hallucinations and all safety metrics zero. **No
  qualification claim is made** — not for this synthetic workload, and certainly not for a real
  application, payroll, tax or funds movement. The residual failure classes (nested-argument schemas,
  client timeouts, read-task clarification, one truncation) are attributed in
  `COLLABORATOR_AGENT_NOTES.md`.
- **The frozen task subset does not exercise every gate.** The first 20 tasks contain no
  clarification- or unsupported-kind expectations, so those gates are reported as **UNMEASURABLE**
  rather than scored from a manufactured denominator.
- **Provider-side failures are apparatus, not model quality.** Truncated generations (output cap) and
  inference timeouts are recorded as apparatus events and are never counted as reasoning failures.
  This includes the client-side 300 s `headersTimeout` that Node's fetch applies regardless of the
  configured inference timeout (F-35) — it bounds both recorded runs and surfaces as an "engine
  unreachable" provider error even though the engine is alive.
- **Argument scoring is exact-match** against the reference arguments for the selected capability; it
  does not evaluate semantically equivalent alternatives.
- **No real integration has been performed.** Every adapter path has been exercised only against local
  fixtures. The first real integration slice is deliberately narrow: **customer search/create** and
  **invoice draft**.

## What this repository does not claim

It does not claim to solve any specific accounting application, to be production-ready for accounting,
to be proven safe for payroll or tax, to be validated against hundreds of real routes, to be a
zero-trust accounting system, or to hold any compliance certification. Those require evidence from the
real application, obtained through `INCOMING_CODEBASE_RECON.md`, `INTEGRATION_AUDIT_CHECKLIST.md` and
`CAPABILITY_MAPPING_WORKSHEET.md`.
