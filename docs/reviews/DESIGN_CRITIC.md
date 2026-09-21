# Design Critic Gate

Phase: PHASE 4 (before implementation). Method: assume the architecture is wrong and try to
defeat it, using the questions required by the collaboration directive. Findings were raised
against the Phase 3 proposal; every BLOCKER and HIGH was either fixed in the design
(`docs/ARCHITECTURE.md`) or explicitly accepted with a reason.

Disposition legend: **FIXED** (design amended) · **ACCEPTED** (deliberate residual, reasoned) ·
**DEFERRED** (trigger named) · **FALSE POSITIVE** (the concern does not apply; why).

---

## BLOCKER

| # | Attack / question | Finding | Disposition | Resolution |
|---|---|---|---|---|
| B-1 | *Where can the model gain authority?* Via a second model turn between confirmation and execution: user confirms proposal A, the model is asked again, and returns A′ with the same capability and different arguments. | If the harness re-parsed the model's next response and executed it under the existing approval, the approval would be laundered. This is the single most dangerous path in any approve-then-execute design. | **FIXED** | The confirmation stores a **deep-frozen snapshot** of the approved proposal and its canonical hash; execution uses only that snapshot; the permit binds that hash; the adapter never sees a re-parsed object (ARCHITECTURE §3.3, §4 I-3; tests `confirmations`, `authority`). |
| B-2 | *Where can untrusted data become executable control?* Adapter output or user text containing instructions that the next prompt treats as commands. | A naive design re-prompts with tool output; injection then steers the next action. | **FIXED (v0.1 scope)** | v0.1 has no re-prompt loop: one user turn = at most one model call = at most one action. Adapter output is displayed and journaled as data, never fed back (T-11). The deferred repair loop (DM-15) carries a mandatory fencing/labelling requirement when introduced. |
| B-3 | *Can a failure be converted into a claimed success?* | Enumerating paths: adapter throws, verifier throws, journal write fails, policy throws, provider unreachable, parse fails. A single catch-all that returns "done" would be fatal. | **FIXED** | The status set is closed and enumerated (ARCHITECTURE §3.5); only `VERIFIED` yields `EXECUTED_VERIFIED`; policy errors resolve to DENY; verifier errors resolve to `VERIFICATION_FAILED`; journal pre-write failure aborts before execution (F-26). Tests assert each status is reachable only through its documented event. |

## HIGH

