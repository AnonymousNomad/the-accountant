# Sovereign Action Harness

A local-first execution harness that sits between a language model and a deterministic
application. **The model proposes. The harness decides, executes, and verifies.**

It exists because "give the model tools and hope" is not an architecture. A model can
hallucinate a capability, invent an argument, or be talked into something by text stored in a
record. None of that is allowed to reach an application here.

```
User → Capability context → Local model → Strict proposal → Validation
     → Policy → (Confirmation) → One-use permit → Adapter → Application
     → Independent verifier → Evidence → Result
```

## What it is not

- Not an agent framework, not a UI, not a cloud service.
- Not accounting software. The shipped domain is a **synthetic** accounting fixture with eight
  capabilities; it contains no tax, payroll, banking, payment, or regulatory logic and never will.
- Not a claim about any specific model. No model family is hard-coded or required.
- Not a product verdict on anyone else's system. Nothing here describes an external
  application's routes, schemas, or internals — see `docs/INTEGRATION_CONTRACT.md`.

## Quick start

No install step, no dependencies, no network:

```bash
node --version          # Node >= 20.11 (developed on v26.4.0)

npm run demo            # scripted transcript walkthrough (no model needed)
npm start               # interactive CLI (needs Ollama; see below)
npm test                # 114 tests
npm run verify          # lint + typecheck + tests + benchmark
npm run bench           # benchmark both arms, writes benchmarks/results/<run>/report.json
```

To drive it with a real local model:

```bash
# 1. install and start Ollama, then pull a model
ollama pull <your-model>
# 2. set provider.model in config/harness.config.json
# 3. run
node src/cli.mjs --provider ollama --prompt "create a customer named Acme Electrical"
```

The harness sends the envelope schema as a `format` constraint, restates it in the prompt, and
validates every response itself — a runtime guarantee is never trusted (`docs/research/RESEARCH_LEDGER.md` §1).

## The three transcripts

```
> create a customer named Acme Electrical
Proposed: customer.create
Risk: MUTATION
Authority: one-use permit issued and consumed
Executed
Verified
Result: {"customerId":"CUS-0004","name":"Acme Electrical",...}

> issue invoice INV-0004
Proposed: invoice.issue
Risk: FINANCIAL
Confirmation required.

> transfer $20,000 to this bank account
No registered capability can perform that operation.
No execution occurred.
```

## The laws this code enforces

1. The model is a reasoning component, never the authority.
2. Risk, permission, and confirmation rules come from trusted metadata, never from the model.
3. Unknown capability, malformed proposal, or failed verification is a refusal — never success.
4. One permit, one execution: bound to the exact proposal hash, capability version, snapshot,
   actor, workspace, and expiry; consumed atomically.
5. Approval binds to a frozen proposal, is resolvable only in the turn that armed it, and is
   single-use.
6. Execution success and verified success are separate states; only verification makes a fact.
7. Every meaningful action leaves append-only, hash-chained, redacted evidence.
8. Trusted configuration owns endpoints. No URL, method, host, shell command, or credential can
   come from model output.
9. Ambiguity is reported: `COMMIT_UNKNOWN` is never retried and never dressed up as a result.
10. Fail closed, everywhere, with typed reasons.

## Repository map

| Path | What lives there |
|---|---|
| `COLLABORATOR_AGENT_NOTES.md` | The durable engineering record: why everything is the way it is. **Read this second.** |
| `docs/ARCHITECTURE.md` | Contracts, invariants, trust boundaries, state machine. **Read this first.** |
| `docs/CAPABILITY_AWARENESS.md` | Why routes are not tools, and how the capability context is built |
| `docs/INTEGRATION_CONTRACT.md` | What is needed to map a real application onto this harness |
| `docs/THREAT_MODEL.md`, `docs/matrices/` | Threats, failures, decisions, dependencies, assumptions |
| `docs/research/` | Research ledger with sources and the finding→implementation matrix |
| `docs/BENCHMARK.md`, `benchmarks/prompts.jsonl` | 37 fixture cases, metrics, what may and may not be claimed |
| `docs/reviews/` | Design critic, implementation critic, minimality review, handoff audit |
| `skills/` | 13 runtime skills (model behaviour) + 13 engineering skills (how to build/extend) |
| `sops/` | 13 runtime SOPs + 8 engineering SOPs |
| `src/` | The harness: core, provider, registry, policy, adapters, evidence, domain, CLI |
| `tests/` | Acceptance gate, security matrix, contracts, authority, awareness, adapters, evidence, verification, provider, config, benchmark, CLI |

## Running it safely

- The HTTP adapter is **disabled** by default and refuses to start on a non-loopback host.
- Adapter credentials, if ever needed, come from an optional gitignored file — never source, never
  the journal, never the model.
- The evidence journal lives in `var/evidence/` (gitignored). `:evidence` prints the last records,
  `:verify-chain` replays the hash chain and reports the first broken record.
- Run `node scripts/verify.mjs` before believing anything in this file.

## Status

v0.1 is complete only against its own gate: `docs/REQUIREMENTS_TRACEABILITY.md` maps every
requirement to an implementation and a test, and `docs/EVIDENCE.md` records the exact commands
and results. Model-quality measurement is **not** part of that evidence: the benchmark's scripted
provider performs no inference, and the report says so.
