# Synthetic Model-Arm Evidence (classification: synthetic governed-accounting workload)

**This is synthetic evidence.** The workload is a synthetic governed-accounting benchmark built for
the harness; it contains no production data and no commercial application's material, and its
results say nothing about any real deployment's performance. Two local models were compared under
an identical frozen harness; the important results are about the *harness and protocol*, not the
vendors.

## Setup

- Same frozen 42-case synthetic battery, same bounded capability surface (12 per turn), same
  policy/authority/verification/evidence stack, same scoring rules, files, and safety gates.
- Runtime: local Ollama 0.35.0, loopback-only, CPU-only, `num_ctx=8192`, `temperature=0`,
  `num_predict=400` for both models.
- Models: a 3B-class general instruct model (Q4_K_M) and a 2.6B-class in-house candidate
  (QAD Q4_0, imported from GGUF).
- Each arm began from a fresh copy of the frozen fixture; no expectation was changed after any run.

## Protocol finding (the most transferable result)

The candidate model **ignores the JSON-envelope instruction and emits native tool-call syntax**
instead. Under the envelope protocol it scored 1/29 model-driven cases (parses refused). Adding a
native-tools protocol mode — tools payload in, runtime-parsed `tool_calls` mapped to the same
envelope, all other rules identical — and re-running **both** models changed both scores and made
the comparison meaningful:

| Arm (42 cases) | Envelope protocol | Native-tools protocol |
|---|---|---|
| 3B-class instruct model | 21/42 (8/29 model-driven) | **32/42 (19/29)** |
| 2.6B-class candidate | 14/42 (1/29 model-driven) | **28/42 (15/29)** |

- **Protocol choice materially changed both models' performance.**
- The 3B-class model **remained stronger** on the tested model-driven workload (19/29 vs 15/29;
  9 vs 7 independently verified writes).
- The candidate **remained safe behind the same governed harness** — all seven safety-zero
  invariants stayed zero in every arm — but did **not justify a default migration.**
- **Shared harness safety behaviour was independent of the model**: authority, replay protection,
  workspace isolation, permission enforcement, hidden-capability refusal, `COMMIT_UNKNOWN`
  handling, and no-blind-retry all passed 13/13 in every arm, including the heavily failing ones.
- Performance: the candidate's artifact is smaller (1.59 GB vs 1.93 GB) and its generation rate is
  comparable (~6.6 vs ~6.8 tok/s), but it spent ~8.5× more generation tokens (reasoning channel)
  and ~9× total wall time for the battery. The 3B-class model's cold load was 34–42 s.

## Limitations

Synthetic workload only; one laptop, CPU-only; one run per arm; the native-tools protocol is a
documented format adaptation (identical rules, cases, and scoring); no claim is made about any
real application, and the candidate's strengths on parts of the battery justify a later,
separately pre-registered experiment — not a migration.
