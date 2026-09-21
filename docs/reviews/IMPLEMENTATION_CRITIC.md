# Implementation Critic

Phase 10 review. Method: inspect the implementation independently of the design, and treat every
disagreement between the two as a defect in one of them. Every finding has a disposition:
**FIXED** · **ACCEPTED RISK** · **DEFERRED** · **FALSE POSITIVE**. Nothing is silently ignored.

Findings are grouped by how they were discovered, because the discovery method is part of the
evidence: several were found by *running* the thing, not by reading it.

---

## Findings discovered by running the system

### IC-01 — Node's fetch reports transport failures in `err.cause.code`, not `err.code` — FIXED
- **Symptom:** benchmark case B30 (`timeout_before_transmission`, a definitely-refused connection)
  returned `COMMIT_UNKNOWN` instead of `EXECUTION_FAILED`.
- **Root cause:** undici wraps the transport error; the useful code (`ECONNREFUSED`) lives on
  `err.cause.code`. Both the HTTP adapter and the Ollama provider read only `err.code`, so every
  refusal looked like an unexplained network error, and for a non-idempotent method an unexplained
  error is correctly classified as ambiguous.
- **Impact:** a definite non-commit was reported as an ambiguous commit. Annoying, not dangerous —
  but it weakened the distinction the whole design rests on.
- **Fix:** `transportCodeOf()` in both call sites reads `err.code` then `err.cause.code`; the
  closed-port case now classifies deterministically as `NOT_SENT`.
- **Evidence:** `tests/adapters.test.mjs`, benchmark B30 (`EXECUTION_FAILED`), and the probe output
  recorded during triage (port 1 → no code; freshly closed port → `ECONNREFUSED`).

### IC-02 — Evidence redaction was over-broad and silently corrupted a metric — FIXED
- **Symptom:** the benchmark reported `meanApproxTokens: NaN`.
- **Root cause:** the redactor matched credential words as substrings, so the key `approxTokens`
  matched `/token/i` and was replaced with `[REDACTED]`. The token-count metric then parsed
  `undefined`.
- **Impact:** legitimate evidence was replaced by a placeholder — a silent integrity failure in the
  audit trail, which is worse than a crash.
- **Fix:** credential matching is now exact-name or separator-suffixed, plus a camelCase list
  (`accessToken`, `webhook_secret`, …), so `approxTokens` and `tokenCount` survive while real
  credential keys do not. `tests/evidence.test.mjs` pins both directions.
- **Evidence:** `tests/evidence.test.mjs` §"innocent keys that merely contain the word token".

### IC-03 — A disabled capability leaked into the model's context — FIXED
- **Symptom:** test A02 failed: `invoice.issue` was disabled but still appeared in the rendered
  context.
- **Root causes, two:** (a) `relatedCapabilities` cross-references were rendered verbatim, so a
  disabled capability could appear as "related"; (b) one capability's `whenNotToUse` prose named
  another capability.
- **Impact:** a model could be told about an operation it cannot use, which is exactly the
  capability-awareness failure the addendum describes (and it produces confusing "not exposed"
  rejections).
- **Fix (a):** related references are filtered to the exposed set before rendering.
  **Fix (b):** prose was rewritten, and the convention "cross-references belong in
  `relatedCapabilities`, never in prose" is now pinned by the A02 assertion.
- **Evidence:** `tests/capability-awareness.test.mjs` A02.

### IC-04 — The confirmation turn had no explicit link to the turn that proposed the action — FIXED
- **Symptom:** the evidence-reconstruction test could not find `PROPOSED` in the execution turn's
  records.
- **Root cause:** each turn gets its own `runId`; the join between the proposal turn and the
  confirmation turn existed only implicitly through `proposalHash`.
- **Impact:** a human or tool reading the journal had to know the join key. Reconstructability is a
  stated requirement, so an implicit join is a defect.
- **Fix:** `CONFIRMATION_GRANTED` and `AUTHORIZED` now carry `originRunId` (and the armed turn), and
  the test asserts the explicit link plus hash agreement across both runs.
- **Evidence:** `tests/evidence.test.mjs` §"the journal reconstructs…".

### IC-05 — A nested `git init` had produced a broken repository — FIXED
- **Symptom:** `git -C sovereign-action-harness rev-parse --show-toplevel` resolved to the parent
  AIDE repository.
- **Root cause:** the first `git init` left a partial `.git` (only `hooks/` and `description`), so
  git walked up to the parent instead of treating the directory as a repository.
- **Impact:** the "one coherent commit" requirement would have failed, and the parent repository
  would have absorbed the files.
- **Fix:** re-initialised with `--initial-branch=main`, verified `--show-toplevel` and
  `is-inside-work-tree`, and confirmed the parent repository's untracked count is unchanged (its
  local `.git/info/exclude` lists this directory).
- **Evidence:** recorded in `docs/EVIDENCE.md` and `COLLABORATOR_AGENT_NOTES.md`.

### IC-06 — Direct permit issuance was possible without the full binding (caught by tests) — FIXED
- **Symptom:** two security tests failed with `refusing to issue a permit without actorId`.
- **Root cause:** the tests (written before the consolidated directive) called `authority.issue`
  with the old shorter binding. The failure was the *intended* behaviour of the tightened control.
- **Impact:** none in production; the tests were stale, and the control was correct.
- **Fix:** tests now exercise every binding dimension explicitly (argument, actor, workspace,
  capability version, snapshot, run), and a positive case proves the full binding still works.
