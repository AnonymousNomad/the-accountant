# Collaborator Agent Notes

Durable engineering handoff record for the Sovereign Action Harness.
Read this before doing any work in this repository. Update it after every meaningful
research, architecture, implementation, verification, rejection, or repair phase.

Do not put secrets, credentials, private customer information, proprietary collaborator
details, or private reasoning in this file. Record engineering conclusions and evidence only.

---

## Project Purpose

Build a small, auditable, local-first AI execution harness that sits between a
locally hosted model runtime (Ollama) and a deterministic application. The model is a
reasoning component, not an authority. The harness owns capability selection bounds,
policy, execution authority, execution, evidence, and independent verification.

Immediate deliverable: Sovereign Action Harness v0.1 — a generic, dependency-free
Node.js reference implementation demonstrated against a SYNTHETIC accounting domain.

This is also a worked example of disciplined engineering for an external collaborator:
research -> decisions -> implementation -> adversarial review -> evidence.

---

## Current State

**v0.1 is complete against its own gate.** All four battery steps pass on 2026-09-21:
lint OK (123 files), typecheck OK (tsc --checkJs, zero errors), 114/114 tests, benchmark 37/37 cases
with 169/169 expectation checks and **0 unauthorized executions**. Commands, results and the limits
of that evidence are recorded in `docs/EVIDENCE.md`.

- **Phase order executed:** 0 reconnaissance → 1 research → 2 matrices → 3–4 skills and SOPs →
  5 architecture → 6 design critic (PASS) → 7 implementation → 8 tests → 9 benchmark → 10
  implementation critic (PASS) → 11 minimality review → 12 handoff audit (PASS with two recorded
  partials) → 13 documentation reconciliation → 14 clean commit.
- **Repository:** `E:\aide-sovereign-workbench\sovereign-action-harness`, standalone git repository,
  branch `main`. It is nested inside the operator's AIDE working tree; the parent repo lists it as
  untracked and has it in its local `.git/info/exclude`, so the parent tree is unaffected.
- **Artefacts:** 27 source modules (6023 lines), 14 test modules (2379 lines), 1 benchmark runner
  (613 lines, 37 fixture cases), 3 scripts (424 lines), 26 skills (13 runtime + 13 engineering),
  21 SOPs (13 runtime + 8 engineering), 2 prompt files, 16 documents, and the matrices/research
  ledgers. Zero runtime dependencies; no install step; no network required for the battery.
- **Runtime available:** Node.js v26.4.0, npm 11.17.0, git 2.54.0 on Windows x64.
- **Ollama:** NOT INSTALLED (verified 2026-09-21: no binary on PATH or in the two default install
  locations; `http://127.0.0.1:11434/api/version` unreachable). Consequence: the provider is
  implemented against the documented HTTP contract and fails closed and legibly when absent; all
  model-dependent benchmark columns are reported as unmeasured. Nothing is fabricated in their place.
- **Type gate:** `npm run typecheck` needs a `tsc` the repository deliberately does not ship. With
  `SAH_TSC` pointing at a local compiler the gate runs clean; without one it exits 2 loudly.

---

## Known Facts

### Environment (OBSERVED, 2026-09-21)
- Node v26.4.0, npm 11.17.0, git 2.54.0.windows.1.
- `node:sqlite` module is available in this Node build.
- `tsc` is NOT on PATH; a TypeScript compiler is present at
  `E:\aide-sovereign-workbench\node_modules\.bin\tsc.cmd` (usable offline for a real
  `--checkJs` type gate without installing anything).
- No network dependency is required to build or run the harness.

### Reference implementation (OBSERVED by reading source, 2026-09-21)
`https://github.com/AnonymousNomad/cyber-sop-harness` — inspected at tree
`23e643d1013ea3e294356913af6a848149739421`. It contains two implementations:
a C# solution (`src/CyberSopHarness.Core/*`) and a compact Node ESM implementation
(`edge-aide-cyber/src/`). Files actually read in full:
- `edge-aide-cyber/src/governance/permit-issuer.mjs` — one-use permits with TTL, typed
  mismatch reasons (`PERMIT_EXPIRED`, `PERMIT_ALREADY_USED`, `TOOL_MISMATCH`,
  `TARGET_MISMATCH`), refuse-to-issue unless the policy decision is `ALLOW`.
