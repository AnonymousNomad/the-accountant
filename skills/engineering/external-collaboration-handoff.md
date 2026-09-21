---
name: external-collaboration-handoff
description: Maintains COLLABORATOR_AGENT_NOTES.md and the handoff evidence pack with strict epistemic labels; use at every phase transition, before any claim or document reaches the external collaborator, or when integrating a reported-but-unverified fact.
---

## Purpose
Make the repository self-sufficient for a stranger and honest with the collaborator. Every statement carries an epistemic label, every claim is traceable to a recorded command, and a person with no context can run, test, extend, benchmark, and understand the limits from the repository alone (directive §25, SAH-REQ-060).

## When to use
- Starting or ending a phase in `COLLABORATOR_AGENT_NOTES.md` (State, Work Completed, Change Log, Next Smallest Step).
- Recording a decision, a rejection, a reversal, a blocker, an open question, or a new unknown.
- Receiving any input from the collaborator (routes, encryption, tax regions, runtime plans) before it is used in design.
- Preparing `docs/INTEGRATION_CONTRACT.md`, `docs/EVIDENCE.md`, or a document the collaborator will read.
- Before any wording that could be read as a capability, safety, or completeness claim (critic item H-9).

## When NOT to use
- As a substitute for the decision, assumption, threat, failure, or dependency matrices. Each keeps its own record and is updated in the same change (SAH-REQ-051).
- As a place for secrets, credentials, proprietary collaborator details, or private reasoning. The file is for engineering conclusions and evidence only.
- As a chat transcript or a scratchpad. Entries are durable and reviewed.

## Prerequisites
- `COLLABORATOR_AGENT_NOTES.md` exists and is read before any work in the repository (Handoff Instructions §1).
- The label vocabulary is agreed and used verbatim: `OBSERVED`, `REPORTED BY COLLABORATOR`, `INFERRED`, `UNKNOWN`, `VERIFIED`, `REJECTED`.
- Requirement statuses follow `docs/REQUIREMENTS_TRACEABILITY.md`: a requirement is complete only when implementation and recorded verification evidence both exist.
- The no-guessing rule is in force: do not invent a route, schema, service boundary, or key-custody design (A-1..A-6, directive SOURCE / IP BOUNDARY).

## Inputs
- Phase work results, command output, test output, benchmark reports, review findings.
- Collaborator statements, relayed by the operator, with their provenance noted (U1..U8).
- Decision records from `docs/matrices/DECISION_MATRIX.md` and the durable summary in the notes file.
- The matrix IDs (F-, T-, DM-, A-, R-, SAH-REQ-) that the entry must cite.

## Procedure
1. Read the notes file, then `README.md`, then `docs/ARCHITECTURE.md`, then `docs/matrices/DECISION_MATRIX.md` before proposing any structural change (Handoff Instructions §1-2).
2. Label every new statement immediately with one of the six labels; keep table rows for unknowns (`U1..U8`) rather than burying them in prose.
3. Keep a `REPORTED BY COLLABORATOR` claim reported until verification evidence exists. To promote it, record the command, the observed output, the date, and the actor, and only then relabel it `VERIFIED`.
4. Write every decision in the eight-part record format used by D-001..D-004: decision, reason, evidence, alternatives considered, rejected because, consequence, reversibility, affected files, verification status (directive §7). Mirror it into `docs/matrices/DECISION_MATRIX.md`.
5. Update the affected matrix in the same change as the work: threat, failure, dependency, assumption, or decision; update requirement status only when evidence exists.
6. Record every verification claim as an exact command plus its captured output; put the transcript in `docs/EVIDENCE.md`. A claim without recorded output is not evidence.
7. Maintain `docs/INTEGRATION_CONTRACT.md` against the required fields of SAH-REQ-043: semantic operation, existing service or route, method, request/response schema, permission, side effects, transaction semantics, verification method, and risk class. Mark each section's epistemic status (SAH-REQ-044).
8. Keep the repository generic: no collaborator product name, branding, proprietary route, or specification anywhere in code, docs, fixtures, or tests (SAH-REQ-047).
9. Record rejected work with its reason (for example, a rules-based intent parser), so the same proposal is not re-litigated (Work Rejected).
10. Explain provenance for reused concepts: reference-implementation ideas are credited in `docs/RECONNAISSANCE.md`; no code was copied because the reference licence was not fetched (D-003, R-51..R-55).
11. Run the stranger test before declaring a handoff: fresh clone, no credentials, README path, `npm run verify`, `npm run bench`, add one capability via `sops/capability_onboarding.md`, then read the limits. Record every gap as a blocker, not a note (SAH-REQ-060).
12. Record benchmark claims with the full arm definition, hashes, and contamination declaration; never circulate a number without them (R-42, R-44, R-46, R-47).
13. End every phase with a `Next Smallest Step` and an explicit open-questions list; never leave the reader to infer the next action.
14. Log the change with date, actor, type, and summary in the Change Log, including failed or reverted attempts.

