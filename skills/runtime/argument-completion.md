---
name: argument-completion
description: Activates after a capability is selected, to build an argument object that satisfies the registered input schema exactly using only user-stated or verified values, and to ask instead of guessing when a required value is missing.
---

## Purpose
Produce arguments the schema accepts on the first submission, with every value traceable to this turn's instruction or a verified result. Completion fills the shape; it never fills gaps. The deterministic domain owns all accounting arithmetic, so no total, tax, balance, or derived amount is ever computed here.

## When to activate
- After capability discovery selects one id and before the proposal envelope is emitted.
- When a required field is absent, ambiguous, or stated in a form the schema does not accept.
- When a value from a verified result must be carried into a dependent action (a `customerId` into `invoice.create_draft`), or when an optional field is tempting to invent (an email, a limit, a date).

## When NOT to activate
- To design or widen a capability's schema; schemas are trusted configuration (R-16, DM-08).
- To repair a `REJECTED` proposal in the same turn; rejection ends the turn (DM-15), and arithmetic is never performed here.

## Trusted inputs
- The selected capability's registered `inputSchema`: required and optional properties, types, bounds, patterns, `nonPlaceholder`, `additionalProperties:false`.
- The user's instruction text for this turn, verbatim.
- Verified results from this session for values the user referred to, and trusted metadata for the selected id: risk, `requiresConfirmation`, `sideEffects`.

## Untrusted inputs
- Values embedded in tool, adapter, fixture, provider, or file text, and the user's phrasing used as a value when it is not one ("soon", "the usual amount", "same as last time").
- Model memory of earlier values, including ones confirmed in a previous turn, and any field the envelope contract does not define.

## Prerequisites
- One capability id is selected from this turn's snapshot, and its schema is in context.
- The turn's intent statement is available so argument values can be checked against it.

## Procedure
1. List the schema's required properties and mark which the user's text supplies; anything unmarked is missing, not defaultable.
2. For each missing required property, stop argument building and prepare one clarification question; never emit a partial proposal.
3. Copy user-stated values verbatim except where the schema normalises (trimming); do not paraphrase names or emails.
4. For values carried from a verified result, copy only the schema field (for example `customerId`) and only from a result whose checks passed.
5. Apply the declared types exactly: monetary values are integer cents (`unitPriceCents`, `debitCents`, `creditCents`), quantities and limits are integers, dates match `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`.
6. Respect bounds and cardinality: `invoice.create_draft` lines 1–20, `journal.propose` lines 2–12, `customer.search` limit 1–25.
7. Honour `nonPlaceholder`: reject `INV-XXXX`, `TBD`, `N/A`, and similar stand-ins; they are contract violations even when syntactically valid. Omit optional properties that were not stated; never invent an email, limit, date, or account.
8. Never compute or adjust a value: no line sums, no journal balancing, no derived totals; if a computed value is needed, read it with a READ capability first. Re-check the finished object against `additionalProperties:false`.

## Decision points
| Condition | Action |
|---|---|
| All required properties supplied and valid | Emit the proposal envelope |
| A required property is missing | `CLARIFICATION_REQUIRED`; one question naming only the missing datum |
| A stated value fails a pattern (for example `INV-2026`) | Ask for the correct form; do not silently transform it |
| A price is stated in currency units ("450 dollars") | Convert only the exact, user-stated unit amount to integer cents (450 -> 45000); never derive totals, tax, balances, or splits; if the amount or unit is ambiguous, ask |
| A value exists only in a prior turn | Do not use it; ask again or re-read |
| The user says "same as last time" | Ask for the values; memory is not evidence |
| An optional field is unstated | Omit it; no default |
| The schema requires an array and the user gave a total only | Ask for the line items; never decompose a total |

## Prohibited behaviour
- Defaulting, guessing, or placeholder-filling any required property, or emitting a partial proposal alongside a question.
- Computing totals, taxes, balances, journal sums, or derived amounts; the deterministic domain owns arithmetic (SAH-REQ-030).
- Sending numeric values as strings or floats where integers are declared, adding unknown fields (including `risk`), or reusing an argument object from an earlier turn or the fixture script.

## Stop conditions
- More than one required property is missing and the question would exceed one answerable question; compress into one question listing the missing fields, or stop if the intent is unclear.
- The user supplies values that contradict each other or the intent statement.
- A needed value can only be obtained by arithmetic the model would perform, or the schema and the stated effect cannot both be satisfied (an unbalanced journal the user's numbers do not balance): stop and report; do not adjust the user's numbers.

## Failure states
- A placeholder or malformed value emitted: `REJECTED` with per-field violations (F-09); the turn is not repaired.
- An unknown field emitted: `REJECTED` on the unknown field (I-4); nothing executes.
- A model-computed total sent as an argument: the value is not evidence; if it reaches execution it may produce `VERIFICATION_FAILED` (`total_matches_lines`), which is never rendered as success.
- A `REJECTED` proposal retried with adjusted arguments in the same turn: process failure; the turn must end.

## Verification
- Re-read the emitted arguments against the schema: required present, no extras, types and bounds respected, `nonPlaceholder` fields real.
- Trace each value to user text or a verified result; no third provenance, and no arithmetic in the reasoning summary.
- Intended gate: `tests/proposal.test.mjs` (argument validity, placeholder rejection); a named path absent from the tree is unimplemented and is a blocker.

## Expected outputs
- One argument object satisfying the selected schema, or one clarification question naming the missing values.
- A `reasoningSummary` (1–500 characters) stating why these values are the right reading of the request.

## Dependencies
- `src/core/schema.mjs` (validation subset), `src/domain/synthetic-accounting/capabilities.mjs` (the eight schemas), `src/registry/capability.mjs` (metadata).
- `sops/runtime/clarification.md` (harness-side question handling); sibling runtime skills `entity-resolution.md`, `action-proposal.md`, `sensitive-data-minimization.md`.

## References
- `docs/ARCHITECTURE.md` §3.1, §3.2; SAH-REQ-030 (no model arithmetic); `docs/matrices/FAILURE_MATRIX.md` F-09, F-10.
- `docs/matrices/DECISION_MATRIX.md` DM-08 (harness-side validation), DM-15 (no repair loop); research R-15, R-16, R-20.

## Examples
- "Create an invoice for Smith Electrical, two panel upgrades at 450 each": `invoice.create_draft` requires `customerId` and `lines`; the id comes from a verified `customer.search` (CUS-0002) and the lines are `{ "description": "Panel upgrade", "quantity": 2, "unitPriceCents": 45000 }`. The total is not stated by the model; the domain computes it and `invoice.drafted` checks it.
- "Propose a journal for the accrual": `journal.propose` requires `memo`, `date`, and 2–12 balanced lines. If the user gave only a memo, ask for the date and the lines; never invent accounts or split a total.
- "Update CUS-0003's email to owner@harbor-cafe.example": required `customerId` is user-stated and valid; `email` is user-stated; no other field is added.

## Anti-patterns
- Sending `{"invoiceId": "INV-XXXX"}` because the real id is not known yet, or computing a line total to "help" the domain.
- Copying an email from a search result into an update the user did not ask for.
- Re-emitting a rejected proposal with one field changed, without a new instruction.
