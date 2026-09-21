---
name: confirmation-binding
description: Binds a user's "yes" to exactly one deep-frozen proposal in the turn it was asked, so approval cannot be laundered, reused, or replayed into executing different arguments.
---

## Purpose
Define the lifecycle of a pending confirmation: arm on `CONFIRMATION_REQUIRED`, freeze the exact proposal,
resolve only on the next user input and within `confirmation.ttlSeconds`, consume once, and journal each
transition. A confirmation records intent; it is never authority — the permit is (DM-05).

## When to use
- Implementing or reviewing `src/policy/confirmations.mjs` and the confirmation branches in `src/harness.mjs`.
- Adding a new approval surface (interactive CLI prompt, `--confirm` flag, future UI control).
- Investigating a `CONFIRMATION_REJECTED` status or tuning `confirmation.ttlSeconds`.
- When a capability changes to `requiresConfirmation:true` (typically FINANCIAL).

## When NOT to use
- To grant permission or widen policy: confirmations never substitute for `ALLOW` (DM-05(a) rejected).
- To design capability schemas or risk classes (see `semantic-capability-design`).
- To change permit TTL or binding rules (see `execution-authority-design`).

## Prerequisites
- The proposal is validated, deep-frozen, and hashed before a confirmation is armed (I-3, T-08).
- `src/policy/confirmations.mjs` owns the pending store: at most one live confirmation, keyed by `confirmationId` and bound to `armedTurn`.
- `config/harness.config.json` carries `confirmation.ttlSeconds` (default 120); the clock is injectable; the turn counter increments for every user instruction.

## Inputs
- The frozen proposal object, its `proposalHash`, capability, and registry risk.
- The turn that armed the confirmation and the current turn.
- The user's literal answer or the explicit `--confirm` flag, plus the TTL and the injected clock.

## Procedure
1. When policy returns `CONFIRMATION_REQUIRED`, arm exactly one pending confirmation holding `{confirmationId, proposalHash, frozenProposal, capability, risk, armedTurn, expiresAt, state:"PENDING"}`.
2. Render the confirmation from the frozen object so the operator sees capability, risk, and the exact arguments — the same bytes that will execute, not a summary that could differ (B-1).
3. Journal `CONFIRMATION_REQUIRED` with the hash and the redacted arguments.
4. Resolve only in the immediately following user input: a confirmation resolves only when `armedTurn === currentTurn` (DM-13, SAH-REQ-019, T-05).
5. Accept only an unambiguous affirmative from the documented token set (interactive `yes`); anything else, including paraphrases a parser might guess at, resolves as a rejection.
6. Check `expiresAt` at resolution time against the clock; an expired confirmation is rejected with a typed stale/expiry reason and swept (F-15).
7. Consume the pending confirmation exactly once, synchronously; a second answer for the same `confirmationId` is rejected (F-15).
8. On grant, journal `CONFIRMATION_GRANTED` and then let `execution-authority-design` step 5 issue the permit bound to `proposalHash` and `confirmationId`; the confirmation handler itself executes nothing.
9. On rejection, journal `CONFIRMATION_REJECTED` with the reason; the terminal status is `CONFIRMATION_REJECTED`, no permit is issued, and no permit is retained (F-14).
10. Clear any pending confirmation at the start of a new instruction, because a new `runId` invalidates earlier approvals (DM-13).
11. For the `--confirm` flag: record `CONFIRMATION_GRANTED` with `source: "cli-flag"`; it is equivalent to typing yes, is visibly labelled in output, and never bypasses policy or the permit (M-4, SAH-REQ-038).
12. Test the adversarial set: stale yes, ambiguous yes, replayed yes, expired confirmation, substituted hash, and a second model response between approval and execution (B-1, T-05, T-08).

## Decision points
| Condition | Action |
|---|---|
| Answer arrives in a later turn | Reject as stale; the operator re-issues the instruction (DM-13) |
| More than one live pending confirmation | Never resolve; that is ambiguity — prevent arming more than one, or reject all |
| Hash at resolution differs from hash at arm time | Reject; investigate as a security event (T-08) |
| FINANCIAL capability with `requiresConfirmation:false` | Registration defect; fix the capability, not the flow |
| User answers with a modification ("yes, but change the date") | Not an affirmation; a new proposal with a new id is required |
| `--confirm` used in a script | Journalled as `cli-flag`; the operator remains the actor; no extra privileges (M-4) |
| TTL is too short in practice | Change `confirmation.ttlSeconds`; never extend one confirmation's expiry |
| No human is available for a FINANCIAL action | Do not execute; there is no auto-approval path (T-16) |

