# Incoming Codebase Recon

The procedure to follow when the collaborator's real build/source arrives. **Doctrine:**
INSPECT BEFORE MODIFYING · REPRODUCE BEFORE REPAIRING · NEVER rewrite working application code merely
to match the harness · ADAPT AT THE CORRECT BOUNDARY.

Do not skip steps to reach a mapping sooner. Steps 1–19 assemble the facts a mapping needs; step 20 is
the first step allowed to propose code.

## Sequence

| # | Step | Evidence to record |
|---|---|---|
| 1 | Preserve original state | archive hash, git HEAD (if any), file inventory, timestamps; do not build in the original tree if you can copy it |
| 2 | Determine exactly what was supplied | source repo / archive / compiled build / database dump / schemas / docs; note what is **absent** |
| 3 | Establish build and run procedure | exact commands, runtime versions, dependencies; **reproduce without changing behaviour** |
| 4 | Establish tests and existing verification | what the application already proves about itself; how to run it |
| 5 | Map high-level architecture | processes, services, data stores, boundaries; one diagram is enough |
| 6 | Locate every AI/Ollama entry point | every call site, prompt, model config, feature flag; list them, do not judge them yet |
| 7 | Trace the toolbar AI path | request → model → response → UI effect |
| 8 | Trace the overlay AI path | same, independently |
| 9 | Determine whether both share canonical backend logic | if they diverge, that divergence is a finding (see `AUDIT_REPORT_TEMPLATE.md`) |
| 10 | Inventory real service/function/route boundaries | the operations that could become capabilities; count them, classify by intent |
| 11 | Trace one READ operation end-to-end | from UI gesture to rendered data; note every layer touched |
| 12 | Trace one WRITE operation end-to-end | same, including commit |
| 13 | Inspect identity/auth/permission propagation | who the actor is at each layer; where permissions are enforced |
| 14 | Inspect transaction/commit boundaries | what commits, when, and what is visible to whom before/after |
| 15 | Inspect retry/idempotency behaviour | what happens on a duplicate request; whether keys exist |
| 16 | Inspect cache/state synchronization | what is cached, for how long, and how staleness is bounded |
| 17 | Locate authoritative read-back paths | the exact endpoint/service that can prove an effect happened |
| 18 | Inspect error propagation and ambiguous failure handling | how a lost response is represented today; whether a write can be "unknown" |
| 19 | Compare actual behaviour against harness assumptions | every mismatch becomes an INTEGRATION_DEPENDENCY finding with evidence |
| 20 | **Only now** propose adapter mappings | use `CAPABILITY_MAPPING_WORKSHEET.md`; one domain, two or three capabilities |

## Rules that make this safe

- The application is the book of record. The harness observes and commands; it never becomes the source
  of accounting truth.
- If a harness assumption (read-back availability, idempotency, permissions) is false, **record it** —
  do not bend the application to fit, and do not weaken the harness to fit. Adapt at the boundary and
  state which capability is affected.
- If steps 6–9 reveal two divergent AI paths, treat that as an architectural finding before any mapping.
- If a write path has no read-back and no idempotency, that capability cannot be verified: mark it
  `UNVERIFIABLE` in the worksheet and recommend a compensating read path rather than shipping a
  plausible verifier.
- Nothing in this repository may acquire collaborator identifiers, route names or product naming.
  Real mappings live in the collaborator-side adapter package.

## Exit condition

You may propose the first adapter mapping only when, for the chosen operation, you can name: the real
service to call, its request/response shape, its permission requirement, its transaction boundary, its
idempotency behaviour, and the authoritative read-back that proves success. That set is the minimum the
harness cannot invent.
