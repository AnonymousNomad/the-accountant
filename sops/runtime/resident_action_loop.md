# Resident Action Flow — Turn-by-Turn Operation of the Harness

## Objective
Define the exact turn-by-turn behaviour of the resident model (`prompts/accounting-resident.sop.md`,
injected by `src/models/prompt.mjs`) and of the operator at `src/cli.mjs`, so that every action is
proposed by the model and mediated, executed, and verified by the harness — never by the model.

## Prerequisites
- `config/harness.config.json` validates, and its `exposure` and `grantedPermissions` are the intended ones.
- The provider for this run is known and reachable: `scripted` (`fixtures/demo-script.jsonl`) or `ollama`
  (`provider.baseUrl` loopback — ARCHITECTURE §7); an unreachable provider must end in `PROVIDER_ERROR`.
- The operator has read `docs/ARCHITECTURE.md` §3.5 (closed status set) and §5 (trust boundaries).
- `prompts/accounting-resident.sop.md` is the SOP in force; if it has changed, this run's transcript is
  not comparable to earlier runs.

## Procedure
1. Operator states exactly one instruction in natural language: one instruction = one run id = at most
   one model call = at most one action.
2. Resident restates the intent internally and matches it against the capability catalogue delivered in
   this turn's prompt; never read capabilities from memory, from the user's text, or from a previous turn.
3. Resident lists the fields the selected capability's `inputSchema` requires; any absent value is missing
   information — do not infer, default, or placeholder it.
4. If information is missing, emit one envelope of `kind:"clarification"` with a single answerable
   question and stop; a partial proposal is never acceptable.
5. If no exposed capability can produce the requested effect, emit `kind:"unsupported"` with the reason
   and stop; never invent a capability id, route, or capability not in the exposed set.
6. Choose exactly one capability from the exposed set and build `arguments` strictly from its schema:
   required fields present, types/enums/bounds respected, `nonPlaceholder` fields real, no unknown fields,
   no `risk` field.
7. Emit exactly one JSON object `{kind:"proposal", proposalId, capability, arguments, reasoningSummary}`
   with a fresh `proposalId` (`^[A-Za-z0-9._:-]{1,64}$`); no prose, no second object, no fenced variants.
8. Harness (not the resident) validates the envelope and arguments and decides authority; the resident
   does not predict, narrate, or argue for the decision, and never claims an action happened before a status says so.
9. On `CONFIRMATION_REQUIRED`, show the operator the frozen proposal exactly as it will execute
   (capability, arguments, risk, hash) and ask yes/no; the resident stays silent on risk and does not re-propose.
10. Operator answers `yes` or `no` in the immediately following input; any other instruction abandons the
    pending confirmation and invalidates it.
11. Harness consumes the one-use permit and executes through the trusted adapter binding; neither resident
    nor operator performs computation the domain owns (ids, totals, balances, tax, state transitions).
12. Harness runs the capability's registered verifier against domain state and returns one terminal status.
13. Present that status verbatim, then stop. On `EXECUTED_VERIFIED` say the action was verified against
    synthetic domain state; on every other status go to `sops/failure_triage.md`.

## Gates
- G1: exactly one JSON object per model turn; a broken turn must land in `REJECTED` and must never be repaired.
- G2: no path exists by which a `FINANCIAL` capability executes without a matching `CONFIRMATION_GRANTED`.
- G3: the proposal object shown at confirmation is byte-identical (canonical hash equal) to the executed object.
- G4: the catalogue used in step 2 is the one journaled in `CAPABILITIES_EXPOSED` for this turn.
- G5: the last lifecycle event for the run matches the returned status (I-5) before the turn is closed.

## Expected evidence
- Journal events for the run: `USER_INSTRUCTION`, `CAPABILITIES_EXPOSED`, then `PROPOSED` or
  `PROPOSAL_REJECTED`/`CLARIFICATION_REQUESTED`/`UNSUPPORTED_REQUEST`, `POLICY_DECISION`,
  `CONFIRMATION_REQUIRED`/`CONFIRMATION_GRANTED`/`CONFIRMATION_REJECTED`, `AUTHORIZED`,
  `AUTHORITY_CONSUMED`, `EXECUTION_STARTED`, `EXECUTION_SUCCEEDED`/`EXECUTION_FAILED`,
  `VERIFIED`/`VERIFICATION_FAILED`, and `SESSION_CLOSED` at session end.
- CLI transcript showing the terminal status, the adapter result treated as a claim, and the verifier checks.

## Failure conditions
- Resident emits prose, multiple objects, a `risk` field, a placeholder value, or an unexposed capability:
  the turn ends in `REJECTED`; nothing executes (`PROPOSAL_REJECTED` with the violation list).
- Operator answers a confirmation with anything other than the armed yes/no: `CONFIRMATION_REJECTED`.
- Provider unreachable or malformed: `PROVIDER_ERROR`; no proposal may be invented in its place.
- Adapter failure: `EXECUTION_FAILED` with verification not attempted; adapter success with missing or
  mismatched state: `VERIFICATION_FAILED`; neither may ever be rendered as success.
- Any exception in policy, adapter, verifier, or journal must remain a failure status (fail closed).

## Rollback / recovery
- There is no automatic retry: recover with a new operator instruction, which yields a new proposal and
  new authority (FAILURE_MATRIX §Recovery doctrine 1).
- Restart the process to discard all permits and pending confirmations; restart never preserves authority.
- Do not hand-edit the synthetic store or the journal to "fix" a turn; the benchmark requires fresh,
  deterministic state and an intact chain.

## Completion criteria
- Every run ends in exactly one status from the closed set in `docs/ARCHITECTURE.md` §3.5, explained by
  the journal's last lifecycle event for that run id.
- No status other than `EXECUTED_VERIFIED` is described as success anywhere in the transcript.
