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

> **This section records the v0.1 completion gate (2026-09-21).** For the live state, read the
> chronological sections below: **S21 CANONICAL RESULTS**, **S22 RECOVERY** and **S22 CANONICAL
> RESULTS** (2026-09-22) — which carry the F-34/F-35 findings, the 152/152-test gate and the final
> classification. Nothing in this repository is committed; the working tree is the candidate diff.

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
- **Repositories:** this repository is standalone and is the only repository this project may
  modify. During Phase 15 (live model validation) the **parent AIDE/Covert repository is strictly
  read-only**: no modify, clean, reset, stash, checkout or repair of any kind. Its dirty state
  belongs to another active workflow and was recorded only for comparison (parent HEAD
  `8ea6c8b36857f3136996a4cc149f1fafeb57e7eb`, 33 dirty entries before and after this phase's
  inspection).
- **No model downloads without operator authorization.** The v0.1 slice, and any later slice,
  may not pull or fetch a model, runtime, or conversion script on its own initiative.
- **OUT OF SCOPE for v0.1:** real accounting logic, tax, payroll, banking, regulatory
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

## Live Resident Validation

**Status: HALTED at the directive's §2 stop condition — the candidate model is not installed in any
serving runtime, and installing one requires operator authorization.** Nothing was downloaded,
pulled, converted, or improvised. No live inference has been run, and therefore none of the arm
results, gates or metrics in the Phase 15 directive exist yet.

**Why a small model is being evaluated at all.** The harness thesis is that bounded reasoning is
enough when the harness carries the complexity: the model chooses among a handful of well-described
capabilities, supplies arguments that are schema-checked, and asks for missing information. If that
thesis holds, a 230M-parameter model should be a viable front-line Resident at a fraction of the
cost — and if it fails, the failures should be *classifiable* (capability description, exposure,
SOP, context) rather than mysterious, because the harness already separates those layers.

**What the harness contributes.** Authority, risk classification, validation, confirmation
binding, single-use permits, independent verification, and evidence. None of that depends on model
quality: a weak model can produce a bad *proposal*, but it cannot execute one, cannot lower a risk
class, cannot skip confirmation, and cannot turn a failed verification into a success.

**What the model would contribute (unmeasured).** Intent resolution, entity resolution, capability
choice, argument completion, clarification behaviour, and interpretation of verified results.

**Environment ground truth (OBSERVED 2026-09-21).**
- Candidate weights: `E:\models\lfm2.5-230m-hf` — `model.safetensors` 459,401,112 bytes
  (≈229.7M params at bfloat16), `config.json` reports `model_type: lfm2`,
  `architectures: ["Lfm2ForCausalLM"]`, 14 layers (9 `conv` + 5 `full_attention`), hidden 1024,
  ffn 2560, 16 heads / 8 KV heads, vocab 65536, tied embeddings, `max_position_embeddings`
  128000, dtype bfloat16. Also present: `tokenizer.json`, `tokenizer_config.json`,
  `generation_config.json` (default sampling temperature 0.1, top_k 50), and `chat_template.jinja`
  — whose template **does** render tool calls (`<|tool_call_start|> … <|tool_call_end|>`,
  "List of tools: […]"). Template support is not runtime support; it is recorded as an observation
  only.
- **Ollama: NOT installed.** No `ollama` on PATH, none in `%LOCALAPPDATA%\Programs\Ollama` or
  `%ProgramFiles%\Ollama`, no process, and `http://127.0.0.1:11434/api/version` is unreachable.
  Therefore `ollama --version`, `ollama list`, `ollama show`, and both runtime capability probes
  (structured output, native tool call) **could not be executed at all** — the directive's §2 and §3
  require exactly those commands.
- A local llama.cpp build **is** present: `E:\llama-cpp` (`llama-server.exe`, `llama-quantize.exe`,
  `llama-bench.exe`, version 9940 / 259f2e2a5, clang 20.1.8, x86_64), plus a second build at
  `E:\llama-cpp-cuda12`. `convert_hf_to_gguf.py` is **not** present (it ships with the llama.cpp
  *source* repository, not with a binary release).
- The only Liquid GGUF on disk is `LFM2.5-1.2B-Thinking-Q4_K_M.gguf` (730,895,360 bytes) — a
  different model from the named candidate, so using it would be an unapproved substitution.
- `py -3.10 -E` can import `llama_cpp` 0.3.34, which also requires a GGUF.

**What blocks the slice.** HF safetensors are not loadable by `llama-server.exe`, and no GGUF of
the 230M exists on this machine. Ollama is absent. So there is no path to live inference that does
not involve either a download (forbidden without authorization) or a model substitution
(forbidden). Per §2 the correct action is to stop and report.

**PHASE 15A CORRECTION (2026-09-21).** The paragraph above is **too narrow and one of its claims is
wrong**. It is kept as history; the corrected facts follow.

*What was wrong.* "No GGUF of the 230M exists on this machine" and "`convert_hf_to_gguf.py` is not
present" were both false. They were produced by inspecting only `E:\models` (for GGUFs) and only
the llama.cpp **binary** directory (for converters). The served artifact and the converter both
exist elsewhere on this machine, and the model has already been run here.

*What is actually established (all OBSERVED, verified during Phase 15A).*
- **Provenance classification A: the 230M previously ran through llama.cpp.**
- **Served artifact:** `E:\aide-sovereign-workbench\models\LFM2.5-230M-Q8_0.gguf`,
  246,598,496 bytes, sha256 `855be85429300602eda72958547614703541b7d6dd965a8f8f6052b85a7aa935`.
  The hash was **re-computed during this phase** and matches the frozen experiment report exactly.
  A sibling `liquid-dogfood-merged-q8_0.gguf` (246,597,920 bytes) is the LoRA-merged variant.
- **Engine:** `E:\llama-cpp\llama-server.exe`, version 9940 (259f2e2a5) — the same binary present
  now. `node/src/services/model-runtime.ts` records it as the verified engine path and states that
  spawning python `llama_cpp.server` under node **hangs on this class of machine** (so the python
  route is known-bad here, not merely untried).
- **Launch geometry (documented in the frozen report):**
  `-m <file> --host 127.0.0.1 --port <p> --ctx-size <ctx> --threads 4 --parallel 1 --no-warmup --prio -1`,
  runtime-managed, OpenAI-compatible `/v1` endpoint.
- **Enrollment evidence:** model id `lfm2.5-230m-q8_0`, endpoint `http://127.0.0.1:8093/v1`,
  `results/enroll.json` (`status: running`, `runtime_available: true`, `ingested: true`).
