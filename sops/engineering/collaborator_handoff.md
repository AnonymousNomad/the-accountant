# Collaborator Handoff — Inputs, Outputs, Adapter Location, and the Handoff Audit

## Objective
Define exactly what the harness team needs from the collaborator, what it will deliver, where a real adapter
lives, and how the handoff is audited by a stranger using the repository alone (REQ-043, REQ-060).

## Prerequisites
- `docs/ARCHITECTURE.md` and `docs/matrices/DECISION_MATRIX.md` (DM-01, DM-09) have been read before making
  any request; the request must not ask for anything already decided.
- The epistemic labels in use are fixed: OBSERVED, REPORTED BY COLLABORATOR, INFERRED, UNKNOWN, VERIFIED,
  REJECTED (`COLLABORATOR_AGENT_NOTES.md`).
- No proprietary implementation is assumed available; nothing is invented in its place.

## Procedure
1. Request, per candidate operation, the integration-contract checklist below; mark any unanswered field
   UNKNOWN rather than filling it from inference.
2. Request the read-back endpoint for at least one mutation and test it before claiming verification is
   possible (A-2); without a read-back the capability can never be `EXECUTED_VERIFIED`.
3. Ask whether mutating endpoints accept an idempotency key, and what happens on a repeated request (A-5);
   the answer decides the retry guidance, not the permit semantics.
4. Ask which operations are drafts, which are final, and which post amounts, so risk classes come from the
   owner's semantics rather than from route names (`sops/capability_risk_classification.md`).
5. Ask for the confirmation tolerance for FINANCIAL operations (A-4), the intended runtime and model (U6/U7),
   and whether multi-user permission mapping is needed for the first integration (open question 5).
6. Deliver, on the harness side: the generic core, `docs/ARCHITECTURE.md`, the integration contract,
   `sops/capability_onboarding.md` with the worked example, the adapter mechanism, the benchmark fixture and
   runner, the evidence format, and the failure taxonomy.
7. State the adapter-location decision: the real adapter, binding table, and headers file live in the
   collaborator's private repository (or a private package) that consumes the generic core, because they
   carry proprietary routes, product names, and credentials. This repository keeps only `integrations/`
   scaffolding that is generic and name-free.
8. If a core change is required for integration, make it here in the open (with tests) and keep the
   collaborator-specific adapter private; never import product names, routes, or credentials into this repo
   (SAH-REQ-047).
9. Label every statement in notes and docs with its epistemic label; a REPORTED claim is never promoted to a
   VERIFIED architectural fact without evidence recorded in `COLLABORATOR_AGENT_NOTES.md`.
10. Run the handoff audit procedure and record its results and dispositions in `docs/reviews/HANDOFF_AUDIT.md`.

Integration-contract checklist (per operation; all fields or an explicit UNKNOWN):
1. business intent in one sentence; 2. existing service and route (method + path); 3. request schema;
4. response schema including the identifier returned on success; 5. error/status semantics; 6. side effects
as state transitions; 7. transaction semantics (atomic, partial, or unknown); 8. read-back method that
reflects the effect; 9. authorizing permission/attribute; 10. idempotency support; 11. timeout and rate
limits; 12. whether the operation is draft-level or final/posting-level.

Handoff audit procedure:
1. Clone the repository into a clean directory on a machine without prior state and without installing packages.
2. Read `COLLABORATOR_AGENT_NOTES.md`, then `docs/ARCHITECTURE.md`, then this SOP; note anything that cannot
   be understood without private context.
3. Run `npm run verify` and record the full output and exit code.
4. Run `node src/cli.mjs --provider scripted --script fixtures/demo-script.jsonl` and record the transcript,
   including terminal statuses shown.
5. Run `npm run bench` and confirm the report contains the fixture hash and the taxonomy classes.
6. Extend the harness with one new capability using `sops/capability_onboarding.md` without reading private
   material; record where the procedure was insufficient.
7. Inspect `config/harness.config.json` and confirm the generic HTTP adapter is disabled and no credential
   material is present; inspect `.gitignore` for the headers file rule.
8. Write findings with dispositions into `docs/reviews/HANDOFF_AUDIT.md`; an unresolved BLOCKER means the
   handoff is not complete.

## Gates
- G1: no document, fixture, test, or config in this repository contains a collaborator product name, route,
  credential, customer datum, or proprietary specification.
- G2: every integration-contract field is answered or explicitly UNKNOWN; no inferred interface is treated
  as fact.
- G3: the handoff audit records real command output, not summaries or expectations.
- G4: the adapter-location decision is recorded and the private material is confirmed absent from this repo.

## Expected evidence
- The completed integration-contract checklist with sources and labels per field.
- `docs/reviews/HANDOFF_AUDIT.md` with command outputs, findings, and dispositions.
- A `COLLABORATOR_AGENT_NOTES.md` entry naming what was provided, received, and still UNKNOWN.

## Failure conditions
- A request that asks the collaborator to trust a verification path that does not exist: stop; the read-back
  is a prerequisite, not a nicety.
- A handoff deliverable that depends on a proprietary route or product name: rewrite or move it to the
  private adapter; the repository stays generic.
- Audit steps that cannot be executed by a stranger: record as a defect in the affected SOP or document and
  fix it before re-auditing.

## Rollback / recovery
- If an outbound artifact leaks proprietary detail, remove it from the working tree and any commit not yet
  shared, notify the operator, and record the incident; do not rewrite shared history silently.
- If a requested item is withdrawn or changes, mark the dependent capability onboarding as blocked and keep
  it unregistered rather than guessing the new semantics.
- Re-audit after any core change that alters the runnable surface, the config surface, or the evidence format.

## Completion criteria
- The collaborator has a checklist they can fill in without reading this repository, and the repository can
  onboard one operation from that checklist alone.
- The handoff audit is complete with dispositions, and no unresolved BLOCKER remains in
  `docs/reviews/HANDOFF_AUDIT.md`.