- **Evidence:** `tests/security.test.mjs` S04.

### IC-07 — Two definition-validation defects caught at first run — FIXED
- **Symptom 1:** `adapter.operation must be a string of 2-64 characters` for a valid definition.
  **Root cause:** the validator looked the field name up as a key, so nested names like
  `adapter.operation` never resolved. **Fix:** validators take the value, not the field name.
- **Symptom 2:** a legitimate `sideEffects` string was rejected. **Root cause:** the array entry cap
  (64) was written for tags and reused for prose. **Fix:** the cap is 160 with a documented reason.
- **Evidence:** both are covered by `tests/registry.test.mjs` (a complete definition is accepted).

---

## Findings from reading the implementation against the design

### IC-08 — Test/benchmark seams can bypass configuration validation — ACCEPTED RISK
`createHarnessFromConfig` accepts `mutateConfig`, `capabilityOverrides`, `extraCapabilities`,
`extraVerifiers` and `mockAdapter`. `mutateConfig` runs *after* `loadConfig` validated the file, so a
caller can set values the validator would refuse (for example a non-loopback base URL). The provider
and the policy engine still enforce their own checks (S15 proves the loopback refusal), but the seam
is real.
**Why accepted:** the seams are unreachable from the CLI and from any model output — they are
constructor arguments used only by `tests/**` and `benchmarks/run-benchmark.mjs`. Removing them would
mean duplicating composition in tests (which would test a different system) or shipping many small
config files.
**Trigger to revisit:** any exposure of these options through a configuration file, environment
variable, or route.

### IC-09 — Outcome shapes are loose (non-discriminated) unions — ACCEPTED RISK
`authority.consume`, `confirmations.resolve` and the adapter `execute` return
`{ ok: boolean, …optional fields }` rather than discriminated unions, so TypeScript cannot force
callers to narrow before reading `code`.
**Why accepted:** every call site checks `ok` at runtime (the tests assert the refusals), and the
discriminated form produced ~25 narrowing cast sites in tests without adding a runtime guarantee.
**Trigger:** if these values ever cross a module boundary where a missed `ok` check could change
behaviour rather than crash an assertion.

### IC-10 — The type gate depends on an external compiler and a hand-written shim — ACCEPTED RISK
`scripts/typecheck.mjs` needs a `tsc` that the repository does not ship (zero-dependency design), and
`types/node-min.d.ts` declares the Node APIs loosely.
**Why accepted:** the alternative is vendoring a toolchain. The gate fails loudly when the compiler is
absent (exit 2), which is the property that matters; and the shim's looseness affects only Node API
usage, not this repository's internal consistency. Recorded in `docs/matrices/DEPENDENCY_MATRIX.md`.
**Trigger:** if the project ever ships a package anyway, replace the shim with `@types/node`.

### IC-11 — `src/harness.mjs` is the largest module (989 lines, ~800 code lines) — DEFERRED
It holds orchestration, evidence recording, permit wiring, execution, verification and result
construction. It is cohesive (one turn's lifecycle) but it is the hardest file to review.
**Trigger:** extract evidence-recording helpers into `src/evidence/records.mjs` when the file passes
~1000 lines or when a second orchestrator (for example a service entry point) needs the same helpers.

### IC-12 — The journal is tamper-evident, not tamper-proof. — ACCEPTED RISK (documented residual)
A privileged local actor can rewrite the whole chain. There is no signing key and no external anchor.
**Why accepted:** key custody is a subsystem the collaborator's design has not been shared for, and
inventing one would be worse than declaring the gap. Recorded in `docs/THREAT_MODEL.md` (T-12) and
`docs/matrices/ASSUMPTION_MATRIX.md` (A-12).

### IC-13 — Adapter-level idempotency is metadata only — DEFERRED (by design)
`idempotency` is validated and recorded, and influences nothing at runtime; the harness never retries.
**Why:** retry safety cannot be inferred, the target system's idempotency support is unknown
(A-5), and `COMMIT_UNKNOWN` exists to make the ambiguity explicit instead of papering over it.
**Trigger:** when the collaborator confirms idempotency-key support and a real adapter exists.

### IC-14 — The exported `render`/`exitCodeFor` helpers take `any` — ACCEPTED RISK
`src/cli.mjs` exports its transcript renderer for tests, and the helper is typed loosely so that a
test can render every status with a synthetic result.
**Why accepted:** it is a terminal renderer; the property that matters (success wording appears only
for `EXECUTED_VERIFIED`) is asserted for every status in `tests/cli.test.mjs`.

### IC-15 — Policy re-checks what validation already checked — FALSE POSITIVE, kept deliberately
`policy-engine.mjs` re-checks capability existence, exposure, enabled state and version, even though
the harness validated the capability before policy. This redundancy is defence in depth at the point
of authority (complete mediation, R-29): the policy engine is the component that must be trustworthy
if the harness is ever refactored. Removing it would be a regression in a security-critical path.

---

## Closing statement

The implementation's honest weaknesses are: an external dependency for *checking* (the type gate),
a hand-rolled Node shim, test seams that can bypass configuration validation, loose outcome unions,
and one large module. None of these is a control gap; the control gaps that exist are named,
reasoned residuals (IC-08, IC-12, IC-13) with triggers.

The defects that mattered (IC-01…IC-04) were all found by executing the system and by asserting
reconstructability — not by reading the code. That is the argument for keeping the battery.

**Gate result: PASS.** No BLOCKER or HIGH finding remains open; every residual has a trigger.