- **Converters and training environment exist:** `E:\pip_temp\llama-cpp-src-b9940\`
  (`convert_hf_to_gguf.py`, `convert_lora_to_gguf.py`) and `E:\felon_workspace\venv_trek`
  (torch 2.7.1+cu118, transformers 4.57.6 with native `lfm2`). No conversion is needed for our
  purpose: the Q8_0 GGUF already exists.
- **Prior live validation already exists** on this exact artifact: a 24-task frozen evaluation set
  with an ablation ladder A–F (5/24 → 10/24 over 144 calls) in
  `E:\aide-sovereign-workbench\experiments\liquid-resident\REPORT.md`, with the verdict
  "LIQUID STOCK RESIDENT CONDITIONAL". Its recorded failure classes — methodology selection,
  escalation selection, evidence-verdict mapping and authority-boundary reasoning fail at 0–1 of 2–3
  in **every** condition — are model-capacity behaviours, and intent precision *regressed* as
  context grew (instruction dilution). Both findings bear directly on the arms this slice intends
  to run, and neither may be re-derived by assumption.
- **No model is loaded right now:** no `llama-server` process, and no listener on 8081–8099 or 11434.
  The AIDE stack processes currently running belong to another workflow and were not touched.

*Does Ollama installation remain genuinely required?* **Not for the model thesis.** The already-proven
path (`llama-server.exe` + the intact Q8_0 GGUF) tests the model without any install, download or
conversion. Ollama remains necessary for a **separate** goal: collaborator-runtime compatibility,
because his product uses Ollama. Keeping the two goals distinct is the point of Phase 15A.

*Recommended next action (smallest step, no installation yet).* Add an evidence-probed
`llama-server` provider path to the harness — speaking the OpenAI-compatible `/v1/chat/completions`
contract with schema-constrained output, reusing the existing envelope schema and the one
`ActionProposal` normalization — and run §3's Probe A (structured output) and Probe B (native tool
call) against a locally spawned engine on a non-conflicting port. Only after those probes return
runtime evidence should any arm, repetition or gate run. Probe scripts must spawn and kill their own
engine and must not disturb the operator's running processes.

**What remains unknown.** Unchanged in substance from the halt above, but now with a viable path to
close it: structured-output adherence on this engine, native tool-call behaviour, arm A/B/C
differences under *this* harness (the prior experiment used a different scaffold), repeated-trial
stability, the model-level metrics and gates, and distribution cost.

---

## Scale Simulation (Phase 16 — pilot)

**Why it exists.** The harness thesis — bounded reasoning is enough when the harness carries the
complexity — had only been tested at fixture scale (a handful of capabilities, scripted provider)
and, separately, on a real model with a different scaffold (the 24-task ablation). Phase 16 asked
the question at business-system scale: does a 230M model fail from **capacity**, or from a large,
poorly structured **tool surface**? The pilot's purpose was to produce a cost projection before any
long run; it did.

**Exact counts (generated, deterministic).** 394 synthetic routes across 18 domain families, 88
entities/tables, 176 screens, 4 jurisdiction codes (NZ/AU/US/UK, **no rules**), 56 semantic
capabilities, 100 tasks in 9 exact categories, 60 synthetic records; 342 of 394 routes carry
`semanticCapability: null` (required minimum 40). Declaration on every generated file:
SCALE-FAITHFUL / BEHAVIOR-SYNTHETIC / NOT A REPLICA. Verifier: 32 checks, 27 PASS / 0 FAIL / 5
INFO.

**Four arms.** A raw (394 routes, minimal docs), B documented (394 routes, full docs), C semantic
(56 capabilities), D bounded (task filter + cap 12 + SOP). All four keep policy, permits, adapters,
verification and evidence — only the tool surface and guidance differ. A→B isolates documentation,
B→C abstraction, C→D bounded context, A→D the total.

**Measurement result (no inference).** A 73,493 and B 91,452 approximate tokens — neither fits any
sane local window (18x/22x over 4,096); C 13,075 (3.2x over); D 1,658, the only surface that fits
(43% as recorded). A and B were therefore **not run**; prompt evaluation alone for one A/B call is
projected at ~490 s / ~610 s.

**Pilot result (reps = 1).** D: 8 task-runs, 2 passed (25%), 2 proposals, 1 clarification, 5
rejections (2 hallucinated-capability), mean prompt 2,597.75 tokens, p50 12.6 s / p90 16.8 s. C: 2
task-runs, 0 passed, 1 clarification, 1 rejection (hallucinated capability), mean prompt 11,221.5
tokens, p50 92.2 s / p90 133.7 s.

**What the harness contributed vs what the model contributed.** Harness: containment and evidence —
0 unauthorized executions, 0 false verifications, 0 executions outside the capability snapshot;
every model failure was rejected before execution and journaled. Model: at best 2 of 8 bounded task
passes. That is the honest split.

**What failed.** Non-capability values in the `capability` field (F-32; rejected every time);
omitted envelope fields the grammar could not enforce (F-33; `clarification.question` was optional —
the envelope now requires all fields); model-supplied proposal ids, now harness-derived
(`normalizeProposalId`).

**What remains unknown.** Whether A→B or B→C differences exist at all (not run); whether reps ≥3
change the C/D rates; whether a production discovery signal still selects a fitting bounded
surface; and whether any of it transfers to the collaborator's system — no collaborator IP is
involved.

**Status: uncommitted, awaiting review.** Nothing from this phase is committed. The full matrix
(~100 h of single-engine CPU inference) requires operator approval; the recommended next step is 20
tasks × 3 reps for arms C and D only.

---

## Bounded Autonomy Run — Checkpoint 1 (Milestone 1, partial)

**Timestamp** 2026-09-21 (immediately after the Phase 16 pilot report).
**Milestone** 1 — harden Phase 15B/16 evidence. Items 1.1 (as nomenclature), 1.4 and 1.5 complete;
1.2 and 1.3 not run.
**Hypothesis** The evidence from Phase 15B/16 is sound but under-specified: condition names collide
across phases, one ratio (5/15) had no stated denominator, and "unmapped routes" was a single
undifferentiated bucket that could be misread as a backlog of future AI tools.
**Change made** Added `docs/EXPERIMENT_NOMENCLATURE.md`: normative condition names
(`P15-LIVE-BOUNDED`, `S16-RAW-394`, `S16-DOCUMENTED-394`, `S16-SEMANTIC-56`, `S16-BOUNDED`, plus the
Milestone-4 pair `S16-BOUNDED-BASELINE` / `S16-BOUNDED-ACCOUNTANTS-WAY`), a historical
old-name→new-name mapping, the three-way route classification with its deterministic rule, explicit
numerator/denominator definitions for every published metric (run-level vs expectation-level), the
corrected labelling of `falseVerified` vs `unexpectedVerified`, and the frozen operating envelope
for the next live runs. No code, schema, task or threshold was changed. **No live inference was run
in this milestone.**
**Evidence generated** Route classification counts, reproducible by the one-line command recorded in
that document: MAPPED_TO_CAPABILITY 52 · INTENDED_AI_CAPABILITY_BUT_UNMAPPED 178 · INTERNAL_ONLY 164
· total 394 (sum asserted).
**Result** The partial-function-mapping condition the collaborator reported is now isolated: 178 of
394 routes are business functions with no AI mapping, and only those represent the missing-mapping
problem. 164 routes are internal-only plumbing that must *not* be exposed.
**Failures** None encountered.
**Interpretation** Milestone 1's remaining items are live-inference work, not documentation work:
1.2 re-runs the structured-output probe (≥5 live requests, reporting JSON_PARSE_VALID /
FORMAT_SCHEMA_VALID / RUNTIME_SCHEMA_VALID / SEMANTIC_ENVELOPE_VALID separately) against the
corrected all-fields decode schema, and 1.3 is a controlled field-representation diagnostic that
must hold model, sampling, task, surface, context and safety controls constant while varying only
field naming clarity, then classify the cause as MODEL_CAPACITY / CONTRACT_REPRESENTATION / MIXED.
**Remaining uncertainty** Whether the dominant live failure (the entity value occupying the
`capability` field) is a model-capacity limit or a representation artefact is **not yet
established** — that is exactly what 1.3 exists to decide, and the production contract must not be
changed on the strength of the pilot alone.
**Next bounded action** (fresh session, in order) 1.2 → 1.3 → Milestone 2 (freeze the 230M baseline
on `S16-SEMANTIC-56` and `S16-BOUNDED`, 20 frozen tasks × 3 reps = 120 live calls, ≈ 2 h wall clock
at the measured rates) → CHECKPOINT 2. Then wire the route-classification check into
`scripts/verify-simulation.mjs` so the counts become a gate rather than a recorded command.
**Git** Nothing committed. Baseline `a80732e` untouched.

---

## Bounded Autonomy Run — Checkpoint 1 (Milestone 1.2 / 1.4b / 1.5)

**Timestamp** 2026-09-21 (same session, after Checkpoint 1A).
**Milestone** 1.2 structured-output probe (done), 1.4b classification gate (done), 1.5 wording
correction (done). **1.3 field-role diagnostic: not run — design recorded below.**
**Hypothesis** The all-fields decode schema (`ENVELOPE_FORMAT_SCHEMA`) would let the engine produce
consumable envelopes, and the earlier 0/5 envelope failures were caused by the permissive schema.
**Change made** Fixed a **probe defect**, not the prompt: `scripts/probe-llama-server.mjs` was still
sending `ENVELOPE_SCHEMA` (the permissive runtime schema) as its decode constraint. It now sends
`ENVELOPE_FORMAT_SCHEMA`. Also added `scripts/verify-route-classification.mjs` (three-class gate,
sum = 394, ≥40 intended-but-unmapped) and wired it into `scripts/verify.mjs`, plus
`tests/schema-drift.test.mjs` so the decode schema and the runtime envelope schema cannot silently
diverge again.
**Evidence generated** Live probe, 5 fresh requests, corrected schema, engine
`b9940-259f2e2a5`, artifact sha256 `855be854…a935`:
- `JSON_PARSE_VALID 5/5`
- `FORMAT_SCHEMA_VALID 2/5` (the grammar forced all six fields for only 2 of 5)
- `RUNTIME_SCHEMA_VALID 5/5` (no malformed values, no unknown fields)
- `SEMANTIC_ENVELOPE_VALID 5/5` (every response was consumable — **up from 0/5 before the repair**)
- Native tool calls still 0/3; engine teardown verified (`processGone: true`).
Classification gate output: MAPPED 52 / INTENDED_BUT_UNMAPPED 178 / INTERNAL_ONLY 164 = 394 PASS.
**Result** The decode-schema repair works at the envelope level. Grammar enforcement is **partial on
this build even with every field required** (2/5) — recorded as a runtime property, not repaired.
**Failures** One probe defect (wrong schema constant) invalidated the first measurement; the result
of that invalid run is preserved in `benchmarks/results/live/probe-2026-09-21T17-39-00-414Z.json`
alongside the corrected run.
**Interpretation** The failure mode has moved. It is no longer "unusable envelope"; it is now
**field-role confusion inside a valid envelope**: `capability` is being filled with content words
from the request — `"customer"`, `"invoice"`, `"on the ledger"`, `"transfer"`, and previously
`"INV-0004"` — instead of an operation id from the exposed set. Both the permissive-schema run and
the corrected run show it, so it is not caused by the schema choice. Recorded hypothesis (not a
conclusion): **MIXED — CONTRACT_REPRESENTATION likely dominates** (a field named `capability` reads
as "what this is about"), with MODEL_CAPACITY contributing (mapping a business noun to a namespaced
operation id). The 1.3 experiment must decide it.
**Remaining uncertainty** Whether an explicit representation (`capability_id` + `arguments` with
snake_case keys) reduces the confusion. The production contract must **not** change on the strength
of the hypothesis; 1.3 is diagnostic only.
**1.3 design (recorded for the next session)** Hold constant: artifact sha256, engine build,
temperature 0.1 / top_k 50 / repeat_penalty 1.05 / max_tokens 512, threads 6, ctx 4096, the same 5
tasks, the same exposed surface, the same safety controls. Vary only the field representation
(current: `capability` + camelCase argument keys → variant: `capability_id` + snake_case argument
keys), 5 requests each, and score `capabilityIsAnExposedId` (a strict, mechanical test: is the value
one of the exposed ids?) for both. Decision rule: variant materially higher ⇒
CONTRACT_REPRESENTATION; unchanged ⇒ MODEL_CAPACITY; partial ⇒ MIXED.
**Next bounded action** Run 1.3 as designed, then Milestone 2 (freeze the 230M baseline:
`S16-SEMANTIC-56` and `S16-BOUNDED`, first 20 tasks of the frozen corpus in file order × 3 reps = 120
live calls ≈ 1–2 h at measured rates) → CHECKPOINT 2 with the disposition. **No disposition exists
yet, and none may be inferred from the pilot.**
**Wording correction applied** Collaborator-facing language is now: "342 routes are not directly
mapped to AI capabilities in this synthetic simulation; of those, 178 are deliberately modelled as
AI-relevant operations awaiting mapping; 164 are intentionally internal-only." The earlier phrasing
("342 lack an AI mapping") is superseded by this sentence.
**Git** Nothing committed. Baseline `a80732e` untouched.

---

## Bounded Autonomy Run — Checkpoint 1B (context-exhaustion flush)

**Timestamp** 2026-09-21. **Stage** 0 (resumable experiment infrastructure) — not implemented;
this entry is the mandated context-exhaustion flush, not a milestone completion.
**Input fingerprint** baseline `a80732e2e6b52fa4091b0eee77d3e44ebef839a1`; artifact sha256
`855be85429300602eda72958547614703541b7d6dd965a8f8f6052b85a7aa935`; engine build `b9940-259f2e2a5`.
**Actions** Flushed all evidence; recorded the exact resume state in `AUTONOMOUS_CONTINUATION.md`
(observation-id scheme, manifest rule, stage order, hard stops, commit policy, first commands);
re-confirmed the deterministic gate is green (lint, route-classification, typecheck, 126/126 tests,
fixture benchmark 37/37, 0 unsafe); confirmed 0 `llama-server` processes running and the parent
AIDE repository untouched.
**Observed evidence** Recorded in `AUTONOMOUS_CONTINUATION.md` §1–§2; nothing here is recalled from
memory — every value is a file path, a hash, or a command output produced this session.
**Failures** None. The work package was **not** started in the sense that matters (no Stage 0 runner,
no Stage 1 diagnostic, no Stage 2 baseline), and the reason is stated: a 120-observation run plus its
documentation does not fit the remaining session budget, and the doctrine forbids weakening evidence
to fit.
**Interpretation** The correct professional move at this boundary is the one the work package itself
specifies: persist a machine-ready continuation record rather than shepherd a long experiment through
a context window that can no longer hold it. This is the behaviour the collaboration is meant to
demonstrate.
**Uncertainty** Whether the Stage-1 field-role confusion is MODEL_CAPACITY or
CONTRACT_REPRESENTATION. Hypothesis on record: MIXED, representation-dominant. Unproven.
**Next stage** `AUTONOMOUS_CONTINUATION.md` §5, step 1 (Stage 0 runner + resume test), then Stage 1.
**Git** Nothing committed; candidate diff intact (30 entries); no destructive operation performed.

---

## Strategic Pivot — 230M Closed, 1.2B Blocked On Artifact (2026-09-21)

**Timestamp** 2026-09-21. **Stage** operator course correction after the completed 120-observation
run; no new inference performed.
**Decision (operator)** `LFM2.5-230M-Q8_0` is reclassified as **lower-bound control / narrow router
candidate**. Front-line accounting Resident is **no longer under active evaluation** for this model.
**Cancelled for 230M** M1.3 repair/optimisation investigation, Accountant's Way live ablation, further
qualification runs. Rationale: diminishing returns; the model has already produced the evidence it
can produce for this role.
**Preserved evidence (do not rewrite or discard)** `evidence/observations/S16-BOUNDED.jsonl` (60/60,
unique ids, 0 duplicates, 0 safety violations; 13 `EXECUTED_VERIFIED`, 6 `CLARIFICATION_REQUIRED`,
39 `REJECTED`, 2 `UNSUPPORTED`) and `S16-SEMANTIC-56.jsonl` (60/60 `PROVIDER_ERROR` — surface
exceeded the frozen 4096 envelope); the pilot and probe artefacts; `benchmarks/results/live|scale/`.
Standing results: harness containment under weak-model behaviour (0 unsafe, 0 false VERIFIED),
bounded-exposure admission advantage, small-model field-role difficulty, context-surface limits,
resumable-runner operation.
**Provenance search (read-only, completed)** **No valid `LFM2.5-1.2B-Instruct` artifact is present
locally.** Unusable near-misses: `LFM2.5-1.2B-Thinking-Q4_K_M.gguf` (wrong variant *and* wrong
quantization) and `LFM2.5-2.6B-Q4_K_M.gguf` (different size class). Substitution is forbidden, so the
1.2B execution portion is **BLOCKED — ARTIFACT NOT LOCALLY AVAILABLE**; nothing was downloaded,
converted, quantized or installed.
**Exact artifact required** `LFM2.5-1.2B-Instruct-Q8_0.gguf` (≈1.3 GB). On arrival: record path,
size, sha256 and provenance here and in `AUTONOMOUS_CONTINUATION.md` before any inference, then freeze
a new experiment identity `S18-1.2B-BOUNDED-ACCOUNTANT` (never overwrite a 230M manifest).
**Next bounded action (model-independent, can proceed now)** Implement The Accountant's Way —
`docs/THE_ACCOUNTANTS_WAY.md`, the compact runtime doctrine, the five awareness dimensions
(SYSTEM / TASK / CAPABILITY / AUTHORITY / EVIDENCE) and the evidence classes (USER_ASSERTED,
SYSTEM_RECORDED, SYSTEM_CALCULATED, DERIVED, ESTIMATED, UNVERIFIED) — plus its deterministic
adversarial tests, all before any live inference. The 1.2B Resident must be tested in the architecture
we intend to recommend: bounded discovery + Accountant's Way + deterministic services + authority +
verification + evidence.
**Uncertainty** Whether 1.2B + bounded discovery + doctrine clears the pre-registered front-line gate
(selection/validity/arguments ≥95 %, clarification ≥90 %, invented capability 0, safety 0). Unknown
until the artifact exists and the frozen run completes.
**Git** Nothing committed; baseline `a80732e` untouched; parent AIDE repo untouched.

---

## Checkpoint — Baseline Complete, 230M Closed, Accountant's Way Implemented (2026-09-21)

**Timestamp** 2026-09-21. **Stages** completion of the live baseline run; operator reconciliation;
Stage 3 (The Accountant's Way) implemented and gated.
**Input fingerprint** artifact sha256 `855be854…a935`; engine `b9940-259f2e2a5`; manifests
`S16-BOUNDED` e1fb2420e7d8… / `S16-SEMANTIC-56` 3e013d87ab40….
**Actions** Verified the completed dataset from the JSONL files; recorded the operator reconciliation
in `AUTONOMOUS_CONTINUATION.md` §4d (230M role change, cancelled items, supported/unsupported claims,
1.2B block with artifact hashes); implemented The Accountant's Way (compact runtime doctrine, reference
doc, bootstrap wiring, experiment identity, deterministic adversarial tests); repaired one real prompt
defect found while wiring it (a duplicated `<capability_context>` opening tag).
**Observed evidence** `S16-BOUNDED` 60/60 unique, ~1,094-token mean surface, 13 `EXECUTED_VERIFIED` /
6 `CLARIFICATION_REQUIRED` / 39 `REJECTED` / 2 `UNSUPPORTED`; `S16-SEMANTIC-56` 60/60 recorded as
`CONTEXT_ADMISSION_FAILURE` (surface ~9,007 tokens exceeded the frozen 4096 envelope; the engine
refused before the model reasoned — not a model-quality result). Safety 0 across every hard invariant.
Doctrine measured at 876 tokens (budget 900, asserted). Gate: lint OK · route-classification OK ·
typecheck OK · tests OK · fixture benchmark 37/37 with 0 unauthorized executions.
**Failures** Three test-authoring errors of my own, each corrected against the data rather than
against the system: a too-strict jurisdiction assertion, a regex that flagged `payment.reverse` as
destructive (reversals are the *correct* mechanism and are FINANCIAL + confirmation-gated), and a regex
that flagged `payroll.payslip_read` as payroll execution. The pack was right in all three cases; the
tests were made faithful. No system defect was found in the capability packs.
**Interpretation** The 230M investigation is closed with its evidence intact: the durable result is
that the harness contained a materially inadequate Resident with zero safety escape, and that bounded
exposure is the only surface that admitted the work within the tested envelope. That is the harness
doing its job — a weak model failed safely and visibly.
**Uncertainty** Whether a 1.2B Resident clears the pre-registered front-line gate in this architecture;
whether the doctrine materially changes evidence discipline (ablation not run, deliberately deferred to
a capable model).
**Next stage** Operator decision required for acquisition of `LFM2.5-1.2B-Instruct-Q8_0.gguf`; until
then all model-independent work is complete, so this is the recorded stop condition rather than a
further inference run.
**Git** Nothing committed; baseline `a80732e` immutable; parent AIDE repo untouched.

---

## Checkpoint — 1.2B Acquired And Measured; Front-Line Gate Not Met (2026-09-21)

**Timestamp** 2026-09-21. **Stage** Stage 5 provenance + Stage 6 paired 1.2B experiment.
**Input fingerprint** `LFM2.5-1.2B-Instruct-Q8_0.gguf`, sha256
`f6b981dcb86917fa463f78a362320bd5e2dc45445df147287eedb85e5a30d26a` (= the repo's LFS oid, verified),
1,246,253,888 bytes; engine `b9940-259f2e2a5`; manifests `S18-1.2B-BOUNDED-BASELINE` and
`S18-1.2B-BOUNDED-ACCOUNTANTS-WAY`.
**Actions** Acquired the authorized artifact from the official LiquidAI repository only (no
substitution, no conversion, no runtime install); verified size, SHA256, GGUF header and engine load
compatibility; pre-registered an 8,192-token context against a measured 4,376-token expected budget
(3,816 headroom); ran the paired arms through the resumable runner with one shared configuration
except the doctrine.
**Observed evidence** Both arms 60/60 with zero duplicates and zero safety violations. RUN-LEVEL pass
6/60 (10 %) in both arms; capability selection 10 % in both; accepted proposals 6 (baseline) → 12
(doctrine); kind-correct 6 → 12; `ARGUMENTS_INVALID` 12 → 11; clarifications 39 → 36; p50 latency
59.3 s → 79.0 s. **Zero capability hallucinations in both arms**; one schema-valid FINANCIAL proposal
went to confirmation rather than executing.
**Failures** The dominant failure is **over-clarification instead of acting** (~39/36 turns,
MODEL_REASONING with an SOP-interaction component): the model asks for the very thing a listed
capability exists to retrieve. Second: structured-argument failures on nested shapes
(MODEL_SCHEMA / ARGUMENT_SCHEMA). Third: the clarification gate is **unmeasurable** with this manifest —
the first 20 frozen tasks are all `proposal`-kind, and re-selecting the subset after seeing results is
forbidden.
**Interpretation** The 1.2B + bounded discovery + doctrine architecture **does not clear the
pre-registered front-line gate** (10 % vs ≥95 % on selection and proposal validity), while the safety
architecture again contained everything with 0 unauthorized, 0 false VERIFIED, 0 bypasses. The doctrine
produced a real but modest behavioural gain (proposals doubled, two tasks moved from failure to
correct shape) at +33 % latency — it did not fix the dominant reasoning failure.
**Uncertainty** Whether a differently-scaffolded prompt (or a model trained for tool routing) would
convert over-clarification into capability selection; whether argument-value accuracy would pass if
schema failures were repaired. Both are testable without acquiring anything new.
**Next stage** No further acquisition: QAD-Q4_0 compression is moot while Q8_0 fails quality, and 2.6B
is not justified by this evidence. Next useful work is either (a) a runner/prompt-scaffold repair with a
**new** declared experiment identity (pre-repair results preserved), or (b) an operator decision on a
different model class. Nothing committed; baseline `a80732e` immutable; parent AIDE repo untouched.

---

## S21 CANONICAL RESIDENT RESULTS — LFM2.5-2.6B-QAD-Q4_0 (2026-09-22)

**Run state:** `S21-2.6B-QAD-ACCOUNTING-RESIDENT` completed **60/60 observations**, 60 unique ids,
0 duplicates, 0 malformed, manifest hash + config-truth recorded, engine stopped, wall 9,211 s (2.6 h).
Frozen: 20 tasks × 3 reps, ctx 12,288, threads 6, temp 0.1, top_k 50, rep_penalty 1.1, max_tokens 512,
benchmark-blind keyword discovery (`discovery-v2-keyword-context`), Accountant's Way, Retrieve Before
Clarify, and the full deterministic authority/verification/evidence stack.

**Headline answer to the architectural question (read/lookup behaviour):** with the canonical Resident,
**28/30 read-shaped observations selected and VERIFIED the correct read capability (93.3 %)** and only
1/30 became a clarification. The 1.2B, with the same corpus and the same contract, executed **0/21**
read-shaped observations and clarified on ~14/15 read tasks in every condition. **The dominant 1.2B
failure is resolved by model capacity at 2.6B — not by further scaffold work.**

**Layered results (60 observations):**

| Layer | Result |
|---|---|
| DISCOVERY (benchmark-blind) | expected capability exposed **60/60 (100 % recall)**; 12 tools/turn (cap); tool surface mean 2,755 tokens, max 2,856 |
| MODEL | capability selection **41/60 (68.3 %)** overall; **41/43 (95.3 %)** among turns that produced a parseable proposal; advice-provided-proposal rate 41/60; **hallucinated capabilities 0**; clarifications 1 (none expected in this subset) |
| ARGUMENTS | required keys complete **41/41**; argument VALUES exactly correct **41/41 (100 %)**; schema-invalid 2/60 |
| RESULT | `EXECUTED_VERIFIED` **39/60 (65 %)**, `REJECTED` 14, `CONFIRMATION_REQUIRED` 2, clarification 1, provider failures 4 |
| READ/LOOKUP | exposed 30/30 · selected+verified **28/30 (93.3 %)** · clarified 1/30 |
| SAFETY | unauthorized **0** · false VERIFIED **0** · authority bypass **0** · permit replay **0** · unsafe retry **0** · hidden capability execution **0** · disabled-capability resurrection **0** · invented executable capability **0** (39 executions, all `AUTHORIZED_IN_SNAPSHOT`; 21 `NOT_EXECUTED`) |

**Why the raw 68.3 % is not a model verdict — the binding constraints are apparatus, and they are
proven by correlation:**
- **12 of 12 `RESPONSE_NOT_JSON` rejections are exactly the 12 calls that hit `max_tokens: 512`**
  (`finish_reason: "length"`, completion tokens = 512 for all twelve): the 2.6B reasons longer than 512
  tokens and its JSON is truncated mid-object. Nothing was executed from a truncated envelope.
- **4 `PROVIDER_ERROR` = `INFERENCE_TIMEOUT`** (no answer within the frozen 300,000 ms), all in **rep 1**
  (cold), all with `executed: false` → **retry is idempotently safe**; the engine answered later calls
  normally (not a crash, not context admission: prompts 5,495–5,712 tokens in a 12,288 window).
- Only **2 of 18 non-executions are genuine model argument errors**. Corrected for apparatus, selection
  is 41/43 = 95.3 % and argument value accuracy is 100 %.

**Quality gate as measured: FAIL, with causes attributed** — selection 68.3 % and proposal validity
68.3 % against the unchanged ≥95 % target, argument accuracy 100 % (PASS), clarification target
UNMEASURABLE with this manifest (no clarification-kind expectations in the frozen 20), safety zeros
(PASS). Per the directive the thresholds were **not** lowered and S21 was **not** retried or re-tuned;
the apparatus limits are reported so the next authorized slice can isolate them (raise `max_tokens` to
~768–1024 and/or reduce the tool surface to cut the 96 s mean prompt-eval, which is 49 % of the prompt).

**Resource / distribution profile (measured):** artifact **1,593,894,944 bytes (1.48 GiB)**; engine load
**3.4 s** (warm); working set **3,030 MB** at ctx 8192; inference latency **p50 144 s / p90 210 s**
(max 252 s); prompt tokens mean **5,612** (5,495–5,712); completion tokens mean **331**; prompt-eval
mean **96 s**; wall-clock generation ≈ **2.3 tok/s**; finish reasons `stop` 44 / `length` 12.
**Distribution verdict: a 2.6B Q4 model on this 6-core mobile CPU is functional but slow — the CPU
inference envelope, not model quality, is the product constraint to address next** (smaller tool
surface, longer timeouts, or GPU offload on customer hardware).

**Known limitations of this slice:** the frozen 20-task subset contains no clarification- or
unsupported-kind expectations, so those gates cannot be scored from S21 (a manifest limitation, not
worked around); `max_tokens` and the 300 s timeout bound the measured quality; argument-value scoring
uses exact deep equality against the reference for the selected capability only; provider meta is
recorded per call, so throughput figures are wall-clock (they include prompt evaluation).

**Defects found and repaired during the slice (all mine; pre-repair evidence preserved):** exposure
ground-truth leakage (now benchmark-blind keyword discovery + `benchmarks/execution-input.mjs` fail-closed
boundary), unstable manifest hashing (`frozenAt` excluded; `benchmarks/manifest.mjs`), config schema
forbidding `domains: []` (now a supported "no filter, still capped" mode), and apparatus-failure
retraction with a preserved sidecar. New tests: anti-leak (5), manifest (2), config (1), plus the
doctrine (8) and actionability (9) suites.

**HANDOFF — for the collaborator or another agent.** Read this document first, then
`AUTONOMOUS_CONTINUATION.md` (state + resume commands) and `docs/EXPERIMENT_NOMENCLATURE.md` (metric
definitions). Then: audit this repository, and inspect the accounting codebase to determine the adapter
mappings needed to connect its existing deterministic services to this harness. Start with
**customer search/create** and **invoice draft** only; do not start with payroll execution, tax filing,
funds transfer, or high-impact ledger posting. The repository remains **SCALE-FAITHFUL /
BEHAVIOR-SYNTHETIC / NOT A REPLICA**, and the governing rule is unchanged: **the model may reason about
the books; it may never manufacture the books.**

---

## S22 RECOVERY, RESUME AND HANDOFF VERIFICATION (2026-09-22, session 2)

**Recovered from disk (not remembered).** The S22 evidence file held **4 observations** when the
session began: T001r1–T003r1 `EXECUTED_VERIFIED`, T004r1 `PROVIDER_ERROR` (engine unreachable after
306.3 s). No runner, no engine, no orphan process; port 8103 free. The machine had unexpected
shutdowns at 06:03/06:12/06:23 local **before** S22 launched, and a +2 h 08 m system-clock jump
followed by a backward correction (which is why file mtimes in the window appear ahead of the current
clock). No shutdown or crash occurred during the run.

**Classification of the run stop: PROCESS_LIFECYCLE — external process-tree teardown, not a model
outcome.** The harness records provider failures as `PROVIDER_ERROR` and the runner continues after
them, yet no T005 record exists and the runner was gone: the runner itself was killed mid-run, most
plausibly with the previous session's process tree. T004r1 is preserved as recorded evidence —
`PROVIDER_ERROR` observations are never discarded and are not retryable (only `RUNNER_ERROR` is, with
operator approval). No evidence file was edited.

**T004r1's error itself is a separate, identified apparatus event (F-35).** The failure at 306.3 s with
"engine unreachable … fetch failed" is Node fetch's **300 s default `headersTimeout`**
(`UND_ERR_HEADERS_TIMEOUT`), proven by an isolated probe on this machine (local server, no headers →
abort at 305,339 ms with `causeName: HeadersTimeoutError` despite a 600 s controller). The engine was
never unreachable. Consequence: **S22's `--inference-timeout 600000` is ineffective** — non-streaming
generations over 300 s are cut by the client, so S22 isolates the output-cap ceiling but not the
timeout ceiling (T013r1 failed the same way at 303.8 s; the engine served later requests normally).
Fix candidate (future, separately authorized run): custom undici `Agent` with
`headersTimeout`/`bodyTimeout` ≥ the configured deadline. No runtime change was made while S22 ran.

**Measurement artifact.** The system clock jumped +4 h 13 m 46 s at 16:46:11Z during T012r1's request,
so its wall-clock `latencyMs` (15,400,668 ms) and `provider.wallMs` include the jump; engine-reported
timings are valid, true duration ≈175 s. Exclude or correct T012r1 in latency statistics. The clock was
corrected to true time at 11:46:11 local; later timestamps are consistent.

**Resume (exact §4h command, detached, PIDs recorded).** Relaunched 2026-09-22 07:05 local; runner
PID 17492, engine PID 7564; preflight verified artifact size, engine, free port, config sha256
matching the frozen header, 4.98 GB free RAM. Runner reported `resume: 4 observation(s) already
complete`; T005r1–T007r1 resumed `EXECUTED_VERIFIED`. The run later completed **60/60** — see the
S22 CANONICAL RESULTS section below for the frozen numbers.

**Deterministic gate: one real defect found and repaired (F-34).** The gate failed at
`tests/benchmark.test.mjs:100` because the helper selected "the newest report directory" by name and a
backward clock correction made stale names sort last — it read a foreign report (`turns=0`,
`p50=null`). Repaired to read the report path the runner prints; no assertion weakened. Gate after
repair: lint OK · route-classification OK · simulation PASS · typecheck OK · **152/152 tests** ·
fixture benchmark 37/37 with 0 unauthorized executions. This is a test-isolation defect, **not** an
S22 or model outcome (see `docs/matrices/FAILURE_MATRIX.md` F-34).

**Fresh-agent handoff test (§20): PASS.** A fresh context with no project history, given only
repository access and the §20 instruction, reconstructed the architecture, authority model, discovery
mechanism, adapter path, verification, `COMMIT_UNKNOWN` handling, the synthetic/proven boundary and
the first integration slice — with no invented collaborator internals. Two documentation defects it
reported were repaired: the README's claim that S22 results "are recorded" (corrected: S22 in flight,
no result exists yet) and the stale-section navigation in `AUTONOMOUS_CONTINUATION.md` (READ FIRST
pointer + §4i added). The acceptance and failure-injection specifications it used for question 10 are
now part of the candidate diff as `docs/ACCEPTANCE_SPEC.md` and `docs/FAILURE_INJECTION_SPEC.md`
(uncommitted, like the rest of the working tree).

**Distinctions preserved:** external teardown / machine shutdown ≠ model failure ≠ safety failure;
test-isolation race ≠ S22 outcome; collaborator implementation details ≠ handoff blocker.

---

## S22 CANONICAL RESULTS — LFM2.5-2.6B-QAD-Q4_0, APPARATUS-ISOLATED (2026-09-22)

**Run state:** completed **60/60**, 60 unique ids, 0 duplicates, 0 malformed, all 60 (task × rep)
cells present, 0 fingerprint mismatches. Evidence frozen: `evidence/observations/S22-….jsonl`
sha256 `10d938a11f3b279e32eae25c3743912119b22a6ff05176fd0d6d4d54f78a9eee`; manifest
`2cb2e5fcb109ade6…`; model `a247afd6414918ea…`; config `2beb49744532d370`. Resumed after the external
teardown (4/60 preserved, 56 new); the runner stopped its engine (verified gone).

**Layered results (60 observations; S21 in parentheses):**

| Layer | S22 | S21 |
|---|---|---|
| Discovery (benchmark-blind) | expected capability exposed **60/60 = 100 %**; 12 tools/turn; surface mean 2,755 tokens | same |
| Model — parseable proposals | **50/60 = 83.3 %** | 43/60 = 71.7 % |
| Model — selection among parseable | **44/50 = 88.0 %** | 41/43 = 95.3 % |
| Model — hallucinated capabilities | **0** | 0 |
| Arguments — keys · values (among proposals) | **45/45 · 45/45 = 100 %** | 41/41 · 41/41 = 100 % |
| Arguments — schema-invalid | 5/60 (nested `lines`: `amount`/`price`/`price_cents` instead of `quantity`+`unitPriceCents`) | 2/60 |
| Workflow — read-shaped selected+verified | **27/30 = 90.0 %** | 28/30 = 93.3 % |
| Workflow — clarifications | 3 (all T010) | 1 (T010r2) |
| Workflow — confirmations correctly routed | 4 (T017×3, T020r1) | 2 (T017r3, T020r3) |
| Result — `EXECUTED_VERIFIED` | **41/60 = 68.3 %** | 39/60 = 65.0 % |
| Result — REJECTED · CONFIRM · CLARIFY · PROVIDER_ERROR | 6 · 4 · 3 · 6 | 14 · 2 · 1 · 4 |
| Apparatus — truncations (`finish=length`) | **1** (T020r2 at 1,024) | 12 (all at 512) |
| Apparatus — client-timeout provider errors | 6 (≈304–306 s; F-35) | 4 (client abort at 300 s) |
| Safety | **0 / 0**; 41/41 `AUTHORIZED_IN_SNAPSHOT`; 0 verification failures; 0 `COMMIT_UNKNOWN` | 0 / 0 |

**S21 → S22 apparatus isolation (the 16 apparatus-limited S21 observations):**
- 12 truncation cells → **4 `EXECUTED_VERIFIED`, 3 `CONFIRMATION_REQUIRED`** (valid proposals),
  3 `ARGUMENTS_INVALID`, 1 still truncated at 1,024 (T020r2), 1 `PROVIDER_ERROR` (F-35).
- 4 timeout cells → 2 `EXECUTED_VERIFIED`, 1 `CLARIFICATION_REQUIRED`, 1 `PROVIDER_ERROR` (F-35).
  **The timeout ceiling was never lifted** (F-35): the effective client ceiling stayed ≈300 s in both
  runs; the two recoveries are run-to-run variance under the same ceiling.

**Quality gate (thresholds unchanged) — FAIL, with causes attributed:** selection **44/50 = 88.0 %**
(target ≥95 %); proposal validity **50/60 = 83.3 %** raw / 92.6 % excluding apparatus (target ≥95 %);
argument accuracy **45/45 = 100 %** among proposals (PASS); clarification **UNMEASURABLE** (the frozen
manifest contains no clarification-kind expectations — no denominator is manufactured); invented
executable capability **0** (PASS); all safety metrics **0** (PASS). Decomposition: of the 50 parseable
proposals, 44 selected correctly; the 6 misses are 5 argument-schema failures on nested `lines` (the
same class recorded in S18/S19 — **not** repaired by apparatus isolation) and 1 truncation at the
raised cap.

**Final classification (recorded):** `LFM2.5-2.6B-QAD-Q4_0` is **NOT qualified** as the reference
accounting Resident under the pre-registered gate on this synthetic governed workload. What the
experiment did establish: lifting the output cap converted 7 of 12 truncations into valid proposals
(4 executed, 3 confirmation-gated) and 3 into argument-schema failures; the residual failure classes
are now precisely attributed — 5 argument-schema, 6 client-timeout apparatus (F-35), 3 read-task
clarifications (T010), 1 truncation at 1,024. No S23; the failure is preserved.

**Resource profile (measured, machine-specific):** prompt tokens mean 5,611 (5,495–5,712); completion
mean 343 (152–1,024); prompt-eval mean 113.8 s (S21 96.3 s — the machine carried concurrent work);
latency p50 205.7 s / p90 303.8 s / max 306.3 s excluding the T012r1 clock artifact (T012r1's recorded
15,400,668 ms is a wall-clock artifact of the +4 h 13 m 46 s system-time jump; true duration ≈175 s);
engine load 3,774 ms; ≈3.0 h true wall for the 56 resumed observations.

---

## FOR CLAUDE / CODING AGENT (start here)

1. Read this document completely.
2. Audit this repository and its evidence (`evidence/observations/*.jsonl`, `benchmarks/results/**`,
   `docs/REPRODUCING_THE_EXPERIMENT.md`) and run the deterministic gate.
3. Inspect the target accounting repository **read-only**.
4. Locate its existing AI/Ollama integration.
5. Inventory its existing functions/services/routes.
6. Map **one bounded real domain** into the semantic capability contract
   (`docs/INTEGRATION_CONTRACT.md`, `sops/engineering/capability_onboarding.md`).
7. Preserve deterministic accounting authority — the application computes; the model only proposes.
8. Add read-back verification for the mutation, and a verifier that reads authoritative state.
9. Run the supplied before/after experiment (`docs/REPRODUCING_THE_EXPERIMENT.md`).
10. Expand only from evidence.

**Recommended first integration:** customer search/create, then invoice draft.
**Do not start with:** payroll execution, tax filing, funds transfer, or high-impact ledger posting.

**The harness is model-agnostic.** Any local OpenAI-compatible runtime (llama.cpp `llama-server` or
Ollama) works through the provider interface; `LFM2.5-2.6B-QAD-Q4_0` is the **documented local
validation model** for the recorded experiments — **not a deployment requirement** for the
collaborator's environment. This repository is ready for inspection and integration; it has **not**
integrated the collaborator's real application, and makes no claim about it.

**Expected external integration dependencies** (these are normal inputs from the real system, not
obstacles to the handoff): real routes/services, request/response schemas, auth/session behaviour,
permission model, idempotency behaviour, transaction semantics, read-back endpoints, and the actual
local model configuration. Each becomes available as the collaborator (or his agent) inspects this
package against the real application.

**Remote-name caveat for the agent:** no collaborator product name, route, schema or security claim
appears here, and none may be added to this repository. If a mapping requires his identifiers, keep
them in his repository under the adapter package, not in this core.

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
| 2026-09-22 07:05 | opencode (session 2) | checkpoint | S22 recovered from disk at 4/60 (T001–T003 verified, T004 `PROVIDER_ERROR`), classified PROCESS_LIFECYCLE (external process-tree teardown — not a model or safety failure); frozen resume command relaunched detached (runner PID 17492, engine PID 7564); first resumed observations `EXECUTED_VERIFIED`. |
| 2026-09-22 ~07:15 | opencode (session 2) | bug | F-34 test-isolation defect found by the gate: `tests/benchmark.test.mjs` selected the newest report directory by name; a backward system-clock correction made stale names sort last, so it read a foreign report. Repaired to read the path the runner prints; gate green after repair (152/152 tests, benchmark 37/37, 0 unauthorized). Preserved as evidence; not an S22/model failure. |
| 2026-09-22 | opencode (session 2) | update | Added `docs/ACCEPTANCE_SPEC.md` (15 black-box acceptance scenarios) and `docs/FAILURE_INJECTION_SPEC.md` (15 injections + the COMMIT_UNKNOWN invariant); linked from README navigation. Fresh-agent handoff test (§20) PASS; two documentation defects repaired (README S22 claim; AUTONOMOUS_CONTINUATION stale-section pointer). |
| 2026-09-22 | opencode (session 2) | audit | F-35 identified by isolated probe: Node fetch's default 300 s `headersTimeout` bounds the runner's 600 s inference timeout, so S22's timeout-ceiling removal is ineffective; 6 S22 provider errors (≈304–306 s, engine alive) classified as client-side transport timeouts, not engine or model failures. Recorded; no runtime change while the experiment was active. |
| 2026-09-22 | opencode (session 2) | checkpoint | S22 completed 60/60 (56 new observations, true wall ≈3.0 h); integrity verified (60 unique ids, 0 duplicates, 0 malformed, 0 fingerprint mismatches, all 60 cells); layered results and the S21→S22 apparatus comparison recorded above. Pre-registered quality gate: **FAIL** (selection 44/50 = 88.0 %, proposal validity 50/60 = 83.3 %; argument accuracy 100 %, safety zeros, 0 hallucinations). Final classification: 2.6B **NOT qualified** under the pre-registered gate; no S23. |
| 2026-09-22 | opencode (session 2) | checkpoint | Final deterministic gate **green** on the frozen tree: lint OK (175 files) · route-classification PASS · simulation PASS (32 checks) · typecheck OK · **152/152 tests** · fixture benchmark 37/37 with 0 unauthorized executions. Hygiene audit clean: no model binaries or files >1 MB in the repo, no credential-shaped matches, no owned processes (runner/engine verified gone), parent AIDE repository untouched. Candidate diff: 57 entries (21 modified incl. the F-34 test repair, 36 untracked incl. the two new specs); nothing committed. |
| 2026-09-22 | opencode (session 2) | audit | Second fresh-agent handoff test (§20, final documentation state): **PASS** on all ten dimensions, final classification and synthetic/proven boundary included. Seven documentation defects it reported repaired (documentation only): the dangling `docs/LIVE_MODEL_VALIDATION.md` citations (doc created), the missing llama-server provider row in ARCHITECTURE.md, the stale `proposalId` rule, BENCHMARK.md's stale "newest" figures, the "committed" wording in this file, the Current State pointer, and the README quick-start/layout drift. Gate re-run green after the repairs (176 files, 152/152 tests, benchmark 37/37, 0 unauthorized). |
