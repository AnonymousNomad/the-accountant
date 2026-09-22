# Sovereign Action Harness

**WHAT THIS IS** — a standalone, local-first, governed action harness for connecting a local
Resident model to deterministic business software. A language model proposes; the harness validates,
authorises, executes, verifies and records. No cloud, no telemetry, no third-party runtime
dependencies.

**WHAT THIS IS NOT** — it is not a copy of anyone's accounting application. No collaborator product
name, route, schema, database or security design appears anywhere in this repository. Integration with
a real system happens only through the explicit adapter contract in
[`docs/INTEGRATION_CONTRACT.md`](docs/INTEGRATION_CONTRACT.md).

**SIMULATION STATUS** — the business workload used for evaluation is
**SCALE-FAITHFUL · BEHAVIOR-SYNTHETIC · NOT A REPLICA**: 394 synthetic routes, 88 entities,
176 screens, 4 jurisdictions and 56 semantic capabilities, sized from reported scale characteristics
and containing no real accounting, tax or payroll rules.

**The one rule the whole design serves:**
> The model may reason about the books. It may never manufacture the books.

## What it guarantees (and what it refuses to do)

The model is a reasoning component, never the authority. Risk, permission, confirmation and
execution belong to trusted configuration and code:

1. Unknown capability, malformed proposal, or failed verification is a refusal — never success.
2. One permit, one execution: bound to the proposal hash, capability version, snapshot, actor,
   workspace and expiry; consumed atomically.
3. Approval binds to a **frozen** proposal, is resolvable only in the turn that armed it, and is
   single-use — a later "yes" authorises nothing.
4. Execution success and verified success are separate states; only independent verification against
   authoritative state makes a fact.
5. `COMMIT_UNKNOWN` exists for ambiguous consequential mutations: never retried, never reported as
   success or definite failure.
6. Every meaningful action leaves append-only, hash-chained, redacted evidence.
7. No URL, method, host, shell command or credential can come from model output. The HTTP adapter is
   disabled by default and refuses non-loopback hosts.
8. Capability awareness is a first-class subsystem: bounded, benchmark-blind discovery, version-bound
   snapshots, revocation, and a measured context budget.

## Quick start (no install step, no dependencies)

```bash
node --version            # Node >= 20.11 (developed on v26.4.0)

npm run demo              # scripted end-to-end transcript (no model needed)
npm test                  # deterministic suite
npm run verify            # lint + route-classification + typecheck + tests + fixture benchmark
                          # the type gate needs a local tsc: set SAH_TSC, or it exits 2 loudly
npm run bench             # fixture benchmark, writes benchmarks/results/<run>/report.json
```

To drive it with a local model, start a llama.cpp-compatible server (or Ollama) and set the provider
in `config/harness.config.json` (base URL, model, sampling). Nothing is downloaded or installed by the
harness itself.

## What has been measured

The canonical evaluation is the **S21/S22 synthetic accounting experiment** on
`LFM2.5-2.6B-QAD-Q4_0` (verified artifact, sha256 `a247afd6…0b03`), with benchmark-blind keyword
discovery, the Accountant's Way doctrine, Retrieve Before Clarify, and the full authority and
verification stack.

| Layer | S21 (60 observations) | S22 — apparatus-isolated (60 observations) |
|---|---|---|
| Discovery (benchmark-blind) | expected capability exposed **60/60 = 100 %**; 12 tools/turn | same |
| Parseable proposals | 43/60 = 71.7 % | **50/60 = 83.3 %** |
| Selection among parseable proposals | **41/43 = 95.3 %** | 44/50 = 88.0 % |
| Arguments (required keys · exact values) | **41/41 · 41/41 = 100 %** | **45/45 · 45/45 = 100 %** |
| Read/lookup selected and verified | **28/30 = 93.3 %** | 27/30 = 90.0 % |
| Hallucinated capabilities | **0** | **0** |
| Aggregate `EXECUTED_VERIFIED` | 39/60 = 65 % | 41/60 = 68.3 % |
| Truncations at the output cap | 12 (512-token cap) | **1** (1,024-token cap) |
| Safety (all hard invariants) | **0 violations** | **0 violations** |

**Pre-registered quality gate: FAIL in both runs** — selection (S22 88.0 %) and proposal validity
(S22 83.3 % raw) remain below the ≥95 % targets; argument accuracy (100 %), zero hallucinations and
all safety zeros pass; the clarification gate is **UNMEASURABLE** with this frozen manifest (it
contains no clarification-kind expectations). S22's output-cap isolation converted 7 of 12 truncations
into valid proposals; its timeout change proved **ineffective** (Node fetch's default 300 s headers
timeout aborts first — `docs/matrices/FAILURE_MATRIX.md` F-35), so the ≈300 s ceiling bounds both
runs. The canonical Resident is therefore **not qualified** under the pre-registered gate on this
synthetic workload; the residual failure classes (argument schemas, client timeouts, read-task
clarification, one truncation) are attributed in [`COLLABORATOR_AGENT_NOTES.md`](COLLABORATOR_AGENT_NOTES.md).
**Read the notes before quoting any number.**

## Where to start reading

