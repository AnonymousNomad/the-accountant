# Reproducing the Experiment

Everything here runs locally. The harness has **zero dependencies**; only the model runtime and the
model artifact are external, and both are pinned by identity.

## 1. Requirements

| Item | Value |
|---|---|
| Node.js | ≥ 20.11 (developed and verified on v26.4.0) |
| Engine | `llama-server` (llama.cpp build `b9940-259f2e2a5` was used for all recorded runs) or Ollama |
| Resident artifact | `LiquidAI/LFM2.5-2.6B-GGUF` → `LFM2.5-2.6B-QAD-Q4_0.gguf` |
| Artifact size | 1,593,894,944 bytes |
| Artifact SHA256 | `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` |
| Hardware used | 6-core mobile CPU (i7-8750H), CPU-only inference, 16 GB RAM |

**Verify the artifact before use.** The harness records the artifact's SHA256 in every experiment's
manifest fingerprint; a mismatch means the run is a different experiment.

```
sha256sum LFM2.5-2.6B-QAD-Q4_0.gguf      # must equal the hash above
```

## 2. Deterministic verification (no model, no network)

```bash
node scripts/lint.mjs                     # structural invariants + required sections
node scripts/verify-route-classification.mjs   # 52 mapped / 178 intended-unmapped / 164 internal = 394
node scripts/verify-simulation.mjs        # generated topology + semantic pack + task corpus
node --test                               # full deterministic suite
node benchmarks/run-benchmark.mjs --arm bounded   # fixture benchmark (0 unsafe executions required)
node scripts/verify.mjs                   # all of the above in sequence (needs SAH_TSC for the type gate)
```

The type gate resolves a local `tsc` (set `SAH_TSC` to its path). If no compiler is found the gate
**fails loudly** rather than passing silently.

## 3. Live experiment (canonical Resident)

Configuration: `config/harness.live-2.6b.json` — the file's own sha256 and the effective
configuration fingerprint are recorded in the evidence header.

Frozen envelope for the recorded runs:

| Parameter | Value |
|---|---|
| Tasks | first 20 tasks of `simulation/task-corpus.jsonl` in file order (no cherry-picking) |
| Repetitions | 3 (60 observations) |
| Context window | 12,288 tokens (pre-registered: prompt 5,965 worst case + 1,024 generation reserve = 6,989) |
| Threads | 6 |
| Sampling | temperature 0.1, top_k 50, repeat_penalty 1.1 |
| Output cap | 512 (S21) · 1024 (S22 apparatus-isolated) |
| Inference timeout | 300 s (S21) · 600 s configured for S22 — **not effective**: Node fetch's default 300 s `headersTimeout` aborts non-streaming requests first (`FAILURE_MATRIX.md` F-35), so the effective client ceiling is ≈300 s in both runs |
| Discovery | `discovery-v2-keyword-context`, benchmark-blind, 12-capability bounded surface |

```bash
# S21 (as originally run)
node benchmarks/run-resumable.mjs --experiment S21-2.6B-QAD-ACCOUNTING-RESIDENT \
  --tasks 20 --reps 3 --ctx 12288 --threads 6 --port 8103 --max-tokens 512

# S22 (identical except the output cap raised; the 600 s timeout flag proved ineffective — F-35)
node benchmarks/run-resumable.mjs --experiment S22-2.6B-QAD-ACCOUNTING-RESIDENT-APPARATUS-ISOLATED \
  --tasks 20 --reps 3 --ctx 12288 --threads 6 --port 8103 --max-tokens 1024 --inference-timeout 600000
```

The runner owns execution: it freezes and hashes a manifest, assigns deterministic observation ids,
appends one fsynced JSONL record per observation, refuses to run on manifest/model/configuration
drift, and **resumes exactly** — re-running the same command after an interruption skips completed
observations and never duplicates or reorders work.

**Recorded results (both runs completed 60/60).** S21: `EXECUTED_VERIFIED` 39/60, parseable proposals
43/60, selection 41/43 = 95.3 % among parseable, read-shaped 28/30, 12 truncations, zero safety
violations. S22 (output cap lifted; the timeout flag proved ineffective — F-35): `EXECUTED_VERIFIED`
41/60, parseable 50/60, selection 44/50 = 88.0 %, read-shaped 27/30, truncations 12 → 1, six
client-timeout apparatus errors, zero safety violations. The pre-registered quality gate **fails in
both runs** on selection and proposal validity; argument accuracy is 100 %, hallucinations are 0, and
the clarification gate is **unmeasurable** with this frozen manifest. Layered numbers and the S21→S22
apparatus-isolation comparison are recorded in `COLLABORATOR_AGENT_NOTES.md` (S21 and S22 canonical
results sections).

## 4. Evidence layout

| Path | Contents |
|---|---|
| `evidence/observations/<experiment>.jsonl` | One header line (manifest hash, model fingerprint, configuration truth) + one record per observation: execution input, discovery (version, ranked candidates, exposed set, budget), validation, policy/authorization, execution, verification, safety flags, proposed arguments, provider metrics, expected values (scoring path only) |
| `benchmarks/results/live/`, `benchmarks/results/scale/` | Per-run reports from the live and scale-surface runners |
| `benchmarks/results/<timestamp>-<arm>/report.json` | Fixture-benchmark reports |
| `*.retracted.jsonl`, `*-superseded.jsonl` | Preserved apparatus-failure and superseded attempts — kept, never deleted |

Scoring is layered so a single number can never hide the cause: discovery recall → selection among
parseable proposals → argument key completeness → argument value equality → workflow behaviours
(clarification, unsupported, confirmation) → task outcome → apparatus events (truncation, timeout).
Metric definitions, with explicit numerators and denominators, are normative in
[`EXPERIMENT_NOMENCLATURE.md`](EXPERIMENT_NOMENCLATURE.md).

## 5. What may and may not be claimed

**May be claimed:** behaviour of this harness on this synthetic workload, with this artifact, on this
hardware, under the frozen parameters; safety invariants; discovery recall; layered model behaviour.

**May not be claimed:** that the results predict a real application's behaviour; that the synthetic
topology is anyone's system; that latency measured on this laptop generalises to other hardware; model
quality beyond the tested task corpus (which contains no clarification- or unsupported-kind
expectations — those gates are **unmeasurable** from this manifest and are reported as such).

## 6. Adding a capability (the integration path)

1. Read `COLLABORATOR_AGENT_NOTES.md`, then [`INTEGRATION_CONTRACT.md`](INTEGRATION_CONTRACT.md).
2. Map one business intent — not a route — to a semantic capability, with `whenToUse`,
   `whenNotToUse`, a strict argument schema, a risk class, required permissions, side effects and a
   verifier.
3. Bind the adapter in trusted configuration; the model never sees hosts, paths or methods.
4. Write the verifier so it re-reads authoritative state rather than trusting the adapter's reply.
5. Add a fixture case and run the deterministic suite; then the fixture benchmark.
6. Expand only from evidence.

Recommended first real slice: **customer search/create** and **invoice draft**.
