# Live Model Validation

The verified local baseline for live inference, and where its evidence lives. This is the document the
provider, parser and contract-test comments cite.

## Verified baseline (OBSERVED on this machine)

| Item | Value |
|---|---|
| Engine | `E:\llama-cpp\llama-server.exe`, build `b9940-259f2e2a5` (llama.cpp 9940), CPU-only |
| Served artifacts (each stored outside every repository) | `LFM2.5-230M-Q8_0.gguf` — 246,598,496 B, sha256 `855be854…a935` · `LFM2.5-1.2B-Instruct-Q8_0.gguf` — 1,246,253,888 B, sha256 `f6b981dc…d26a` · `LFM2.5-2.6B-QAD-Q4_0.gguf` — 1,593,894,944 B, sha256 `a247afd6…0b03` |
| Launch geometry | `-m <artifact> --host 127.0.0.1 --port <p> --ctx-size <n> --threads <n> --parallel 1 --no-warmup`; loopback only; no shell; the provider owns its engine and kills only that process |
| Contract | OpenAI-compatible `/v1/chat/completions`, `stream: false`, `response_format: { type: json_schema, strict: true }`; sampling `temperature 0.1`, `top_k 50`, `repeat_penalty 1.05–1.1`, `max_tokens` per experiment; health via `/health`; served id via `/v1/models` |
| Known transport bound | Node fetch applies a **300 s `headersTimeout`** that a configured 600 s abort cannot override (`FAILURE_MATRIX.md` F-35): non-streaming generations over 300 s surface as "engine unreachable" although the engine is alive and serving later requests |

## Probe evidence (structured output vs native tool calls)

Probe A — structured output, corrected all-fields decode schema (230M artifact, engine `b9940`):
`JSON_PARSE_VALID 5/5` · `FORMAT_SCHEMA_VALID 2/5` · `RUNTIME_SCHEMA_VALID 5/5` ·
`SEMANTIC_ENVELOPE_VALID 5/5` (was 0/5 before the decode-schema repair). Probe B — native tool calls:
0/3, so the structured path was retained. Reports: `benchmarks/results/live/probe-*.json`; the
superseded defect-era attempt is preserved alongside the corrected one.

## Where the evidence lives

- `evidence/observations/*.jsonl` — one JSONL per live experiment; the header pins the manifest,
  model and configuration fingerprints and every observation is one fsynced record.
- `benchmarks/results/live/`, `benchmarks/results/scale/` — probe, pilot and live reports.
- `COLLABORATOR_AGENT_NOTES.md` — Live Resident Validation and the S16/S18/S19/S21/S22 result sections.
- `AUTONOMOUS_CONTINUATION.md` — resume state, apparatus findings, frozen envelopes.

## Claim boundary

Every number here was measured on one 6-core mobile CPU (i7-8750H) with CPU-only inference. Latency
and throughput are machine-specific and must not be generalised. Artifacts are pinned by SHA256 — a
mismatch means a different experiment, and a run records the fingerprint it actually loaded. The
evaluated workload is SCALE-FAITHFUL / BEHAVIOR-SYNTHETIC / NOT A REPLICA; no live result is evidence
about any real application.