| # | Attack / question | Finding | Disposition | Resolution |
|---|---|---|---|---|
| H-1 | *What can replay?* A permit id captured from the journal; a `proposalId` reused by the model; a whole proposal re-sent later by an attacker with prompt access. | Same-id reuse would let a second execution ride the authority of the first. | **FIXED** | Atomic single-use consume (I-2); per-session proposal-id replay guard (`PROPOSAL_ID_REPLAY`, F-30); identical arguments later are a *new* action requiring new authority — which is the correct outcome, and the journal shows the two runs distinctly. |
| H-2 | *What can race?* Two confirmations, or a confirmation and a new instruction, arriving "simultaneously"; a scheduled sweep expiring a permit between check and use. | In Node, interleaving happens at `await` boundaries. A permit check that `await`s the journal before executing opens a TOCTOU window. | **FIXED** | Consumption is synchronous and immediately precedes the adapter call with no `await` between them (I-1, I-2, R-33). Confirmation resolution is synchronous. Journal writes happen before/after the synchronous block, never inside it. |
| H-3 | *What can silently fall back?* Missing verifier, missing adapter binding, missing permission, unknown schema keyword, absent `format` support in the runtime. | Any of these degrading to "proceed without it" would quietly remove a control. | **FIXED** | All five are registration-time or policy-time failures: no verifier/permission/adapter ⇒ registration error (I-10); missing binding ⇒ `DENIED`; unsupported schema keyword ⇒ registration error; unparsed `format` output ⇒ `REJECTED` (never repaired). |
| H-4 | *What assumptions are unsupported?* The design assumes verification is possible for every capability. | For a real system, a mutation with no read-back cannot be verified, and shipping it with a fake verifier would be worse than not shipping it. | **FIXED** | Capability registration requires a **registered verifier**; if a real operation cannot be verified, the capability must be either (a) paired with a read-back, or (b) declared `unverifiable`, which forces the terminal status to remain non-`EXECUTED_VERIFIED` and is recorded in the integration contract as a blocker for that operation (documented, not hidden). |
| H-5 | *What can partially commit?* Adapter reports success, some state changed, verification finds a mismatch. | The user could believe nothing happened when something did. | **ACCEPTED** | `VERIFICATION_FAILED` is a distinct terminal status that explicitly means "an effect may exist and verification failed", the CLI prints that sentence, and the journal holds the failing checks (F-22). Automatic compensation is out of scope (it needs the collaborator's transaction semantics — INTEGRATION_CONTRACT). |
| H-6 | *Where can state diverge?* The synthetic store is shared between adapter and verifier. | If the verifier reads through the adapter's code path, it verifies the adapter's opinion, not the state. | **FIXED** | Verifiers read the store directly through explicit read operations and never call the adapter's write path (DM-14); the lying-adapter test proves the mechanism detects an incorrect effect. |
| H-7 | *What happens when Ollama behaves unexpectedly?* Wrong model, truncated output, JSON with prose, `done_reason: "load"`, a 503 queue overflow. | A parser that "helps" would fabricate structure. | **FIXED** | Typed provider errors (F-01..F-04); strict parser (DM-07); `done_reason` is informational only (R-05); 503/429 map to a provider error with no automatic retry (DM-15). |
| H-8 | *What happens when the accounting service returns ambiguous success?* HTTP 200 with a body that does not contain the expected identifier; or a timeout after the server committed. | Treating an ambiguous response as success is the classic financial bug. | **FIXED (in scope)** | The adapter may only return success when its declared expectation is satisfied (status + required response fields for HTTP bindings); anything else is `EXECUTION_FAILED` (F-21). Timeout-after-commit is recorded as a **named integration requirement**: the collaborator's mutating endpoints need an idempotency key or a read-back (INTEGRATION_CONTRACT, A-5). |
| H-9 | *Claims stronger than evidence?* Docs or CLI implying the model was "safe" or the system "verified" without a verifier run. | Wording can lie even when code does not. | **FIXED** | The status enum and CLI rendering are the only permitted success wording; the benchmark explicitly reports model-quality columns as unmeasured; `docs/BENCHMARK.md` states what may not be claimed (R-43/R-44). |
| H-10 | *Complexity with no value?* Session manager, authority sweep timer, tags, configurable `keepAlive`, `redactKeys` config. | Each unneeded moving part is a place to hide a bug. | **FIXED (minimality pass)** | Deferred: no sweep timer (expiry is checked on use; the map is per-session and small), no session manager object beyond the harness, tags are required only for the selector, `redactKeys` is fixed in code rather than configurable, `keepAlive` is a single config field with no UI. Recorded in `docs/reviews/MINIMALITY_REVIEW.md`. |

## MEDIUM

| # | Finding | Disposition | Resolution |
|---|---|---|---|
| M-1 | The type gate depends on a compiler that may be absent, tempting a silent skip. | **FIXED** | `npm run typecheck` exits 2 with instructions when no compiler is found; `verify` is honest (DM-16). |
| M-2 | Redaction is pattern-based and can miss a novel secret shape. | **ACCEPTED** | Recorded as residual T-13; the adapter's headers are never journaled at all, which removes the main secret source. |
| M-3 | The journal is not signed; a privileged local attacker can rewrite the chain. | **ACCEPTED** | Residual T-12; key custody is a deferred subsystem (and the collaborator's key-custody design is UNKNOWN, so guessing it would be worse). |
| M-4 | `--confirm` in the CLI is an authority shortcut. | **ACCEPTED with constraint** | It is an operator action equivalent to typing `yes`, requires an explicit flag, is journaled as `CONFIRMATION_GRANTED` with `source: "cli-flag"`, and is documented as non-default. It never bypasses policy or permits. |
| M-5 | The exposure selector could hide a capability the user needs, producing UNSUPPORTED. | **ACCEPTED** | The error lists the exposed set and tells the operator how to widen the domain list; a misfire is visible and cheap, whereas over-exposure degrades selection accuracy (R-22). |
| M-6 | Evidence journal growth is unbounded. | **DEFERRED** | Rotation/retention (AU-11) triggers when a real deployment exists; volume in v0.1 is trivial. |
| M-7 | Confirmation TTL of 120s may be too short for a slow human. | **ACCEPTED** | Configurable (`confirmation.ttlSeconds`); the trade-off is deliberate (stale-approval risk). |

## LOW / NOTE

| # | Finding | Disposition |
|---|---|---|
| L-1 | `INV-0004` style ids make the demo feel scripted. | NOTE — acceptable; ids are deterministic by design (R-41) and the fixture is labelled synthetic. |
| L-2 | The word "verified" could be read as "verified correct accounting". | NOTE — the CLI and docs say "verified against synthetic domain state"; no accounting claim is made. |
| L-3 | The 8-capability pack is small. | NOTE — deliberate: the registry is designed for growth; onboarding is a documented SOP with a worked example. |
| L-4 | Benchmark arms for real models cannot run here (no Ollama). | NOTE/DEFERRED — recorded as the one unmeasured dimension; nothing is fabricated in its place. |

---

## Critic's closing statement

The design's strength is that it has **one** idea and enforces it everywhere: *nothing the model
produces is authority*. The dangerous paths are the places where approval and execution meet
(B-1, H-2, H-8), and all three are handled by binding, freezing, and atomicity rather than by
trusting a component to behave.

The design's honest weaknesses are (a) verification depends on the target system offering a
read-back (H-4, A-2), (b) ambiguous post-commit failures require the collaborator's transaction
semantics (H-8, A-5), and (c) local-only controls do not survive a compromised host (A-7). None
of these is hidden; each is a named assumption or integration requirement.

**Gate result: PASS.** No BLOCKER or HIGH finding remains unexplained; implementation may begin.