| Document | Why |
|---|---|
| [`COLLABORATOR_AGENT_NOTES.md`](COLLABORATOR_AGENT_NOTES.md) | The durable engineering record — **read first**, it contains the measured results, the failures, the decisions and the handoff procedure |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Contracts, invariants, trust boundaries, the closed status set |
| [`docs/REPRODUCING_THE_EXPERIMENT.md`](docs/REPRODUCING_THE_EXPERIMENT.md) | Exact commands, frozen parameters, evidence locations, claim boundaries |
| [`docs/LIVE_MODEL_VALIDATION.md`](docs/LIVE_MODEL_VALIDATION.md) | The verified local engine/artifact baseline and the probe evidence behind the live runs |
| [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) | What is synthetic, what is proven, what is unknown until the real system is inspected |
| [`docs/INCOMING_CODEBASE_RECON.md`](docs/INCOMING_CODEBASE_RECON.md) | The 20-step procedure for when the real application arrives |
| [`docs/INTEGRATION_AUDIT_CHECKLIST.md`](docs/INTEGRATION_AUDIT_CHECKLIST.md) | End-to-end audit of the full path, upstream and downstream of the harness |
| [`docs/CAPABILITY_MAPPING_WORKSHEET.md`](docs/CAPABILITY_MAPPING_WORKSHEET.md) | The template for mapping one real operation into a semantic capability |
| [`docs/ADAPTER_EXAMPLE.md`](docs/ADAPTER_EXAMPLE.md) | The shape of an adapter binding (**example only**) |
| [`docs/ACCEPTANCE_SPEC.md`](docs/ACCEPTANCE_SPEC.md) | The black-box acceptance test for the first real integration (15 scenarios) |
| [`docs/FAILURE_INJECTION_SPEC.md`](docs/FAILURE_INJECTION_SPEC.md) | The failure injections that prove `COMMIT_UNKNOWN` and the fail-closed paths |
| [`docs/AUDIT_REPORT_TEMPLATE.md`](docs/AUDIT_REPORT_TEMPLATE.md) | How findings are classified and evidenced |
| [`docs/INTEGRATION_CONTRACT.md`](docs/INTEGRATION_CONTRACT.md) | What a real application must provide, operation by operation |
| [`docs/THE_ACCOUNTANTS_WAY.md`](docs/THE_ACCOUNTANTS_WAY.md) | The operating doctrine for accounting work |
| [`docs/BENCHMARK.md`](docs/BENCHMARK.md) | Benchmark methodology and what may and may not be claimed |
| [`docs/matrices/`](docs/matrices/) | Threat, failure, decision, dependency and assumption registers |
| [`sops/`](sops/) · [`skills/`](skills/) | Runtime and engineering procedures |

**Receiving a real application?** Follow the navigation:
`README` → `COLLABORATOR_AGENT_NOTES` → `ARCHITECTURE` → `REPRODUCING_THE_EXPERIMENT` →
`INCOMING_CODEBASE_RECON` → `INTEGRATION_AUDIT_CHECKLIST` → `CAPABILITY_MAPPING_WORKSHEET` →
`ADAPTER_EXAMPLE` → `ACCEPTANCE_SPEC` (+ `FAILURE_INJECTION_SPEC`) → first real integration. One
command verifies the deterministic gate: `node scripts/verify.mjs`.

## Repository layout

```
src/         harness: core, models, registry, policy, adapters, evidence, domain, CLI, bootstrap
tests/       deterministic suite (acceptance, security, contracts, authority, awareness, adapters,
             evidence, verification, provider, config, benchmark, CLI, doctrine, accountants-way,
             actionability, anti-leak, manifest, llama-provider, schema-drift)
simulation/  synthetic topology generators + generated data (scale-faithful, not a replica)
benchmarks/  fixture + live runners, frozen manifests, prompt corpus
prompts/     resident base contract, resident SOP, Accountant's Way (compact runtime form)
docs/        architecture, contracts, threat model, benchmarks, reviews, matrices, research ledger
sops/        engineering and runtime standard operating procedures
skills/      portable engineering and runtime skills
config/      trusted configuration (HTTP adapter disabled by default)
```

## Status

- **Model-agnostic:** the harness speaks to any local OpenAI-compatible runtime (llama.cpp
  `llama-server` or Ollama) through a provider interface; `LFM2.5-2.6B-QAD-Q4_0` is the **documented
  local validation model** used for the recorded experiments — it is **not a requirement** for any
  deployment. The constraints to size for a given model are its capability-surface budget and prompt
  latency, not its identity.
- **Deterministic gate:** green — lint, route-classification, typecheck, full test suite, fixture
  benchmark (0 unsafe executions).
- **Known distribution constraint:** CPU-only inference on the development laptop measures
  p50 ≈ 144 s per model call at ~5.6 k prompt tokens; the prompt budget and latency envelope, not the
  model's reasoning, are the first things to size for a customer deployment.
- **Delivery boundary — ready for inspection and integration.** This repository has **not** integrated
  the collaborator's real accounting application: that application provides the real routes, services,
  authentication, transaction semantics and read-back paths, mapped in through
  [`docs/INTEGRATION_CONTRACT.md`](docs/INTEGRATION_CONTRACT.md) and the recon/audit procedure. The
  recommended first slice is deliberately narrow: **`customer.search` · `customer.create` ·
  `invoice.create_draft`** — not payroll execution, tax filing, funds transfer or high-impact ledger
  posting. No claim is made about the collaborator's application.