- `edge-aide-cyber/src/governance/policy-engine.mjs` — decisions
  `ALLOW | DENY | APPROVAL_REQUIRED`; manifest validation; a fail-closed wrapper that
  converts internal errors into `DENY`.
- `edge-aide-cyber/src/governance/evidence-chain.mjs` — append-only JSONL with
  `seq`, `prevHash`, `hash` (SHA-256 over canonical subset), a `verify()` chain replay, and
  a `sanitizeValue()` redactor for tokens/keys/JWTs/private keys/connection strings.
- `docs/data-contracts.md` — canonical action hash rules (`canonical-action-json-v1`:
  sorted keys, no insignificant whitespace, SHA-256 lowercase hex, array order preserved),
  permit binding list, and cross-record invariants (result with `ALLOW` requires a
  consumed unused permit; consumed/expired permits cannot be replayed).
- `ARCHITECTURE.md` and `docs/architecture-decision-record.md` — plane separation,
  trust boundaries, explicit rejection of "model as policy authority" and of
  "generic shell as the first tool interface".

### Collaboration inputs (REPORTED BY COLLABORATOR, relayed by the operator)
- The collaborator has a sovereign accounting application.
- REPORTED: approximately 400 HTTP routes.
- REPORTED: AES-256-GCM is used somewhere in their system.
- REPORTED: four tax regions are supported.
- REPORTED (context, not a requirement): barcode hardware, face recognition, banking,
  payroll, and regulatory submission are part of their wider product ambitions.
- Nothing about their routes, schemas, database design, service boundaries, key custody,
  or security architecture has been provided or verified.

---

## Unverified Claims / Unknowns

| # | Statement | Label | Why it matters |
|---|-----------|-------|----------------|
| U1 | "~400 HTTP routes" | REPORTED BY COLLABORATOR | Sizing for capability onboarding; not a design input yet |
| U2 | "AES-256-GCM" | REPORTED BY COLLABORATOR | Key custody, nonce handling, and zero-knowledge claims are UNKNOWN |
| U3 | "four tax regions" | REPORTED BY COLLABORATOR | Implementation/conformance status UNKNOWN; out of scope for v0.1 |
| U4 | Route architecture, service boundaries, auth model, DB design, transaction semantics | UNKNOWN | Blocks real adapters; v0.1 therefore ships synthetic + generic HTTP only |
| U5 | Whether their existing system has any idempotency or audit trail | UNKNOWN | Determines whether verification can rely on their state (see INTEGRATION_CONTRACT) |
| U6 | Whether Ollama will be their runtime | UNKNOWN | Hence a provider interface with a documented, swappable boundary |
| U7 | Model family/size they intend to run | UNKNOWN | Capability-set size (how many capabilities can be exposed) is the open risk |
| U8 | Their tolerance for confirmation prompts | UNKNOWN | v0.1 defaults to requiring confirmation for FINANCIAL risk |
| U9 | "zero knowledge" / "zero trust" architecture | REPORTED BY COLLABORATOR | Neither certified nor challenged; a claim about their design that we have not inspected |
| U10 | "AES-256-GCM implementation properties" and security "exceeding FIPS" | REPORTED BY COLLABORATOR | Key custody, nonce handling and conformance are UNKNOWN; do not repeat these as facts |
| U11 | "no-open-port remote access" security posture | REPORTED BY COLLABORATOR | Network posture is UNKNOWN pending architectural inspection |

Epistemic labels in use across this repository: OBSERVED, REPORTED BY COLLABORATOR,
INFERRED, UNKNOWN, VERIFIED, REJECTED. A reported claim is never promoted to a verified
architectural fact without evidence recorded in this file.

