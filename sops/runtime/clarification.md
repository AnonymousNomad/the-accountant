# Clarification — Asking Instead of Proposing

## Objective
Define when the turn must ask instead of proposing, how to ask exactly one precise question, and how
to record that a clarification was requested.

## Prerequisites
- The turn's capability snapshot and the selected candidate's `inputSchema` are in context; required
  fields are read from the snapshot, never from memory.
- The user's stated values for those fields are known; anything absent is missing, not defaultable.

## Procedure
1. Determine the intended effect in business terms and the one or two exposed capabilities that can
   produce it.
2. Ask instead of proposing when any of these is true: a required field is absent; a value is ambiguous
   (two or more records or readings match); a reference cannot be resolved to an id; two capabilities
   fit equally and the difference changes the effect.
3. Never fill a gap: no defaults, no placeholders, no invented identifiers, emails, dates, amounts,
   accounts, or line items. A guessed value is a contract violation (F-09).
4. Ask exactly one question, answerable in one turn: name only the missing datum (and, when useful, the
   shape it must take). If more than one required value is missing, include them as a short list inside
   that one question; never ask two separate questions.
5. Never ask for values already present in the request or already verified in this session.
6. Emit exactly one JSON object and nothing else:
   `{"kind":"clarification","question":"…","reasoningSummary":"…"}`; no proposal, partial or otherwise.
7. Record the request: the harness journals `CLARIFICATION_REQUESTED`; the run's terminal status is
   `CLARIFICATION_REQUIRED`; nothing executes and no permit is created.
8. When the missing value is a business identifier the user has described, resolve it with a READ
   capability first (entity resolution); ask the user only for what a read cannot establish.
9. When the request's effect cannot be produced by any capability, do not ask — that case is unsupported
   and must be stated plainly; a question would imply the harness can do it.

## Gates
- G1: exactly one clarification envelope per turn; a proposal never accompanies a question.
- G2: the question asks only for missing data, in one question.
- G3: `CLARIFICATION_REQUIRED` is explained by `CLARIFICATION_REQUESTED` as the run's last event (I-5).
- G4: no `AUTHORIZED`, `AUTHORITY_CONSUMED`, or `EXECUTION_STARTED` record exists for the run.

## Expected evidence
- `CLARIFICATION_REQUESTED` with the question text and a safe list of the missing fields; `:evidence`
  shows no execution records and no permit for the run.
- CLI transcript showing the single question and the terminal status.

## Failure conditions
- A value is guessed or defaulted: `REJECTED` (schema violation or placeholder) with nothing executed.
- A partial proposal is emitted alongside a question: `REJECTED`; the turn is not repaired.
- Several questions, or a question about already-known data: SOP violation; abandon the turn and
  re-issue the instruction.
- Asking when the effect is unsupported: process failure; correct it with a plain `unsupported` reply.

## Recovery / rollback
- The user answers; the next instruction is a new run with a fresh snapshot and fresh authority.
- A clarification never arms a confirmation and never reserves a permit; there is nothing to roll back.
- If answers keep arriving incomplete, re-ask one precise question; never escalate to a guess.

## Completion criteria
- Every missing-data turn ended in exactly one question and `CLARIFICATION_REQUIRED`.
- The following turn produced either a complete, schema-valid proposal or another single question; no
  invented value appears anywhere in the transcript.
