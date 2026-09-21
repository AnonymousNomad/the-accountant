# Handoff Audit

Phase 12. Method: simulate a competent engineer (or model) who has never spoken to us and has only
this repository plus `COLLABORATOR_AGENT_NOTES.md`. For each required question: where they would
find the answer, and whether the answer is actually sufficient. Partial answers are recorded as
gaps with the change that would close them.

Verdict legend: **PASS** · **PARTIAL** (usable with named friction) · **FAIL** (would block them).

| # | Question | Where the answer is | Verdict | Notes |
|---|---|---|---|---|
| 1 | What does this system do? | `README.md` (one screen), `docs/ARCHITECTURE.md` §1 | PASS | The diagram and the "what it is not" section are deliberately first. |
| 2 | What does it NOT do? | `README.md` §What it is not; `docs/ARCHITECTURE.md` §2 module table ("must never do" column); `docs/matrices/ASSUMPTION_MATRIX.md` | PASS | Includes the explicit non-implementation of accounting logic, and the statement that no external system's internals are described anywhere. |
| 3 | How do I run it? | `README.md` §Quick start; `npm run demo` | PASS | No install step. The demo needs no model. `npm start` requires Ollama and fails with a specific message when absent. |
| 4 | How do I run its tests? | `npm test`, `npm run verify`, `scripts/verify.mjs` | PASS | `npm run verify` = lint → typecheck → tests → benchmark; stops at the first failure and never reports success for a skipped step. |
| 5 | How do I swap Ollama models? | `config/harness.config.json` (`provider.model`), `docs/ARCHITECTURE.md` §7, `src/models/provider.mjs` | PASS | Set `provider.model`. No model family is hard-coded; an unset model name is refused with instructions rather than defaulted. |
| 6 | How do I add a capability? | `sops/engineering/capability_onboarding.md` (worked example), `skills/engineering/semantic-capability-design.md`, `src/registry/capability.mjs` | PASS with friction | The worked example is complete (route → intent → schema → risk → permission → adapter → verifier → tests → registration → benchmark). Friction: it is an 100-line SOP; a 10-line quickstart exists in `docs/CAPABILITY_AWARENESS.md` §Adding a capability. |
| 7 | How do I integrate an HTTP capability? | `sops/engineering/adapter_integration.md`, `src/adapters/generic-http-adapter.mjs`, `config/harness.config.json` `adapters.http` | PARTIAL | The mechanism is complete and tested (bindings, timeouts, redirect refusal, required response fields, `COMMIT_UNKNOWN`). The gap is external: without the collaborator's real endpoint and read-back, they can only integrate against a fixture. `docs/INTEGRATION_CONTRACT.md` states exactly what is needed. |
| 8 | How do I reproduce the benchmark? | `docs/BENCHMARK.md` §How to run; `benchmarks/prompts.jsonl`; `benchmarks/run-benchmark.mjs` | PASS | Case-by-case commands, report location, and the recorded hashes that make a run identifiable. |
| 9 | How do I diagnose a failure? | `docs/matrices/FAILURE_MATRIX.md`; `sops/engineering/failure_triage.md`; `sops/runtime/untrusted_content_handling.md`; `:evidence` and `:verify-chain` | PASS | The matrix maps every failure to a symptom, a safe behaviour, and the evidence record produced; the triage SOP maps terminal statuses to first checks. |
| 10 | What are the known limitations? | `docs/matrices/ASSUMPTION_MATRIX.md`, `docs/reviews/IMPLEMENTATION_CRITIC.md` §residuals, `docs/reviews/MINIMALITY_REVIEW.md` deferrals, `docs/THREAT_MODEL.md` §controls not implemented | PASS | Named, reasoned, with triggers. `COMMIT_UNKNOWN` and the tamper-evidence (not proof) limitation are stated in the README's laws as well. |
| 11 | How do I continue development safely? | `COLLABORATOR_AGENT_NOTES.md` §Handoff Instructions, §Decisions, §Change Log; `docs/matrices/DECISION_MATRIX.md` | PASS | The instructions name the gate command, the read-before-you-change files, and the rule that authority is never widened to make a test pass. |
| 12 | Why is it built this way? | `docs/matrices/DECISION_MATRIX.md` (16 decisions with rejected alternatives), `docs/reviews/DESIGN_CRITIC.md` | PASS | Every rejected alternative has a reason and a named research id. |

## Can they answer the collaborator's questions?

The directive asks that the collaborating developer can find answers to: why not expose all 400
routes; why the model runtime does not discover his API; why proposal and execution are separate;
why confirmation is bound to a proposal; why verify after execution; why semantic capabilities; how
to add the next capability; how to benchmark another model; how to diagnose a failure.

All nine are answered in `docs/ARCHITECTURE.md` §8 ("Why these boundaries exist") and in
`docs/CAPABILITY_AWARENESS.md`, in the collaborator's own vocabulary, without asserting anything
about his implementation.

## Gaps found by this audit (recorded, not hidden)

| Gap | Consequence for a stranger | Planned change |
|---|---|---|
| No runnable real-model arm | They cannot reproduce a model-quality number, only the harness-behaviour numbers | `docs/BENCHMARK.md` §"How to run a real-model arm" names the file to change (`benchmarks/run-benchmark.mjs` — swap the provider). Closing it requires a local runtime, not code. |
| The type gate needs a compiler the repository does not ship | `npm run verify` fails on a bare machine with a clear message about `SAH_TSC` | Deliberate (zero-dependency design); `docs/matrices/DEPENDENCY_MATRIX.md` records the trade-off. |
| 13 skills + 13 SOPs is a lot of reading | A reader may not know where to start | `skills/README.md` and `sops/README.md` index both groups by use case; `README.md` points at the three files worth reading first. |
| No diagram image | The flow is ASCII only | Intentional: ASCII survives diffs, terminals, and copy-paste. |
| The synthetic capability pack is small (8) | Unclear how the design behaves at 50+ capabilities | The overloaded benchmark arm measures exactly that at 48 capabilities; `sops/engineering/capability_onboarding.md` is the path to a larger pack. |

## Handoff test result

**PASS with two recorded partials** (the real-model arm, and HTTP integration against a real
endpoint — both blocked on the collaborator or on hardware, not on documentation).

Nothing in this audit was asserted without reading the artefact or running the command it names.
