# Integration Audit Checklist

A correct harness can still produce a bad system if an upstream or downstream assumption is false. This
checklist audits the **whole path**, not only the harness boundary.

```
USER
 ↓  toolbar / overlay            (1) request construction
 ↓  session / identity           (2) actor, workspace, tenant
 ↓  RESIDENT                      (3) proposal quality, doctrine compliance
 ↓  CAPABILITY DISCOVERY         (4) was the right operation even offered?
 ↓  AUTHORITY                    (5) policy, risk, confirmation, permits
 ↓  ADAPTER                      (6) mapping, schema transformation
 ↓  BUSINESS SERVICE             (7) contract, permissions, behaviour
 ↓  TRANSACTION / DATABASE       (8) commit boundary, partial failure
 ↓  READ-BACK                    (9) authoritative proof of effect
 ↓  VERIFICATION                 (10) independent check, not an echo
 ↓  EVIDENCE                     (11) append-only, redacted, reconstructable
 ↓  USER                         (12) UI state reconciliation
```

Score each row: **VERIFIED / ASSUMED / UNKNOWN / VIOLATED**, with the evidence that decides it.

## Coverage (minimum)

| Area | Question that decides it |
|---|---|
| Request construction | does the user gesture produce an unambiguous instruction, or does the UI hide state the model needs? |
| Identity propagation | is the actor the same entity at the UI, the service and the audit record? |
| Authorization | where is permission actually enforced — UI, service or database? |
| Permissions granularity | can a capability be bound to a permission the application truly enforces? |
| Workspace / tenant identity | can a request cross tenants; does the harness's permit binding carry the same identity? |
| Schema transformation | are argument names, units and encodings transformed anywhere between contract and service? |
| Business-service contracts | are the request/response shapes documented, stable and versioned? |
| Transaction boundaries | what is atomic; what can partially commit? |
| Partial commits | if half a write lands, what does the application show? |
| Idempotency | is a duplicate request safe; does a key exist; is it honoured? |
| Retries | who retries today, at which layer, and with what identity? |
| Timeouts | what is the client deadline versus the service deadline? |
| Caching | can a read-back be served from cache and therefore lie? |
| Stale state | how long can the UI, the cache and the database disagree? |
| Concurrency / races | two operators, one record: what wins, and is it visible? |
| Read-back verification | is there an authoritative read that reflects the committed effect? |
| UI state reconciliation | after a verified effect, does the UI actually show it? |
| Evidence / logging | does the application log enough to reconstruct a request it received? |
| Failure recovery | after an ambiguous write, what does the operator do today? |

## Hard rules

- **Possible write + unknown result ⇒ `COMMIT_UNKNOWN` ⇒ reconcile ⇒ never blindly retry.** An
  upstream retry that violates this is a VIOLATED row, not a convenience.
- A read-back served from a cache is not proof. Mark it ASSUMED until cache behaviour is known.
- If the UI can show success before the commit is durable, mark UI state reconciliation VIOLATED and
  treat the capability as unverified until fixed at the boundary.
- Evidence obligations do not move: the harness records what it did; the application must be able to
  record what it received. If it cannot, that is an INTEGRATION_DEPENDENCY.

## Output

One table of the 19 coverage rows with status and evidence, plus a short list of VIOLATED/UNKNOWN rows
with the capability each one blocks. That list is the input to outage planning for the first slice.
