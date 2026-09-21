# Minimality Review

Phase 11 review. Question asked of every component: **what can be removed, and what is here
without a current requirement?** The goal is a repository a competent stranger can read in an
afternoon.

## Measurements (before this review's removals were applied, 2026-09-21)

| Area | Files | Lines |
|---|---|---|
| `src/` (the harness) | 27 | 6023 |
| `tests/` | 14 | 2379 |
| `benchmarks/` | 1 | 613 |
| `scripts/` | 3 | 424 |
| `prompts/` | 2 | 88 |
| `docs/` | 16 | ~2000 |
| `skills/` | 27 | 2713 |
| `sops/` | 22 | 1666 |
| Runtime dependencies | **0** | — |
| Third-party packages installed by any command | **0** | — |

Comment and blank lines account for roughly 20% of `src/` (for example `harness.mjs`: 989 lines,
126 comment, 54 blank). Comments in this repository explain *why* (threat prevented, invariant
protected, alternative rejected), which is a requirement of the directive, not decoration.

## Removals applied during the build

| Removed | Why it existed | Why it went |
|---|---|---|
| Authority sweep timer | The reference implementation sweeps expired permits on an interval | Expiry is checked on use and the permit map is small and per-session. `sweep()` remains a callable method with no timer. |
| Configurable `evidence.redactKeys` | Flexibility | The redaction policy is not something an operator should widen. Fixed in code; a test pins it. |
| `outputSchema` in capability metadata | The directive's trusted record lists one | The verifier is the real output check, and a second schema would drift from the adapter's actual contract. `outputSummary` (model-facing) + verifier (machine-facing) cover both needs. Recorded as a deliberate deviation. |
| A separate `session.mjs` module | Session state | State is: turn counter, proposal-id set, and the two stores. It lives in `createHarness`; a module would be indirection without a second consumer. |
| `docs/runtime/` (an artefact directory) | A placeholder in an early checklist | Runtime knowledge lives in `sops/runtime/`; a doc directory with no documents is noise. Removed from the required-artefact list. |
| `RECONCILIATION_REQUIRED` event | Symmetry with `COMMIT_UNKNOWN` | The status plus the event's `nextStep` field carry it; one event fewer to reason about. |
| Adapter contract module (`adapters/adapter.mjs`) | An interface file | Two adapters with the same three fields do not need an interface module; the contract is documented in `docs/ARCHITECTURE.md` §2 and enforced by the policy engine's adapter checks. |
| Streaming NDJSON parser | Ollama streams by default | v0.1 sets `stream: false` and asserts a single object; the parser would be untested code for an unused path. Trigger recorded (R-10). |
| Repair loop for invalid proposals | Anthropic/OpenAI patterns | Doubles model calls, complicates the evidence trail, and depends on idempotency guarantees the collaborator has not confirmed. Trigger recorded (R-25). |
| Per-capability rate limiting | OWASP agentic guidance | Single-operator local tool with no network exposure; the trigger is any multi-user or network-exposed deployment (R-38). |
| Vector/semantic capability retrieval | "Hundreds of routes" framing | For ≤ 32 exposed capabilities, deterministic keyword ranking is sufficient and reproducible. Explicitly deferred in the addendum. |
| OpenTelemetry export | Instrumentation conventions | The benchmark already records percentiles and a context budget; an exporter needs a collector, which is a deployment concern. |
| Journal rotation/retention | AU-11 | Volume in v0.1 is trivial; retention is meaningless without a real deployment. |
| `structuredClone` polyfill / `deepFreeze` dependency | Freezing approved proposals | Both are Node built-ins / five lines of local code. |

## Deliberately kept although they are "extra"

| Kept | Justification |
|---|---|
| `nonPlaceholder` schema keyword | BFCL documents placeholder arguments (`"url": "Missing"`) as a real model failure (R-20). One keyword, one test, catches a real class. |
| `idempotency` metadata (unused at runtime) | The directive requires the trusted record to state retry safety, and `COMMIT_UNKNOWN` reasoning depends on it. Recorded, validated, never acted on — by design (IC-13). |
| Both benchmark arms | The capability-context experiment is a directive requirement; the arms are the measurement mechanism. |
| The resident base contract **and** the SOP (two prompt files) | They answer different questions (always-on laws vs. task procedure) and are hashed separately so a change to either is visible in the report. Together they are 88 lines. |
| `docs/matrices/` (five files) | Required by the directive, and the decision matrix is the artefact that stops a future contributor from re-litigating settled choices. |
| The `verifier` requirement on every capability | Without it, "verified" would be optional, and the whole result model collapses. |
| Two evidence directories in tests (`ecosystem` of temp dirs) | Tests must not share journal state; the alternative (mocking the journal) would leave the chain untested. |

## Premature abstractions that are **not** present

- No plugin system, no extension points, no dependency-injection container.
- No event bus: the journal is the record, and callbacks are local.
- No generic "policy rule engine" DSL: six ordered checks with typed reasons are easier to audit
  than a DSL, and a DSL would be a second language for the collaborator to learn.
- No retry/backoff framework, no scheduling, no queue.
- No multi-model orchestration, no agents, no memory.

## Complexity budget enforced on the model's inputs

Schema depth ≤ 6, ≤ 24 properties per object, ≤ 32 enum values, ≤ 12 capabilities per turn,
`reasoningSummary` ≤ 500 characters, clarification/reason ≤ 300 characters. These limits exist to
keep a small local model inside a proven envelope (R-16, R-19, R-22) and are enforced at
registration and parse time.

## Verdict

- **Dependencies:** zero runtime, zero dev. Nothing to audit beyond `types/node-min.d.ts`.
- **Largest module:** `src/harness.mjs` (989 lines) — cohesive but the next candidate for
  extraction; trigger recorded (IC-11).
- **No requirement-free component was found** other than the deferral table's items, which are
  documented rather than present.
- **State of the repository:** 120 files, ~15k lines including all documentation, skills and SOPs.

The repository is larger than the code alone suggests because the directive asks for the
engineering record as a co-equal deliverable. A reader who only wants the implementation can read
`src/` (6023 lines) — and the harness proper, excluding the synthetic domain and CLI, is roughly
3500 of those lines.
