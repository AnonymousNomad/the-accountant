---
name: agent-threat-modeling
description: Produces and maintains threat rows for any new capability, adapter, prompt input, or authority path in Sovereign Action Harness, with a concrete control location, detection signal, residual risk, and a named regression test.
---

## Purpose
Answer "how does an untrusted model or data stream make this system do something the operator did not
intend?" with a row in `docs/matrices/THREAT_MATRIX.md`: actor, entry point, asset, likelihood, consequence,
control with a code location, detection via evidence, honest residual, and the test that fails if the control regresses.

## When to use
- Onboarding a capability, enabling `adapters.http`, or adding any new path by which content reaches a prompt.
- Changing permit, confirmation, evidence, redaction, or policy behaviour (authority paths).
- Adding a deferred feature to the trigger list (rate limiting, memory, signing, repair loops).
- When the operator asks "what could go wrong" about a proposed change.

## When NOT to use
- As a substitute for the design critic gate (`docs/reviews/DESIGN_CRITIC.md`) or for implementation review.
- For defects with no threat content (typos, formatting, benchmark math) — those are ordinary findings.
- To justify a control by citing a threat that is out of scope (host compromise, A-7) without saying so.

## Prerequisites
- `docs/matrices/THREAT_MATRIX.md` read, including columns and the mitigation legend (D/P/X).
- `docs/ARCHITECTURE.md` §5 (trust boundaries) and §4 (invariants) available for citation.
- The change's data flow drawn in one line — source → parser → validator → policy → adapter → verifier → journal — and the test file that will carry the regression proof identified.

## Inputs
- The change description and the untrusted inputs it touches.
- Existing rows T-01..T-20 to extend rather than duplicate.
- Assumption rows (`docs/matrices/ASSUMPTION_MATRIX.md`) for anything unproven, especially A-3 and A-7.

## Procedure
1. List every entry point in the changed flow that accepts untrusted content: user text, retrieved data, adapter output, provider body (F-04), and config (trusted, reviewed like code).
2. For each entry point, ask what an actor can induce: unintended action (T-01), hallucinated capability (T-02), unexposed capability (T-03), endpoint selection (T-09), prompt-injected instruction in data (T-11).
3. Map the authority paths next: second model turn after approval (B-1), permit reuse (T-07), replay (T-06), argument substitution (T-08), stale confirmation (T-05), evidence tampering (T-12).
4. Assign likelihood using the matrix's assumptions (competent operator, untrusted model output stream, possibly untrusted data in the prompt); state the assumption when likelihood is low.
5. Write the mitigation as a control with a location — "proposal `risk` field rejected by the envelope schema in `src/core/schema.mjs`", not "validate input".
6. Write detection: the evidence event or typed error that makes the attempt visible, e.g. `PROPOSAL_REJECTED` with `CAPABILITY_NOT_EXPOSED`, or `PERMIT_CONSUMED` on a second consume.
7. Write the residual risk honestly; if accepted, point to where it is recorded; if deferred, name the trigger.
8. Name the test file that fails if the control regresses (`tests/security.test.mjs`, `tests/authority.test.mjs`, `tests/verification.test.mjs`, …); no test means the mitigation is a claim, and the row must say so.
9. Attack the new row: what does this control enable or fail to cover (T-13 redaction gaps, T-12 unsigned chain, A-3 verifier correctness)? Add follow-on rows instead of leaving the gap implied.
10. Re-check scope statements: the localhost provider is unauthenticated (R-12); config is a trusted input (T-18); a compromised host defeats local controls (A-7).
11. Reject any mitigation that requires the model to behave, and any change that would let a target name (URL, path, host, command) arrive from model output (I-8, SAH-REQ-041).
12. Update the row status legend honestly: D only with a passing test, P with the residual recorded, X with a trigger.

## Decision points
| Condition | Action |
|---|---|
| Change adds a new prompt input | Add an injection row and, if output is never fed back, a row recording that containment (T-11) |
| Change would let the model name a target | Reject outright; no row makes a model-supplied URL/path/method acceptable (I-8, T-09) |
| Mitigation needs key custody or an external anchor | Defer with a trigger and record residual (T-12, M-3) |
| Mitigation assumes a component is correct (verifier) | Record an assumption row and add the adversarial test (A-3, lying adapter) |
| Threat exists only under operator misconfiguration | Keep the row (T-18) with the strict-config control and the journaled config hash |
| No detection is possible | Write what an operator would look for; "none" is a finding, not a blank cell |
| Threat applies only to a future multi-user or networked deployment | Mark deferred with the trigger (R-38 rate limiting), do not silently ignore |