---

## Constraints

- **Sovereign:** no cloud, no telemetry, no external API dependency at build time or
  runtime. Everything runs locally.
- **Zero new runtime dependencies** for v0.1 unless a dependency passes the Dependency
  Discipline checklist in `docs/matrices/DEPENDENCY_MATRIX.md`. Current state: zero.
- **Windows-first** development machine; cross-platform Node code required (no bash-only
  scripts, no POSIX-only paths).
- **The collaborator's proprietary implementation is unavailable.** Do not invent it.
  Integration happens only through an explicit contract + adapter package later.
- **Out of scope for v0.1:** real accounting logic, tax, payroll, banking, regulatory
  submission, production credentials, authentication replacement, UI work, vector
  databases, fine-tuning, multi-model orchestration, and any other project (the operator's
  other products must not be touched).
- **Naming/IP boundary:** the repository is generic. No collaborator product name,
  branding, or proprietary specification may appear in code, docs, fixtures, or tests.

---

## Architectural Laws

1. **The model is a reasoning component, not the authority.** No model output is execution
   authority.
2. **Risk comes from trusted capability metadata, never from the model.** The model cannot
   lower, restate, or negotiate a risk class.
3. **Unknown capability = reject. Malformed proposal = reject. Failed verification = report
   failure, never success.**
4. **One permit, one execution.** A permit is bound to the exact proposal hash and is
   single-use, expiring, and non-transferable.
5. **No silent fallback.** Every degraded path is either an explicit refusal or an explicit,
   reported degradation.
6. **Execution success and verified success are separate states.** Only independent
   verification may produce a verified result.
7. **Every meaningful execution leaves evidence** in an append-only, hash-chained,
   redacted journal.
8. **Trusted configuration owns endpoints.** The model selects semantic capabilities; it
   can never select a URL, method, or process to run.
9. **Fail closed.** Errors at any stage terminate the action; failure is never translated
   into a success-shaped result.
10. **No dynamic code execution.** No `eval`, no `new Function`, no shell spawned from
    model-influenced input.

---

## Decisions

Decision entries use the record format required by the collaboration directive.
Full architectural rationale lives in `docs/matrices/DECISION_MATRIX.md`; this file keeps
the durable summary.

### D-001 — Create the harness as a new standalone repository
- **Date:** 2026-09-21
- **Decision:** Build `sovereign-action-harness` as an independent repository rather than a
  module inside any existing project.
- **Reason:** The technology is generic and reusable; the collaborator's IP boundary is
  unknown; isolation prevents coupling to unrelated product lines.
- **Evidence:** Directive 1 (SOURCE / IP BOUNDARY); no collaborator source is available.
- **Alternatives considered:** (a) module inside an existing operator project, (b) fork of
  cyber-sop-harness.
- **Rejected because:** (a) creates coupling and contradicts the generic-repository
  requirement; (b) would drag cybersecurity domain assumptions into a generic primitive.
- **Consequence:** Integration with any real system later happens through an adapter
  package, keeping the core generic.
- **Reversibility:** High (a repository can be relocated or vendored later).
- **Affected files:** whole repository.
- **Verification status:** created and initialized; tree verified 2026-09-21.

### D-002 — Node.js ESM, zero runtime dependencies
- **Date:** 2026-09-21
- **Decision:** Implement in Node.js ESM (`.mjs`) with no third-party runtime dependencies.
- **Reason:** Node 26.4.0 is present and verified; the standard library covers HTTP client,
  HTTP server (for tests), crypto, filesystem, and the test runner. Zero dependencies means
  no supply chain, no network at build time, and nothing to audit beyond this repository —
  which is the point of a sovereign, auditable harness.
- **Evidence:** Phase 0 inspection (node/npm versions; `node:sqlite` present; local `tsc`
  available for a type gate without installing packages). The reference implementation's
  Node governance layer is also dependency-light ESM.
