# Unsupported Operation — Saying No Plainly

## Objective
Define what to do when no capability can perform the request: say so plainly, name what does exist, and
never approximate. Worked example: a bank transfer.

## Prerequisites
- The turn's exposed capability snapshot; the request's effect understood in business terms.
- The scope rule: what this harness can do is defined by the registry, not by what an application or a
  bank could in principle do.

## Procedure
1. State the requested effect in business terms, then compare it against the exposed ids only:
   `customer.search`, `customer.create`, `customer.update`, `invoice.create_draft`, `invoice.preview`,
   `invoice.issue`, `ledger.query`, `journal.propose`.
2. If none can produce it, return exactly one envelope
   `{"kind":"unsupported","reason":"…","reasoningSummary":"…"}`; the run ends in `UNSUPPORTED`; nothing is
   proposed and nothing executes (F-11).
3. Say it plainly to the user: "No capability can transfer funds. Nothing was executed." Do not bury the
   refusal, do not apologise in place of information, and do not imply the request was handled.
4. Name what does exist, from the exposed set, so the user can re-aim; describe what each nearby
   capability actually does. Do not promise future capabilities and do not describe unexposed ones.
5. Never approximate: do not map "pay the supplier" onto `journal.propose` or `invoice.create_draft`, do
   not chain reads to imitate a result, and do not treat a ledger read as proof that money moved. An
   approximation would execute an effect the user did not request.
6. Worked example — "Transfer 2,400 to Smith Electrical": identifying the record with `customer.search` is
   allowed if the user asks for it, but no capability can move money. The reply states: no capability can
   transfer funds; nothing was executed; the closest supported effects are billing
   (`invoice.create_draft`, `invoice.issue`), ledger reading (`ledger.query`), and a draft journal entry
   for human review (`journal.propose`) — none of which pays anyone. Offer them only as descriptions;
   propose one only if the user then asks for it.
7. Record the refusal: `UNSUPPORTED_REQUEST` with the reason; no permit, no confirmation, and no execution
   records for the run.
8. Do not ask a clarification question for an unsupported request: nothing is missing that an answer could
   supply, and a question would falsely imply the harness can act.
9. Re-aiming is a new instruction: if the user asks for a supported effect, that is a new run with a new
   proposal and new authority.

## Gates
- G1: an unsupported turn contains exactly one envelope and one `UNSUPPORTED_REQUEST`.
- G2: no `AUTHORIZED`, `AUTHORITY_CONSUMED`, `EXECUTION_STARTED`, or `CONFIRMATION_REQUIRED` record exists
  for the run.
- G3: no capability outside the exposed set is named as available; no future capability is promised.
- G4: the reply says plainly that nothing executed.

## Expected evidence
- `UNSUPPORTED_REQUEST` with the reason text; the CLI transcript stating that nothing executed;
  `:evidence` showing no execution records, and `:capabilities` showing what was actually available.

## Failure conditions
- An approximation executes something the user did not ask for: process failure; report exactly what
  changed and escalate for compensation.
- A capability invented to satisfy the request: `REJECTED` (`UNKNOWN_CAPABILITY`); the turn is not
  repaired.
- "Impossible" claims about the world instead of the harness: say "no registered capability can do this" —
  scope honesty, not a promise about banking.
- A question asked for an unsupported request: process failure; correct it with a plain statement.

## Recovery / rollback
- Nothing to roll back: nothing executed, no permit, no confirmation was armed.
- If the user believes a capability should exist, the operator reviews the registry and config; adding one
  is a reviewed build-time act (capability onboarding), never a runtime improvisation.
- A re-aimed instruction starts clean: new run, new snapshot, new authority.

## Completion criteria
- The user was told plainly that no capability can perform the request and that nothing executed; the
  journal records the unsupported reason; no approximated or invented action exists.
