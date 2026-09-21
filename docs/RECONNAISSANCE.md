# Reconnaissance — Sovereign Action Harness v0.1

Record of what was inspected before any code was written, what is reusable, what is deliberately
not ported, what v0.1 must contain, what is deferred, the verified environment, the
highest-consequence assumptions, and provenance. Read with `docs/ARCHITECTURE.md`,
`docs/research/RESEARCH_LEDGER.md`, and `COLLABORATOR_AGENT_NOTES.md`.

## Method

- Inspected on 2026-09-21: the operator's Windows machine; this repository's tree; and the
  reference repository `https://github.com/AnonymousNomad/cyber-sop-harness`, inspected at tree
  `23e643d1013ea3e294356913af6a848149739421`.
- What was inspected there: the Node governance and evidence sources
  (`edge-aide-cyber/src/governance/permit-issuer.mjs`, `policy-engine.mjs`,
  `evidence-chain.mjs`), `docs/data-contracts.md`, `ARCHITECTURE.md`, and
  `docs/architecture-decision-record.md`; see RESEARCH_LEDGER §5 (R-51..R-55).
- How: full file reads (not summaries), an HTTP probe of the local model-runtime endpoint, and
  shell version checks; findings and their epistemic labels are recorded in
  `COLLABORATOR_AGENT_NOTES.md` (Phase 0). No code from the reference repository was executed,
  nothing was installed, and no collaborator system was touched.
- Implementation did not start until research synthesis (PHASE 1), the matrices (PHASE 2), the
  architecture proposal (PHASE 3), and the Design Critic Gate (PHASE 4) were complete.

## REUSABLE

| Primitive | Where it came from in the reference repository | Why it exists | Threat or failure it handles | How this repository re-implements it | File |
|---|---|---|---|---|---|
| One-use permit with TTL and typed refusal reasons | `edge-aide-cyber/src/governance/permit-issuer.mjs` (R-51) | Authority must be explicit, bounded, and consumed once | Replay, expired authority, use against a different action | Permit bound to the canonical proposal hash; `consume({permitId, proposalHash, capability, runId})` refuses with typed codes; consumption is synchronous and immediately precedes execution | `src/policy/authority.mjs` |
| Three-way policy decision with a fail-closed wrapper | `edge-aide-cyber/src/governance/policy-engine.mjs` (R-52) | One choke point decides from trusted inputs only | Internal error becoming permission; model-asserted authority | `ALLOW` / `CONFIRMATION_REQUIRED` / `DENY` with a typed reason; internal errors resolve to DENY | `src/policy/policy-engine.mjs` |
| Append-only hash-chained evidence with redaction | `edge-aide-cyber/src/governance/evidence-chain.mjs` (R-53) | After-the-fact investigation needs tamper-evident records | Evidence modification or deletion; secrets leaking into logs | JSONL journal with `seq`/`prevHash`/`hash`, chain verification, redaction of secret-shaped keys before hashing | `src/evidence/journal.mjs` |
| Canonical action hash | `docs/data-contracts.md` (R-54) | Bind approval, authority, and execution to exactly one object | Argument substitution between confirmation and execution | `canonical-action-json-v1`: sorted keys, no insignificant whitespace, SHA-256 lowercase hex, array order preserved; the permit binds this hash | `src/core/canonical.mjs` |
| Architecture laws: the model is not the authority; no generic shell tool; plane separation | `ARCHITECTURE.md`, `docs/architecture-decision-record.md` (R-55) | Authorization must live in a component that cannot be argued with | Confused deputy, excessive agency, unreviewed authority paths | Proposal → validation → policy → permit → adapter → verifier planes; no shell/URL/eval capability; exposure is a deliberate act | `docs/ARCHITECTURE.md`, `src/registry/registry.mjs` |

## CYBER-SPECIFIC — DO NOT PORT

- **Engagement manifests and target scope evaluation** — they encode one pentest engagement's
  authorised targets, which has no analogue in a generic application harness (R-55).
- **Authorised-target allowlists** — a scope concept for offensive testing, not a capability
  risk class; v0.1 binds authority to a proposal hash instead (R-51, R-54).
- **Pentest tool adapters** — they wrap attacker tooling whose safety model is engagement scope,
  not application state (R-55).
- **Tor/DNS-leak/exfiltration opsec** — operator-survival tradecraft for offensive work; a local
  application harness has no such adversary model (R-55).
- **Worker containment (Job Objects, Windows Sandbox)** — it confines hostile tool processes;
  v0.1 executes no shell and no third-party process (R-55; no `child_process` use).
- **Mobile control plane** — a device fleet and remote-operation concern outside a
  single-operator local process (R-55; v0.1 is one process, one session).
- **Provider key custody/PKI** — cyber engagements carry provider credentials and operator
  identity; v0.1 holds no credentials and treats the local runtime as unauthenticated (R-12).
- **Cyber model catalogs** — model choices tuned for offensive/defensive tasks; the generic
  harness takes a provider interface and one configured model (R-55).
- **Rate limiting for recon** — it exists to avoid alerting a scanned target; v0.1 is
  single-operator and local, so rate limiting is deferred rather than ported (R-38).

## REQUIRED FOR V0.1

The delivered subsystems, with the module namespaces fixed by `docs/ARCHITECTURE.md` §2:

| Subsystem | Paths |
|---|---|
| Core primitives | `src/core/config.mjs`, `src/core/schema.mjs`, `src/core/canonical.mjs`, `src/core/util.mjs`, `src/core/errors.mjs` |
| Model boundary | `src/models/provider.mjs`, `src/models/ollama-provider.mjs`, `src/models/scripted-provider.mjs`, `src/models/prompt.mjs`, `src/models/response-parser.mjs` |
| Capability registry | `src/registry/capability.mjs`, `src/registry/registry.mjs` |
| Policy and authority | `src/policy/risk.mjs`, `src/policy/policy-engine.mjs`, `src/policy/authority.mjs`, `src/policy/confirmations.mjs` |
| Adapters | `src/adapters/mock-accounting-adapter.mjs`, `src/adapters/generic-http-adapter.mjs` |
| Evidence | `src/evidence/journal.mjs`, `src/evidence/verifier.mjs` |
| Synthetic domain | `src/domain/synthetic-accounting/capabilities.mjs`, `store.mjs`, `verifiers.mjs` |
| Orchestration | `src/harness.mjs`, `src/cli.mjs`, `src/bootstrap.mjs` |
| Configuration | `config/harness.config.json` |
| Prompts (SOP and base contract) | `prompts/accounting-resident.sop.md`, `prompts/resident-base-contract.md` |
| Benchmark | `benchmarks/prompts.jsonl`, `benchmarks/run-benchmark.mjs` |
| SOPs | `sops/runtime/` (13 files), `sops/engineering/` (8 files), `sops/README.md` |
| Skills | `skills/runtime/` (13 files), `skills/engineering/` (13 files), `skills/README.md` |
| Tests and fixtures | `tests/` (13 test files plus `tests/helpers/fixtures.mjs`), `fixtures/demo-script.jsonl` |
| Tooling and types | `package.json`, `tsconfig.json`, `types/node-min.d.ts`, `scripts/lint.mjs` |

The v0.1 tree also contains `src/registry/context.mjs` (the per-turn capability-context builder
used by the harness and the benchmark), in addition to the modules named in §2.

## DEFERRED

- Streaming NDJSON parsing — trigger: a real-model run shows latency or token-budget pressure
  (R-10).
- Bounded repair loop for invalid proposals — trigger: a measured real-model parse-success rate
  below the acceptance bar (R-25).
- Per-capability rate limiting — trigger: before any multi-user or network-exposed deployment
  (R-38).
- Adapter-level idempotency keys — trigger: the collaborator confirms a mutating endpoint and
  whether it accepts idempotency keys (R-35; A-5).
- OpenTelemetry metrics export — trigger: the harness is embedded in a monitored service (R-49).
- Journal rotation and retention — trigger: the operator requires a retention period, or journal
  volume becomes operationally significant (R-36, AU-11).
- Signed evidence (detached signature or external anchor) — trigger: the collaborator requires
  evidence that resists a privileged local rewrite (A-12; threat T-12).
- Multi-user identity and per-user permissions — trigger: the collaborator confirms more than one
  operator (A-13).
- Vector/semantic capability retrieval — trigger: a real workflow cannot be reduced to the
  deterministic exposure cap and keyword selection (A-1, A-9; R-22).
- Real-model benchmark arms (Ollama, k trials, pass^k) — trigger: a local model runtime is
  installed on the measurement machine (R-43; A-6).
- Containment planes (worker sandbox, mobile control) — trigger: none for the generic core; they
  remain with the cyber domain (R-55).

## ENVIRONMENT FACTS

- Node v26.4.0 and npm 11.17.0 are present; git 2.54.0.windows.1. (Verified 2026-09-21.)
- Ollama is NOT installed: no `ollama` binary on PATH or in the usual install locations, no
  `ollama` process, and `http://127.0.0.1:11434` (port 11434) was closed when probed on
  2026-09-21. Consequence: the Ollama provider is written against the documented HTTP contract
  and must fail closed when the runtime is absent; benchmark runs use the scripted provider.
- The offline type gate uses a locally available TypeScript compiler at
  `E:\aide-sovereign-workbench\node_modules\.bin\tsc.cmd` (`tsc` is not on PATH).
  `tsconfig.json` exists in this repository. `package.json` also declares `typecheck` and
  `verify` scripts; the tree contains `scripts/lint.mjs` only, so `scripts/typecheck.mjs` and
  `scripts/verify.mjs` are absent as of this writing.
- `node:sqlite` is available in this Node build (recorded; unused in v0.1).
- The harness needs no install step and no network: zero runtime dependencies, no
  `node_modules`, no package downloads; evidence and benchmark results are written under this
  repository.

## ASSUMPTIONS

Highest-consequence assumptions; the full register with verification methods is
`docs/matrices/ASSUMPTION_MATRIX.md`.

- **A-1** — the collaborator's reported ~400 routes can be mapped to a bounded semantic
  capability set (tens, not hundreds, per task). If false, tool selection and the exposure cap
  are the binding constraint. Status: OPEN.
- **A-2** — at least one mutating operation can be independently re-read after execution, so
  verification is not an echo of the adapter's own response. If false, verification degrades to
  trusting the adapter. Status: OPEN.
- **A-5** — the collaborator's mutating endpoints accept an idempotency key, or the integration
  tolerates deny-on-replay. If false, a retry after a network failure could double-post.
  Status: OPEN.
- **A-6** — the collaborator can run a local model runtime (Ollama or an equivalent local HTTP
  endpoint) on the machine that hosts the harness. If false, the sovereignty premise breaks.
  Status: OPEN.

## Licence and provenance

The reference repository's LICENSE was NOT read during reconnaissance. Therefore NO code was
copied from it, no code was vendored, and no code from another project exists in this
repository; only architectural ideas were reused, and every primitive in the REUSABLE table is
re-implemented in this repository's own files (R-51..R-55; decision D-003). The absence of
vendored code is consistent with `package.json` declaring zero dependencies and the tree having
no `node_modules`. This repository declares `UNLICENSED` in `package.json` and has no LICENSE
file in the tree as of this writing.