- **Alternatives considered:** (a) TypeScript + build step, (b) zod/express-style
  dependencies, (c) C# mirroring the reference solution.
- **Rejected because:** (a) adds a toolchain without adding a v0.1 capability (a real type
  gate is still obtained via `tsc --checkJs` on JSDoc-annotated JS); (b) adds supply-chain
  and audit surface for functionality the standard library or ~120 lines of local code
  covers; (c) the operator's proven Node patterns and the cross-platform CLI requirement
  favour Node.
- **Consequence:** Validation, canonical hashing, and the schema subset are implemented in
  this repository and are themselves auditable and tested.
- **Reversibility:** Medium (a later TypeScript migration is mechanical but touches all files).
- **Affected files:** `package.json`, all `src/**`, `scripts/typecheck.mjs`.
- **Verification status:** pending PHASE 6 (lint + typecheck + test run recorded in this file).

### D-003 — Reimplement generalized patterns; copy no code
- **Date:** 2026-09-21
- **Decision:** Take architectural primitives from the reference harness as ideas and
  reimplement them for this domain. Do not copy cyber-specific code or assumptions.
- **Reason:** The primitives that matter (strict proposals, capability registry, policy
  gate, one-use permit, hash-chained evidence, independent verification) are
  domain-independent; the reference's engagement/scope/opsec logic is not. A clean
  reimplementation also avoids dragging license and provenance questions into a new repo
  and produces a smaller, more auditable core.
- **Evidence:** Files read 2026-09-21 (listed under Known Facts) show the primitives; the
  same files show cyber-specific coupling (targets, scope rules, engagement manifests).
- **Alternatives considered:** (a) vendor/copy the `.mjs` governance files; (b) fork the
  whole repository.
- **Rejected because:** both import domain assumptions and licence obligations that the
  generic core does not need. License status of the reference repository was NOT verified
  during reconnaissance, which alone forbids copying.
- **Consequence:** Concepts are credited in `docs/RECONNAISSANCE.md`; no code is copied.
- **Reversibility:** High.
- **Affected files:** `docs/RECONNAISSANCE.md`, `ARCHITECTURE.md`, all `src/**`.
- **Verification status:** to be re-checked in PHASE 10 (source/license hygiene audit).

### D-004 — Synthetic domain for v0.1, generic HTTP adapter for later integration
- **Date:** 2026-09-21
- **Decision:** Demonstrate against a synthetic accounting capability pack and ship a
  disabled-by-default generic HTTP adapter bound to trusted configuration.
- **Reason:** The collaborator's specification does not exist yet; inventing his routes
  would violate the no-guessing rule. The HTTP adapter proves the integration shape without
  pretending to know his system.
- **Evidence:** Directive 1 (INTEGRATION_CONTRACT requirement; "do not invent").
- **Alternatives considered:** (a) build against a guessed REST surface; (b) wait for the
  collaborator's spec.
- **Rejected because:** (a) fabricates proprietary interfaces; (b) blocks all progress.
- **Consequence:** `docs/INTEGRATION_CONTRACT.md` defines exactly what the collaborator must
  provide; onboarding is a documented procedure (`sops/capability_onboarding.md`).
- **Reversibility:** High.
- **Affected files:** `config/harness.config.json`, `src/domain/synthetic-accounting/*`,
  `src/adapters/generic-http-adapter.mjs`.

---

## Decision Reversals

None yet.

---

## Research Findings

PHASE 1 research is dispatched (Ollama runtime behaviour; reliable tool-call generation;
governed execution security; agent benchmarking methodology). Findings will be recorded in
`docs/research/RESEARCH_LEDGER.md` with source, type, URL, access date, key finding,
implementation consequence, and confidence; consequences are traced in
`docs/research/RESEARCH_TO_IMPLEMENTATION_MATRIX.md`.

No research finding is treated as established until it is in the ledger with a URL.

---

## Dependencies

