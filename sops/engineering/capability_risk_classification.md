# Capability Risk Classification — READ, DRAFT, MUTATION, FINANCIAL

## Objective
Assign exactly one risk class to every capability from the operation's semantics, so that policy and
confirmation behaviour follow from trusted metadata and never from a model's description of the action.

## Prerequisites
- The operation's documented request, response, side effects, and read-back exist (`docs/INTEGRATION_CONTRACT.md`).
- `src/policy/risk.mjs` (enum) and `src/policy/policy-engine.mjs` (allowlist, confirmation rule) are in force.
- `config/harness.config.json` `policy.requireConfirmationFor` is read before classifying: a class in that
  list always resolves to `CONFIRMATION_REQUIRED` for every capability that carries it.

## Procedure
1. Ask first: does the operation change any durable state at all? If no, stop — the class is `READ`.
2. Ask next: does it create or edit an object that is explicitly non-final (draft), has no financial
   effect, and can be discarded or overwritten without a posting? If yes, the class is `DRAFT`.
3. Ask next: does it change durable non-financial state (master data, a non-financial status) so that
   later reads see the change? If yes, the class is `MUTATION`.
4. Ask last: does it post, finalize, settle, void, or move an amount, or make a document final or
   financial-record-bearing, with correction only by an offsetting/reversing entry? If yes, the class is `FINANCIAL`.
5. Apply the ambiguity rule: if any answer is unclear, or the class would change with an argument value,
   or the only evidence is the route name or HTTP method, or transaction semantics/read-back are unknown —
   stop, ask the operation owner, label the item UNKNOWN in `COLLABORATOR_AGENT_NOTES.md`, and do not register.
6. Record the class and the one-sentence justification beside the capability definition; the justification
   must name the state transition, not the UI label.
7. Register the capability; registration and policy tests for the class must run before exposure.
8. Re-run `npm run verify` after any class change and re-check confirmation and permission behaviour.

Decision table (apply in order; first matching row wins):
| # | Question | Class | Consequence in policy |
|---|---|---|---|
| 1 | No durable state change | `READ` | Allowed by default; no confirmation |
| 2 | Non-final draft only, discardable, no financial effect | `DRAFT` | Allowed; no confirmation unless configured |
| 3 | Durable non-financial change | `MUTATION` | Allowed when permission is granted; no confirmation by default |
| 4 | Posting, finalizing, settling, voiding, or amount movement | `FINANCIAL` | Always requires confirmation; allowlist entry required |

Worked examples — the 8 synthetic capabilities:
| # | Capability | Operation | Class | Justification |
|---|---|---|---|---|
| 1 | `customer.read` | read a customer record | `READ` | No durable state change |
| 2 | `invoice.read` | read an invoice and its lines | `READ` | No durable state change |
| 3 | `invoice.create` | create a mutable draft invoice | `DRAFT` | Non-final object, no posting, discardable |
| 4 | `journal.propose` | propose draft journal lines | `DRAFT` | Drafts only; posting is a separate capability (R-39) |
| 5 | `customer.create` | create a customer master record | `MUTATION` | Durable non-financial state; later reads see it |
| 6 | `customer.update` | update customer master data | `MUTATION` | Durable non-financial state; no amount moves |
| 7 | `invoice.issue` | `POST /api/v2/invoices/{id}/post` | `FINANCIAL` | One-way DRAFT->ISSUED; document becomes final |
| 8 | `ledger.post` | post ledger entries | `FINANCIAL` | Amount-bearing posting; correction only by reversal |

Who may change a risk class:
- Only the operator, as a reviewed change to trusted metadata (`src/domain/synthetic-accounting/capabilities.mjs`
  or the equivalent pack), never the model, never a runtime value, never a config default silently substituted.
- Required evidence for any change: the operation owner's written semantics; the requested class and the
  one-sentence justification; the diff; the policy/confirmation test output from `npm run verify`; and a
  `COLLABORATOR_AGENT_NOTES.md` entry naming the actor and date.
- A downward change (`FINANCIAL` -> any lower class) additionally requires a second reviewer's approval and
  an explicit entry in `docs/matrices/DECISION_MATRIX.md`. Never lower a class to make a test, demo, or
  benchmark pass.

Prohibition on model influence:
- `risk` is never accepted from a proposal (I-4); a proposal carrying a `risk` field is rejected as malformed
  (`PROPOSAL_REJECTED`), because unknown fields are rejected.
- Model text asserting "this is only a draft", "this is safe", or "no confirmation needed" is untrusted data
  (T-01) and changes nothing; the class is already fixed before the turn begins.
- The model may not negotiate, restate, or request a class; reviewers must not copy model wording into a
  justification.

## Gates
- G1: every registered capability has exactly one enum class and a one-sentence justification.
- G2: every `FINANCIAL` capability has `requiresConfirmation: true` and a matching allowlist + confirmation config.
- G3: the classification table above and the registry agree; a disagreement is a defect in whichever is stale.
- G4: no capability is exposed before its registration tests and policy tests have run.

## Expected evidence
- The capability definition (risk field), the justification line, and the test names for its class.
- `npm run verify` output for policy, registration, and confirmation tests after any change.
- Decision/notes entries for every class change, including reviewer names for downward changes.

## Failure conditions
- Ambiguity in step 5 handled by guessing: treat as a process failure; revert the registration and reclassify.
- A capability registered with a class that contradicts its read-back semantics: stop exposure, reclassify,
  re-run the battery; do not compensate in policy code.
- A proposal containing `risk`, or a config edit that lowers a class without evidence: fail closed, deny,
  escalate as a security event.

## Rollback / recovery
- Restore the previous class from version control, re-run `npm run verify`, and record the reversal.
- If a lower class was exposed and acted on, treat resulting evidence as suspect, keep the journal intact,
  and open a review entry; do not delete records.
- If confirmation config was widened, restore `requireConfirmationFor` to the reviewed value in the same change.

## Completion criteria
- Every capability's class is derivable from the decision table and is reproducible by a reviewer reading
  only the operation's documented semantics.
- No path exists where model output, argument values, or route names influence a class at run time.