## Failure conditions
- A new entry point without a row; a mitigation cell that names a principle instead of a location.
- An empty Test column, or a test name that does not exist.
- Residual risk asserted as none while the row's own reasoning shows otherwise.
- Likelihood rated low with no stated assumption behind it.
- A row that contradicts an assumption row (e.g. claiming verification adequacy while A-3 is PARTIALLY VERIFIED).

## Stop conditions
- An entry point cannot be enumerated, or an asset has no identifiable owner.
- The mitigation depends on the collaborator's internals (A-1..A-6): record UNKNOWN and the question, do not assume.
- The mitigation cannot be exercised by any test in this repository — record it as unverified and stop.
- The change cannot be described without naming a proprietary route or field (the assumption table forbids inventing one).

## Security considerations
- Preserve the two laws in every row: model output is untrusted input (R-27); authorization is downstream and never in the model (R-26).
- Do not weaken a control to make an onboarding, demo, or benchmark pass — that is a threat-model finding first.
- State scope explicitly when it excludes a threat: single trusted machine, no adversarial local process (A-7); synthetic data means data-protection threats apply to the real integration, not v0.1 (assumption 4).
- Cite only sources that exist in `docs/research/RESEARCH_LEDGER.md`; never put real credentials, tokens, or customer data into a row, example, or test.

## Verification
- `docs/matrices/THREAT_MATRIX.md` contains the row with every column populated; `scripts/lint.mjs` checks the matrix set exists per SAH-REQ-051.
- The named test fails when the control is removed: revert the control locally, observe the failure, restore it.
- The cited control location resolves to real code or config, not a document promise.
- The row's Detection column names an event that appears in `src/evidence/journal.mjs`'s event set.

## Expected outputs
- One or more complete threat rows (T-NN) with mitigation, detection, residual, and test.
- As needed: an ASSUMPTION_MATRIX row (OPEN) with a verification method, and a deferral entry with a trigger.
- An added regression case in the named test file, or an explicit note that no test is possible yet.

## Dependencies
- `docs/matrices/THREAT_MATRIX.md`, `docs/matrices/ASSUMPTION_MATRIX.md`, `docs/ARCHITECTURE.md` §4–§5
- `docs/reviews/DESIGN_CRITIC.md`, `src/evidence/journal.mjs` (event names), `scripts/lint.mjs`, and the test files named in the rows

## References
- R-25 (Anthropic "Handle tool calls") — tool results are untrusted; repair loops deferred with rationale.
- R-26 (OWASP LLM06:2025 Excessive Agency), R-27 (OWASP LLM05:2025/LLM01:2025) — downstream authorization, model output as untrusted input.
- R-29 (Saltzer & Schroeder), R-30 (Hardy, "The Confused Deputy") — fail-safe defaults, no caller-named authority.
- R-33 (MITRE CWE-367), R-34 (RFC 6749; RFC 7519), R-36 (NIST SP 800-92; SP 800-53 AU-9) — TOCTOU, single-use authority, audit integrity.
- R-38 (OWASP Agentic AI threats) — tool misuse mitigations; rate limiting deferred with a trigger; R-12 (Ollama authentication) — unauthenticated, localhost-bound provider boundary.

## Examples
- Enabling `adapters.http` for `invoice.issue` adds an endpoint-selection row extending T-09 (binding from trusted config only), a redirect row extending T-10 (`redirect:"manual"`), and an ambiguous-success row for the timeout-after-commit case (H-8) whose mitigation is a named integration requirement, not code.
- Adding a bounded repair loop for malformed proposals triggers DM-15's trigger and requires a new row for which attempt was approved and for double execution (F-23 territory) before the loop is written.
- Adding an LLM-judged benchmark metric triggers a row rejecting it: R-40/R-44 require deterministic scoring and forbid LLM attribution.

## Anti-patterns
- A row whose mitigation is "we validate input" with no file path.
- Copying a row and leaving the old likelihood without re-evaluating the new flow.
- Claiming a mitigation is tested when no test exercises it.
- Adding a control that depends on the model's cooperation.
- Modelling a hypothetical cloud deployment in v0.1 instead of the stated single-machine scope, or recording residual risk as "low" without stating the assumption that makes it low.