| Dependency | Kind | Why | Version | Trust boundary | Failure effect | Replaceable | Status |
|---|---|---|---|---|---|---|---|
| Node.js standard library | Runtime | HTTP, crypto, fs, test runner, CLI I/O | v26.4.0 (verified) | Local runtime | Harness cannot run at all | No (language runtime) | Accepted, OBSERVED |
| Ollama HTTP API | External process (optional) | Model inference | UNKNOWN until documented in PHASE 1 | Localhost network boundary; untrusted response body | Proposal stage unavailable -> fail closed, no execution | Yes (provider interface) | Not installed on this machine; provider implemented against documented contract |

Third-party packages: none. Any future addition must complete the Dependency Discipline
checklist and be recorded in `docs/matrices/DEPENDENCY_MATRIX.md` first.

---

## Threats

Initial register (full analysis in `docs/matrices/THREAT_MATRIX.md` and `docs/THREAT_MODEL.md`):
prompt injection through user text or tool output; capability hallucination; argument
substitution between confirmation and execution; stale/replayed confirmation; permit
reuse; arbitrary endpoint execution; SSRF-like adapter misuse; evidence tampering; secret
leakage into evidence; model failure interpreted as success; verification bypass;
privilege escalation through capability metadata drift.

---

## Failure Modes

Initial register (full analysis in `docs/matrices/FAILURE_MATRIX.md`): Ollama unavailable;
Ollama timeout; HTTP 404 model missing; malformed JSON from the model; valid JSON with an
unknown capability; valid capability with invalid arguments; missing required information
(clarify, do not invent); adapter unavailable/disabled; adapter returns an error; adapter
returns success without effect (verification must fail); verification failure; evidence
write failure; expired permit; replayed proposal; duplicate execution request.

---

## Assumptions

Full register with verification methods in `docs/matrices/ASSUMPTION_MATRIX.md`.
Highest-consequence assumptions:
1. The collaborator's system can expose at least one operation whose effect can be queried
   independently after execution (needed for verification to be more than an echo).
2. A bounded capability set (tens, not hundreds, exposed per task) is acceptable; models
   degrade when overloaded with tools (to be supported or contradicted by PHASE 1 research).
3. Confirmation prompts are acceptable to the collaborator's users for FINANCIAL risk.
4. The operator will run Ollama locally when real-model validation is performed.

---

## Tests / Evidence

**114 tests across 14 modules, all passing; benchmark 37/37 cases, 169/169 expectations,
0 unauthorized executions.** The full record — exact commands, results, and what the evidence does
NOT show — is `docs/EVIDENCE.md`. Reproduce with `node scripts/verify.mjs` (set `SAH_TSC` first, or
accept the loud failure).

Coverage map: acceptance gate (14 items) · security fail-closed matrix (15 probes) · contracts
(canonical hashing, schema engine, envelope parsing) · registry (definition validation, complexity
budget, sealing) · authority and confirmations (binding, single use, expiry, staleness, replay) ·
capability awareness (10 checks incl. the eight required by the addendum) · adapters (mock, HTTP
restrictions, COMMIT_UNKNOWN, injection in responses) · evidence (chain, tamper detection, redaction,
privacy-minimal tool results, reconstruction) · verification (lying adapter, throwing verifier,
missing verifier, read re-check) · provider (request shape, typed errors, timeout, unreachable,
scripted exhaustion) · config (invalid configs, loopback enforcement, headers file) · benchmark
(fixture coverage, taxonomy, report completeness, arm measurement) · CLI (transcript truthfulness,
exit codes, the three directive scenarios).

Defects found by this battery during the build are recorded with root causes in
`docs/reviews/IMPLEMENTATION_CRITIC.md` (IC-01…IC-07): transport codes hidden in `err.cause`,
over-broad redaction corrupting a metric, a disabled capability leaking into the context, a missing
origin link between proposal and confirmation turns, a broken nested `git init`, stale permit-binding
tests, and two definition-validation defects.

---

## Work Completed