## Decision points
| Condition | Action |
|---|---|
| New collaborator statement arrives | Record with `REPORTED BY COLLABORATOR`; keep the row open until tested (U1..U8) |
| A claim cannot be evidenced | Label `INFERRED` or `UNKNOWN`; propose a verification method, do not assert it |
| A decision reverses an earlier one | Add a Decision Reversals entry naming the superseded decision and the new evidence |
| Work is rejected | Record what and why under Work Rejected |
| A stranger cannot run or test the repository | Treat as a handoff blocker; fix before claiming readiness (SAH-REQ-060) |
| A document would imply verified model quality without a model arm | Remove the implication; keep model-quality columns `UNMEASURED` (L-4, H-9) |

## Failure conditions
- A reported claim appears as fact anywhere downstream — epistemic breach; correct the notes and any design input that consumed it.
- A decision lacks alternatives and a rejection reason — incomplete record, re-do it (directive §7).
- A requirement is marked complete without evidence — invalid status; revert to `NOT VERIFIED` (SAH-REQ-012 statuses).
- A collaborator name or proprietary detail appears in the repository — IP-boundary breach; remove and record.

## Stop conditions
- A design input depends on an untested collaborator claim — stop and record it as an assumption with a verification method first.
- A claim of completion has no recorded command output — stop; do not write it.
- A requested change would widen authority to make a check pass — stop and record why (Handoff Instructions §5).
- A document is about to claim "safe", "verified", or "complete" beyond the closed status set and recorded evidence — stop (H-9).

## Security considerations
- The notes file is the durable record but is not a secret store; anything written there is handed over and may be quoted back.
- Epistemic discipline is a security control: an unverified route or auth assumption becoming an architectural fact is how the integration silently drifts toward untruth.
- Benchmark and evidence artefacts must be free of credentials, collaborator data, and proprietary detail (T-13).
- Provenance hygiene: unreviewed third-party code is never vendored or copied (D-003, T-19).

## Verification
- Review of `COLLABORATOR_AGENT_NOTES.md` for required sections and current State, Work Completed, and Change Log entries (SAH-REQ-048).
- `scripts/lint.mjs` asserts required document presence, required section headings, the skill section structure, and the absence of collaborator names (SAH-REQ-042, SAH-REQ-047, SAH-REQ-048, SAH-REQ-052).
- The stranger test is recorded in `docs/reviews/HANDOFF_AUDIT.md` with the exact commands a newcomer ran (SAH-REQ-060).
- A complete `docs/EVIDENCE.md` transcript accompanies any status move in `docs/REQUIREMENTS_TRACEABILITY.md`.

## Expected outputs
- An updated `COLLABORATOR_AGENT_NOTES.md` with labelled entries. Updated matrices in the same change. Evidence transcripts. An integration contract whose sections state their epistemic status. A handoff audit a newcomer can reproduce.

## Dependencies
- `COLLABORATOR_AGENT_NOTES.md`, `docs/matrices/*.md`, `docs/REQUIREMENTS_TRACEABILITY.md`.
- `docs/ARCHITECTURE.md`, `docs/reviews/*.md`, `docs/INTEGRATION_CONTRACT.md`, `docs/EVIDENCE.md`.
- `sops/capability_onboarding.md`, `scripts/lint.mjs`, `scripts/verify.mjs` (`npm run verify`), `npm run bench`.

## References
- Directive §7 (decision record format), §25 (handoff completeness), and the SOURCE / IP BOUNDARY section.
- R-46 NeurIPS reproducibility checklist (STANDARD); R-42 BFCL v4 format sensitivity (PRIMARY); R-44 BFCL/tau2 version pinning and non-comparable subsets (PRIMARY); R-47 Zhou et al. contamination (PRIMARY).
- R-51..R-55 reference implementation inspection, ideas reused and no code copied (reference implementation source; licence not fetched).
- Assumptions A-1..A-6, A-12; critic findings H-9, L-4; requirements SAH-REQ-042..SAH-REQ-044, SAH-REQ-047, SAH-REQ-048, SAH-REQ-051, SAH-REQ-060, SAH-REQ-061.

## Examples
- Promoted claim: "AES-256-GCM is used somewhere" starts as `REPORTED BY COLLABORATOR` (U2). It becomes `VERIFIED` only after a named command against a named artefact shows the ciphertext and key handling, with the transcript in `docs/EVIDENCE.md`.
- Decision entry: D-004 records the synthetic domain choice with alternatives, rejection reasons, affected files, and a pending verification status.
- Stranger test: a fresh clone reaches `npm run verify` and `npm run bench`, adds a demo capability through the onboarding SOP, and reads the limits section; gaps are filed as blockers in the handoff audit.
- Integration answer: for the collaborator's first mutating operation, the contract states the required read-back and idempotency-key answer as `UNKNOWN` until their system supplies it (A-2, A-5).

## Anti-patterns
- Promoting a sentence from a call or message into an architectural fact.
- Updating the notes without the matrices, or the matrices without the notes.
- Status changes without an evidence transcript.
- Writing for the collaborator in a voice that implies unverified capability.
- Letting the same rejection be re-proposed because it was never recorded.
- Copying reference-implementation code while its licence status is unverified.
