# Generic Adapter Example

**EXAMPLE ONLY — REPLACE WITH REAL APPLICATION CONTRACTS.** No route, module or product name below is
real. Nothing here is executed by the harness. It exists to show the *shape* of an adapter binding:
where the semantic contract ends and the application's real code begins.

## The chain

```
semantic request                     (model output — validated, still only a request)
        │
trusted route/function binding       (configuration, never model output)
        │
input transformation                 (argument names, units, encoding — deterministic, tested)
        │
application invocation               (adapter calls the real service)
        │
normalized result                    (adapter's reply: a CLAIM, not a fact)
        │
read-back verification               (independent read of authoritative state)
        │
evidence result                      (ids, digests, statuses — privacy-minimal)
```

## Binding (trusted configuration)

```json
{
  "adapters": {
    "http": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:9000",
      "bindings": {
        "customer.search":     { "method": "GET",  "path": "/<real search path>",  "expectStatus": 200, "requiredResponseFields": ["items"] },
        "customer.create":     { "method": "POST", "path": "/<real create path>",  "expectStatus": 201, "requiredResponseFields": ["id", "name"] },
        "invoice.create_draft":{ "method": "POST", "path": "/<real draft path>",   "expectStatus": 201, "requiredResponseFields": ["id", "status"] }
      }
    }
  }
}
```

Notes that matter:

- `baseUrl` must be loopback; the adapter refuses anything else, and refuses redirects.
- The model cannot influence method, path or host: they exist only here.
- `requiredResponseFields` is how an ambiguous or partial response becomes a failure instead of a
  success. Add every field whose absence would make the result unverifiable.
- Headers (if the real service needs auth) come from a gitignored local file, never from source and
  never into evidence.

## Input transformation (deterministic, tested)

| Semantic argument | Application field | Transformation |
|---|---|---|
| `query` | `<real search term field>` | trim; reject empty; percent-encode in the path when the binding uses a path parameter |
| `name` | `<real name field>` | trim; reject placeholders (`N/A`, `unknown`, …) |
| `email` | `<real email field>` | optional; if present, must match the contract pattern |
| `customerId` | `<real customer reference>` | must already exist in the application's namespace; the adapter never invents one |
| `lines[]` | `<real line array>` | quantities and unit prices stay integers in the application's unit; **the application computes totals** |

## Normalized result

The adapter returns only what the harness needs to (a) verify and (b) record:

```json
{ "ok": true, "data": { "customerId": "<id>", "status": "<state>" }, "commitState": "COMMITTED" }
```

Failures carry `ok:false`, a typed `code`, and a `commitState` of `NOT_SENT` (definitely no effect) or
`UNKNOWN` (the application may have applied it — `COMMIT_UNKNOWN`, reconcile, never blind-retry).

## Read-back verification

```js
// Verifier sketch — runs AFTER the adapter reports success, reads AUTHORITATIVE state, never the reply.
async function verifyCustomerCreated({ store, arguments: args, execution }) {
  const id = execution.data.customerId;
  const record = await store.getCustomer(id);            // real: the application's read path
  return {
    checks: [
      check('exists', record !== null),
      check('name_matches', record?.name === args.name),
      check('email_matches', args.email === undefined || record?.email === args.email)
    ]
  };
}
```

Rules visible in that sketch: the verifier takes its own read; a cache-served read is not proof (confirm
the application's cache behaviour in `INTEGRATION_AUDIT_CHECKLIST.md` row 14); a verifier that cannot
read back marks the capability `UNVERIFIABLE` instead of reporting plausible success.

## Evidence result

Only ids, statuses and digests are recorded — never whole payloads:

```
EXECUTION_SUCCEEDED  toolResult: { capabilityId: "customer.create", ids: { customerId: "…" }, digest: "…", summary: "customer.create succeeded (customerId=…)" }
VERIFIED             verifier: customer.created, checks: [exists ✓, name_matches ✓, email_matches ✓]
```

## What this example deliberately does not do

It does not name real routes, it does not reveal how the collaborator's service authenticates, and it
makes no claim about his transaction or idempotency behaviour. Those belong in the filled-in
`CAPABILITY_MAPPING_WORKSHEET.md` for each capability, sourced from the real application.