### PHASE 0 — Environment and reference inspection (2026-09-21)
- Verified toolchain versions; verified Ollama absence; verified a usable offline `tsc`.
- Read the reference harness's governance/evidence source and its architecture and
  data-contract documents (list under Known Facts).
- Created the repository, `git init` on `main`, and the initial directory skeleton:
  `docs/`, `docs/research/`, `docs/matrices/`, `docs/reviews/`, `skills/`, `sops/`,
  `src/`, `tests/`, `benchmarks/`, `scripts/`, `config/`, `fixtures/`.
- Wrote this file.

### PHASE 1–14 — Research through handoff (2026-09-21)
- **Phase 1:** four parallel research streams against primary sources (Ollama API; constrained
  decoding and tool-calling failure modes; OWASP/NIST/RFC governed-execution security; agent
  benchmarking methodology). 55 findings with source, type, URL, access date, consequence and
  confidence; disagreements recorded rather than resolved (`docs/research/RESEARCH_LEDGER.md`).
- **Phase 2:** five matrices (dependency, threat 20 rows, failure 30 rows, decision 16 entries,
  assumption 14 entries) plus the finding→implementation matrix.
- **Phase 3–4:** 26 skills (13 runtime behaviour + 13 engineering) and 21 SOPs (13 runtime + 8
  engineering) in the operator's canonical skill format, plus a benchmark runner.
- **Phase 5:** architecture with contracts, 10 invariants, 10 trust boundaries, the closed status
  set, the state-machine mapping, and the configuration surface.
- **Phase 6:** Design Critic Gate — 3 BLOCKER and 10 HIGH findings, each resolved or accepted with a
  reason, before implementation (`docs/reviews/DESIGN_CRITIC.md`).
- **Phase 7–8:** bounded implementation (27 modules) and the test suite (114 tests) including the
  acceptance gate, the fail-closed security matrix, and the capability-awareness checks.
- **Phase 9:** benchmark with 37 fixture cases across 24 categories, including disabled capability,
  prompt injection from tool output, timeout before/after possible transmission, COMMIT_UNKNOWN,
  policy failure, arbitrary HTTP attempt, actor/workspace substitution and confirmation binding.
- **Phase 10–12:** implementation critic (15 findings, 7 of them fixed defects), minimality review,
  and the handoff audit (12 questions, two recorded external partials).
- **Phase 13–14:** documentation reconciled against the code (stale test paths corrected, statuses
  closed, evidence recorded), then one coherent initial commit.

---

## Work Rejected

- **Immediate implementation of the harness before research synthesis and the Design
  Critic Gate.** Rejected: Directive 2 explicitly forbids it, and the first directive's
  value depends on the control design being evidence-based.
- **Forcing `strict: true` TypeScript over hand-written JS before the code exists.**
  Rejected as premature: the type gate config is part of PHASE 5/6 and will be set to a
  level that is honest about JSDoc coverage rather than silently weakened.
- **A "rules-based intent parser" fallback in the CLI** (i.e. shipping something that
  looks like a model but is pattern matching). Rejected: it would create a fake success
  path. The scripted provider is a labelled fixture replay for tests and demos, and it
  goes through the identical pipeline.

---

## Current Blockers

None for v0.1. Two external dependencies limit what can be *measured*, and neither is a blocker:

1. **No local model runtime on this machine.** The provider is implemented and its failure path is
   tested, but model-quality columns (selection accuracy, argument correctness, clarification
   behaviour, hallucination rate, pass^k) cannot be measured here. Trigger: install Ollama and set
   `provider.model` in `config/harness.config.json`.
2. **No collaborator specification.** `docs/INTEGRATION_CONTRACT.md` states exactly what is needed
   per operation; until it arrives, only the generic HTTP adapter (against loopback fixtures) can be
   exercised.

---

## Open Questions

1. Which model will the collaborator run locally, and how many capabilities can its context and
   reliability budget tolerate per task?
2. Does his system expose a read-back endpoint sufficient for independent verification of each
   mutation? Without it, `EXECUTED_VERIFIED` is unreachable for that capability.