## Failure conditions
- Rendering a summary, label, or reformatted arguments instead of the frozen object.
- Matching an affirmation by capability name, by substring, or by similarity to "yes".
- Keeping a PENDING confirmation indefinitely, or across instructions.
- Reusing a confirmation after `CONFIRMATION_GRANTED`; accepting `"y"`/`"ok"`/`"go ahead"` when they are not in the documented token set.
- Executing inside the confirmation handler before the permit exists.

## Stop conditions
- More than one live PENDING confirmation, or a confirmation whose proposal cannot be hashed back to the recorded `proposalHash`.
- A confirmation is bound to a run or turn you cannot identify (`armedTurn` missing or mutated).
- The user's input is ambiguous between affirmation and refusal — reject; never guess.
- Resolving the confirmation would require re-parsing model output (B-1).

## Security considerations
- The freeze is the defense against approval laundering: a second model turn can produce different arguments, and only the frozen object may execute (T-08, B-1).
- Confirmation is intent, not authority: without a bound, unexpired, single-use permit nothing runs (DM-05).
- Turn binding and TTL implement the stale-approval control; both are required, neither alone is sufficient (T-05, DM-13).
- No component other than the operator can affirm: model output is never treated as a confirmation; CLI output must state what was approved and that execution still awaits independent verification (L-2 wording discipline).

## Verification
- `tests/confirmations.test.mjs` and `tests/security.test.mjs`: stale, ambiguous, replayed, expired, and hash-mismatched confirmations rejected.
- Benchmark B17–B19 exercise confirmation classes deterministically (R-40, R-41).
- Journal sequence for an approved action: `CONFIRMATION_REQUIRED` → `CONFIRMATION_GRANTED` → `AUTHORIZED` with the same `proposalHash`; for a rejection: `CONFIRMATION_REJECTED` and no `AUTHORIZED` (I-5).
- Hash equality is asserted between the object shown at confirmation time and the object passed to the adapter (I-3).

## Expected outputs
- An armed `PENDING` confirmation with the rendered, exact arguments and a journal record.
- A typed resolution: `CONFIRMATION_GRANTED` or `CONFIRMATION_REJECTED` with its reason and terminal status.
- On grant, at most one permit whose `confirmationId` matches, expiring on its own shorter TTL.

## Dependencies
- `src/policy/confirmations.mjs`, `src/policy/authority.mjs`, `src/policy/policy-engine.mjs`
- `src/harness.mjs`, `src/cli.mjs`, `src/evidence/journal.mjs`, `config/harness.config.json`

## References
- R-33 (MITRE CWE-367) — approving one object and executing another is the substitution class this binding closes.
- R-34 (RFC 6749 §10.5; RFC 7519) — single-use, short-lived, audience-bound artifacts.
- R-35 (IETF idempotency-key draft; Stripe) — replay semantics; a consumed confirmation is refused, not replayed.
- R-36 (NIST SP 800-92; SP 800-53 AU-2/AU-9) — the approval and its arguments must be recoverable from audit records.
- R-39 (Microsoft Learn: reversing entry) — one-way operations make confirmation cost real; corrections are reversals.
- DM-05, DM-13, DM-06; F-14, F-15; T-05, T-08; B-1, M-4, M-7.

## Examples
- Instruction "issue INV-0004": policy returns `CONFIRMATION_REQUIRED` and the CLI prints `invoice.issue · risk FINANCIAL · invoiceId INV-0004`. The next input `yes` yields one permit bound to that hash, then `EXECUTED_VERIFIED` after the verifier re-reads state.
- Counter-example: the same `yes` three turns later is rejected as stale; the operator must re-issue the instruction, producing a new proposal and a fresh confirmation.
- Counter-example: "yes, and make it INV-0005" is not an affirmation; the model must produce a new proposal with a new `proposalId`, which needs its own confirmation.

## Anti-patterns
- Storing a display string rather than the frozen proposal object.
- Matching the confirmation by capability name or by "contains yes".
- Keeping a pending approval around "just in case the user comes back".
- Treating the CLI button or `--confirm` as a policy override, or auto-approving FINANCIAL actions non-interactively.
- Executing in the confirm handler and journaling afterwards.
