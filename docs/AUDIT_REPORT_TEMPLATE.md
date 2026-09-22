# Audit Report Template

For any audit of this harness, of an incoming application, or of an integration. Findings are
classified; **style preferences are not defects.**

## Classification

| Class | Meaning | Requires |
|---|---|---|
| OBSERVATION | a fact about the system, stated without judgement | evidence |
| DEFECT | the system does not do what its own contract says, or is unsafe | evidence + reproduction |
| RISK | the system behaves as documented but the consequence is dangerous | evidence + impact |
| INTEGRATION_DEPENDENCY | depends on an external fact not yet available (a route, a schema, an idempotency guarantee) | the question that resolves it and who can answer |
| IMPROVEMENT | a change that would be better but is not required | rationale, and why it is not required now |

A finding may not be reclassified upward without new evidence. "I would have written it differently" is
not a defect; if it changes behaviour or safety, it is.

## Finding format

```
ID:            AUD-<n>
CLASS:         OBSERVATION | DEFECT | RISK | INTEGRATION_DEPENDENCY | IMPROVEMENT
SUMMARY:       one sentence, no adjectives
EVIDENCE:      command + output, file/line, or measured number
AFFECTED PATH: component(s) and the trust boundary crossed
UPSTREAM/DOWNSTREAM IMPACT: what else changes if this is true
REPRODUCIBLE:  yes/no + exact steps
SEVERITY:      only where justified (blocker / high / medium / low) + why
PROPOSED ACTION: bounded, smallest effective change
VERIFICATION REQUIRED: the test or command that proves the action worked
STATUS:        open | fixed | accepted risk | deferred | false positive
```

## Severity rules

- **blocker** — an authority bypass, an unsafe execution, a false verified result, or an inability to
  verify a consequential write.
- **high** — a control that fails open, an unreconstructable audit trail, a mapping that would let the
  model choose an endpoint.
- **medium** — behaviour that degrades safely but visibly misleads an operator.
- **low** — inconvenience or documentation drift.
- No finding is closed without either a verification or an explicit accepted-risk statement naming who
  accepted it.

## What must not appear

- Style, naming or formatting preferences presented as defects.
- Claims about an external application that were not observed (mark them
  INTEGRATION_DEPENDENCY, with the question).
- Severity without impact reasoning.
- "Should work" as verification.
