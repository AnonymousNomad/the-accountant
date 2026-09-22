# Scale Simulation (Phase 16 — pilot)

**Status: pilot complete; uncommitted pending review.** This document defines the simulation
workload used by the scale-simulation benchmark. Results are in `docs/SCALE_SIMULATION_RESULTS.md`;
the machine-readable records are in `benchmarks/results/scale/`.

## Research question

Does a small local model fail because of **model capacity**, or because the **capability surface**
it is shown is large and poorly structured?

The harness thesis is that bounded reasoning is enough when the harness carries the complexity: the
model chooses among a handful of well-described capabilities, supplies schema-checked arguments,
and asks for missing information. The simulation varies three surface properties so the causes can
be separated:

- **Volume** — how many tools are exposed.
- **Documentation** — how much is said about each tool.
- **Abstraction and bounding** — whether the surface is a semantic layer, and whether it is
  filtered to the task at hand.

The simulation exists to make that question measurable at 394-route scale on this machine, without
touching any external system.

## What is simulated — and what is explicitly not

The declaration is embedded in the generated files:

> SCALE-FAITHFUL / BEHAVIOR-SYNTHETIC / NOT A REPLICA of any external system. No real accounting,
> tax or payroll rules exist here.

- **Simulated:** topology scale and shape (routes, entities, screens, jurisdictions), a semantic
  capability layer, a task corpus, and synthetic records. The four jurisdictions (NZ, AU, US, UK)
  are codes only: **no rules exist for any of them anywhere in the simulation**.
- **Not replicated:** no external system, product, or collaborator application was replicated; no
  collaborator system, data, or IP is present; no real accounting, tax, payroll, or legal rules
  exist; no network calls or downloads were made for the simulation. Records are synthetic values,
  not real entities.

## Scale (exact counts)

| Artifact | Count | Note |
|---|---|---|
| Synthetic routes | 394 | across 18 domain families |
| Entities / tables | 88 | |
| Screens | 176 | |
| Jurisdictions | 4 | NZ, AU, US, UK — codes only, no rules |
| Semantic capabilities | 56 | the registry view the model can see |
| Tasks | 100 | in 9 exact categories |
| Synthetic records | 60 | |
| Routes with `semanticCapability: null` | 342 of 394 | functions that exist but are not mapped for AI use; required minimum was 40 |

Task categories (exact): Customers/Suppliers, Quotes/Invoices, Ledger/Payments,
Payroll/Timesheets, Inventory/POS, Reports, Cross-domain workflows, Ambiguous/clarification,
Unsupported/adversarial.

Generators: `simulation/generate-topology.mjs` (topology) and
`simulation/generate-semantics.mjs` (semantic layer, tasks, records). Both are deterministic; the
semantics generator reads no clock and no randomness, so re-running produces byte-identical files.
Verifier: `scripts/verify-simulation.mjs` — 32 checks, current result 27 PASS / 0 FAIL / 5 INFO.

## The four arms

| Arm | Surface | Tools measured | What it isolates |
|---|---|---|---|
| A — raw | 394 routes, minimal descriptions | 394 | the baseline overload surface |
| B — documented | 394 routes, full descriptions / schemas / when-to-use | 394 | **A→B: documentation** |
| C — semantic | 56 capabilities, unfiltered | 56 | **B→C: abstraction** |
| D — bounded | task-relevant filter + cap 12 + full SOP/context | 7 | **C→D: bounded context + SOP** |

A→D isolates the total of the three changes. A and B cannot be executed on this machine: their
surfaces do not fit a sane local context window (see results).

## How the arms are wired to the harness

All four arms run the **same harness with the same safety boundary**: policy decisions, permits,
adapters, independent verification, and evidence. Only the **tool surface and the guidance** differ
(`benchmarks/run-scale-simulation.mjs`, header). That is what makes a per-arm difference
attributable to the surface rather than to a weakened control. No arm may widen authority or skip a
control to make a run succeed.

## Partial function mapping

Only 56 of 394 routes are mapped to a semantic capability; the other 342 exist as functions but are
not reachable by the model (`semanticCapability: null`). This models a partially integrated system
on purpose.

Required Resident behaviour when a request needs an unmapped function: **report that the capability
is unavailable** (the `unsupported` path) — never invent a capability, never silently substitute a
nearby one, and never claim an action happened. The task corpus only asks for capabilities that are
mapped; the unmapped routes test that the surface's edges are stated rather than guessed.

## Regenerate and verify

```
node simulation/generate-topology.mjs      # routes, entities, screens, jurisdiction config
node simulation/generate-semantics.mjs     # semantic layer, task corpus, records
node scripts/verify-simulation.mjs         # 32 checks; exits non-zero on any FAIL

node benchmarks/run-scale-simulation.mjs --measure          # surface sizes, no inference
node benchmarks/run-scale-simulation.mjs --surface bounded --tasks 8 --reps 1 --threads 6
```

Live-arm configuration is `config/harness.live-230m.json`. `--measure` writes
`benchmarks/results/scale/surface-measurements.json`; a live arm writes
`benchmarks/results/scale/<surface>-<timestamp>.json`.

## Honesty rules

1. This workload is **scale-faithful and behaviour-synthetic**. It is **not** a replica and must
   never be described as representative of any external system, product, or the collaborator's
   application.
2. No number from this simulation is a statement about the collaborator's system or its scale. The
   counts are properties of these generated files only.
3. The simulation contains **no rules** — not for tax, payroll, or any jurisdiction. Nothing here
   may be quoted as domain behaviour.
4. Costs, latencies, and pass rates are properties of this machine, this model, and this harness
   version. Local inference is not bit-reproducible; single-run rates carry wide uncertainty.
5. The generated corpus and records are **never training data**.