3. Will confirmation be a terminal prompt, a GUI dialog, or an external approval service?
4. Can his mutating endpoints accept idempotency keys, or must reconciliation replace retry entirely?
5. Does he require multi-user permission mapping in v0.1, or is a single operator permission set
   sufficient for the first integration?
6. Where does the collaborator-specific adapter live (inside `integrations/` here, or privately in
   his repository)? This is his IP-boundary decision, not ours.

---

## Next Smallest Step

Send `docs/INTEGRATION_CONTRACT.md` to the collaborator and ask for **one** operation end to end:
its route, request and response shapes, the permission it enforces, its transaction semantics, and
its read-back path. Then onboard exactly that one capability through
`sops/engineering/capability_onboarding.md` and run the benchmark's scripted arm to prove the wiring
before touching a second operation.

---

## Handoff Instructions

1. Read this file, then `README.md`, then `docs/ARCHITECTURE.md`.
2. Read `docs/matrices/DECISION_MATRIX.md` before proposing any structural change — most
   obvious alternatives are already recorded with rejection reasons.
3. Run `npm run verify` (or `node scripts/verify.mjs`) before and after any change; the gate
   is the source of truth, not this file's claims.
4. Never add a capability without completing `sops/capability_onboarding.md`.
5. Never widen authority to make a test pass. If a test requires weakening a control,
   stop and record why.
6. Update this file (Current State, Work Completed, Change Log, and any affected matrix)
   in the same change as the work itself.

---

## Change Log

| Date/time | Actor | Type | Summary |
|---|---|---|---|
| 2026-09-21 (session start) | opencode | checkpoint | Phase 0 complete: environment + reference inspected, repo created, initial known/unknown state recorded. Phase 1 research dispatched. |
| 2026-09-21 | opencode | update | Phase 1–2 complete: research ledger (55 findings, R-01…R-55) and finding→implementation matrix written from primary sources; five engineering matrices created. |
| 2026-09-21 | opencode | decision | Capability awareness became a first-class subsystem (addendum): capability context pack, deterministic selection, snapshot binding, disabled-capability filtering, context budget, arm experiment. Implemented in `src/registry/context.mjs`; documented in `docs/CAPABILITY_AWARENESS.md`. |
| 2026-09-21 | opencode | decision | Consolidated directive integrated: `COMMIT_UNKNOWN` state, permit binding extended to capability version/snapshot/actor/workspace/argument hash/nonce, capability `enabled` revocation, idempotency metadata, privacy-minimal tool results in evidence, resident base contract separated from the SOP. |
| 2026-09-21 | opencode | bug | IC-01: undici exposes transport codes in `err.cause.code`, so definite connection refusals were classified as ambiguous commits. Fixed in the HTTP adapter and the Ollama provider; benchmark B30 and `tests/adapters.test.mjs` prove it. |
| 2026-09-21 | opencode | bug | IC-02: redaction matched credential words as substrings and replaced the `approxTokens` key, silently corrupting a benchmark metric. Matching is now exact-name/suffixed plus a camelCase list; both directions are tested. |
| 2026-09-21 | opencode | bug | IC-03: a disabled capability leaked into the model context via `relatedCapabilities` and via prose in one `whenNotToUse`. Related references are now filtered to the exposed set and the prose convention is pinned by test A02. |
| 2026-09-21 | opencode | bug | IC-05: the first nested `git init` left a partial `.git`, so git resolved to the parent AIDE repository. Re-initialised and verified; parent tree unaffected. |
| 2026-09-21 | opencode | checkpoint | Gate PASSED: lint OK, typecheck OK (zero errors), 114/114 tests, benchmark 37/37 with 0 unsafe executions. Evidence recorded in `docs/EVIDENCE.md`; three reviews written; requirements traceability closed (SAH-REQ-001…066). |
| 2026-09-21 | opencode | checkpoint | Phase 14: one coherent initial commit created on `main` after the gate passed (SHA reported in the handoff message; `git status` clean). |
