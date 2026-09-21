# Entity Resolution — From a Name to a Trusted Identifier

## Objective
Resolve a business reference such as "Smith Electrical" to a real identifier (`customerId`) by searching
first, never inventing identifiers, asking when several records match, and saying so when none does.

## Prerequisites
- `customer.search` (READ) is exposed for this turn; `customer.create` is exposed if creation is a
  plausible follow-up; both are validated against this turn's snapshot.
- The user's reference text is captured verbatim; no value is taken from memory.

## Procedure
1. Extract the literal reference from the user's instruction: a name or email fragment, as stated; do not
   normalise beyond trimming and case.
2. Search first: propose `customer.search` with `{ query }` (optional `limit`). For any later mutation,
   draft, or issue, never proceed with an identifier the user did not supply and no verified search
   returned.
3. Take the `customerId` from the verified search result only. The search's verifier re-executes the same
   deterministic read and compares (`read_reproduced`, `result_shape`); a failed verification makes the
   result unusable — go to the failure path, never to a guess.
4. Exactly one match: use that `CUS-nnnn` id and state which record was matched (id and name) in the
   summary, so the resolution is visible to the operator.
5. Several matches: do not choose, do not rank, do not pick the "most likely". Ask exactly one
   clarification question listing the candidates as safe summaries (id, name) and asking which one; if
   the user cannot decide, stop.
6. No matches: say plainly that no customer matched. If the user's intent is creation, propose
   `customer.create` with the stated name and optional email — never create a record to make a search
   succeed, and never re-search with invented terms. If the intent was to act on an existing record,
   report zero matches and ask.
7. Never invent or derive identifiers: no sequential guesses, no case or spelling variants used as ids,
   no placeholder shapes. The schema enforces `^CUS-[0-9]{4}$`, and a wrong-but-well-formed id also fails
   the verifier's `customer_exists` check if it ever executes.
8. Copy only the id, plus the fields the user actually stated, into arguments; do not carry other payload
   fields forward.
9. If `customer.search` is unavailable for the turn (filtered, denied, or not exposed), do not substitute
   a guess: report the real status (`DENIED`/`UNSUPPORTED`) and let the operator act.

## Gates
- G1: every executed `customerId` traces to a `customer.search` result verified in this session, or to
  the user's own explicit statement.
- G2: every ambiguous search produced exactly one question; every empty search produced a plain result
  report.
- G3: no id appears in any argument that was not observed in a verified result or the user's text.

## Expected evidence
- `customer.search` execution records plus `VERIFIED` with `read_reproduced` and `result_shape`.
- `CLARIFICATION_REQUESTED` for multi-match turns; `UNSUPPORTED`/`DENIED` when search was unavailable.
- The dependent action's journal slice showing the id, and its verifier check `customer_matches` where
  the capability provides it.

## Failure conditions
- An invented id proposed: `REJECTED` by the schema when the pattern fails, or a failed verifier check
  when the shape is right but no record exists; nothing is retried.
- Picking silently among several matches: process failure; the operator must re-issue with a specific
  record.
- Creating a duplicate instead of asking: a mutation executed without the user's ask; report exactly what
  changed and escalate for compensation as an operator decision.

## Recovery / rollback
- A wrong-but-existing id that executed is a real effect: do not retry; verify state, report exactly what
  changed, and escalate compensation as a recorded operator decision.
- A refused or unexecuted turn is recovered with a fresh instruction and a fresh search.
- Do not hand-edit the synthetic store or journal to undo a resolution mistake.

## Completion criteria
- The executed identifier is the one the verified search returned, and the record's name matches the
  user's reference; ambiguous and empty searches ended without an invented choice.
