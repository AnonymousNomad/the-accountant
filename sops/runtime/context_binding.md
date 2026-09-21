# Context Binding — Binding Each Turn to the Trusted Context

## Objective
Bind every action cycle to the current trusted context — actor, workspace, task, capability snapshot,
workflow state, verified data only — and refuse the turn when the context is stale, missing, or mismatched.

## Prerequisites
- The session's configuration validated at startup; an invalid config prevents startup (F-28, I-9).
- The harness has built this turn's capability snapshot: `snapshotId`, `actorId`, `workspaceId`,
  capability ids + versions, registry/config hash, `createdAt`.
- `:capabilities` shows the snapshot that would be offered for the next request; `:evidence` shows the
  `CAPABILITIES_EXPOSED` record for the current run.
- The operator knows which actor and workspace this session serves; one session serves exactly one of each.

## Procedure
1. Read the turn's `USER_INSTRUCTION` and this run's snapshot before proposing anything; never reuse
   actor, workspace, or snapshot values from a previous turn.
2. Require the full snapshot identity: `snapshotId`, `actorId`, `workspaceId`, capability ids + versions,
   registry/config hash, `createdAt`. If any field is absent or malformed, refuse the instruction, do not
   propose, and escalate; an unrecordable refusal never executes anything (F-26).
3. Verify the actor matches the session's operator and the workspace matches the active workspace. On
   mismatch: no permit may be issued; the turn ends in a closed failure status (`REJECTED` if detected at
   validation, `DENIED` if it reaches policy) and is escalated as a context defect — never a silent re-bind.
4. Take capability selection only from this snapshot: only ids in the snapshot are proposable
   (`CAPABILITY_NOT_EXPOSED` otherwise); a capability remembered from an earlier turn is not executable,
   even if the id still exists in the registry.
5. Accept data from two sources only: the user's text for this instruction, and the harness's verified
   results (an `EXECUTED_VERIFIED` read whose values are ids, statuses, counts, safe summaries). Never
   from model memory, prior-turn values, or unverified tool text.
6. Check workflow state before proposing: a pending confirmation belongs to the turn and proposal hash
   that armed it; expired, consumed, or other-run confirmations are invalid (F-15). Do not carry a
   pending confirmation into a new turn.
7. Record the binding with the turn: journal `USER_INSTRUCTION`, `CAPABILITIES_EXPOSED` (snapshotId,
   contextHash, ids, definition hashes), and every later event for the run referencing the same snapshot.
8. Re-bind deliberately, not implicitly: if the registry or config hash changes mid-session, the turn
   fails closed; start a fresh session and re-issue the instruction.
9. Refuse with the exact reason when the context is stale or mismatched; never "retry with the same
   values" and never guess the missing identity from the request text.

## Gates
- G1: exactly one `snapshotId` per run, and it is the one journaled in `CAPABILITIES_EXPOSED`.
- G2: selection and execution validate against the same snapshot identity (registry/config hash equal).
- G3: every argument value traces to this turn's user text or a verified result; none to memory.
- G4: no confirmation armed in another turn can resolve in this one.

## Expected evidence
- `USER_INSTRUCTION`, `CAPABILITIES_EXPOSED` with `snapshotId` and `contextHash`, then the run's
  `PROPOSED`/`POLICY_DECISION`/lifecycle events carrying the same snapshot identity.
- CLI view via `:capabilities` and `:evidence`; chain integrity via `:verify-chain`.

## Failure conditions
- A snapshot field is missing or malformed: the instruction is refused before any model call; nothing
  executed; escalate.
- Actor/workspace mismatch, or a proposal against a stale snapshot: `REJECTED` or `DENIED` per the stage
  that detects it; never a silent rebind.
- A capability id from an earlier turn proposed after the registry changed: `REJECTED`
  (`CAPABILITY_NOT_EXPOSED` or `UNKNOWN_CAPABILITY`); the turn is not repaired.
- Any argument sourced from unverified text: the turn is invalid; stop and re-ask.

## Recovery / rollback
- Restart the session: pending confirmations and permits are discarded; authority never survives.
- Re-issue the instruction as a new run with a fresh snapshot; do not hand-edit journal records.
- Only a reviewed, recorded config change may alter exposure, permissions, TTLs, or the workspace; no
  change made to let one turn pass is permitted (F-12 doctrine).

## Completion criteria
- Every run's decision and execution events cite the same snapshot identity as `CAPABILITIES_EXPOSED`.
- No turn proceeded on a missing, stale, or mismatched context, and every refusal is explained by the
  last lifecycle event for the run (I-5).
