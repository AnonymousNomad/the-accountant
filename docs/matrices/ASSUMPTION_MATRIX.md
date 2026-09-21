# Assumption Matrix

An assumption is a claim we act on without proof. Each one has an origin, a consequence if
false, and a way to verify it. **A-1..A-6 concern the collaborator's system and are the most
important rows in this repository**: they are the reason v0.1 deliberately contains no
accounting logic and no guessed routes.

Status legend: OPEN (unverified) · PARTIALLY VERIFIED · VERIFIED · REJECTED · SUPERSEDED.

| # | Assumption | Origin | Consequence if false | How to verify | Status |
|---|---|---|---|---|---|
| A-1 | The collaborator's system exposes operations that can be mapped to a bounded set of semantic capabilities (tens, not hundreds, per task) | Inference from "~400 HTTP routes" (REPORTED) plus the practical requirement of a small exposed set | If the real surface cannot be reduced, the harness must expose a much larger set (or add hierarchical discovery), and tool-selection accuracy becomes the binding constraint; v0.1's exposure cap would be too small | Ask the collaborator for an operation inventory; attempt to reduce it to ≤ 30 capabilities for one workflow | OPEN |
| A-2 | At least one mutating operation can be independently re-read (a GET that reflects the effect), enabling real verification rather than an echo of the adapter's own response | Inference from normal application design | Verification of that capability would degrade to trusting the adapter's report, which is exactly what v0.1 refuses; the integration would need a compensating read path or a state-diff check | Ask for the read-back endpoint for one mutation; test it | OPEN |
| A-3 | Deterministic verifiers written from the capability spec are adequate (they check the right things) | Design assumption | A wrong verifier could pass a bad execution; the control fails silently from the user's perspective | Reviewer check per capability; mutation tests (break the adapter, confirm the verifier fails) | PARTIALLY VERIFIED (one lying-adapter test proves the mechanism detects *an* incorrect effect) |
| A-4 | Confirmation prompts are acceptable to the collaborator's users for FINANCIAL operations | Design decision D-16, not corroborated by the collaborator | If unacceptable, FINANCIAL risk needs a different control (e.g. a second operator, an out-of-band approval) — the architecture supports it, the UX does not exist yet | Ask the collaborator; run a workflow with him | OPEN |
| A-5 | The collaborator's mutating endpoints can accept an idempotency key (or the integration tolerates a deny-on-replay policy) | Research R-35 disagreement | Retries after a network failure could double-post; the harness would need to detect duplicates itself (by re-reading state before execution) | Ask; test with a deliberately repeated request | OPEN |
| A-6 | The collaborator can run a local model runtime (Ollama or equivalent) on the machine that hosts the harness, or expose an equivalent local HTTP endpoint | Directive 1 ("Ollama-hosted model", "local-first") | A hosted provider would need an explicit opt-in and would break the sovereignty constraint; the provider interface accommodates it but the project's premise does not | Ask; run the provider conformance check against their runtime | OPEN |
| A-7 | The operator's machine has no adversarial local process (a compromised host defeats local-only controls) | Scope statement | Nothing in v0.1 prevents a local privileged attacker from rewriting the journal, editing config, or reading memory | Out of scope; stated in `docs/THREAT_MODEL.md` | OPEN (accepted as scope) |
| A-8 | Model output can be constrained to a single JSON object with high reliability via prompt + `format` | Research R-01, R-15 | Parse-success would drop; the repair loop (deferred) becomes necessary earlier | Measure parse success with a real model (benchmark arm requires Ollama, currently absent) | OPEN |
| A-9 | A capability set of ≤ 12 exposed per turn is sufficient for the collaborator's first workflow | Research R-22 (fewer than 20) + design choice | Exposure would need per-step narrowing (hierarchical discovery), which is deferred | Reduce one real workflow to ≤ 12 capabilities with the collaborator | OPEN |
| A-10 | Deterministic synthetic state is a faithful *structural* analogue of a real ledger (draft vs posted, one-way issue, reversal-style corrections) | Research R-39 (vendor documentation, MEDIUM confidence) | The demonstration would teach the wrong pattern for the collaborator's real ledger | Reviewed against the collaborator's actual documents when provided | PARTIALLY VERIFIED (structure follows R-39; no accounting claim is made) |
| A-11 | Node.js is available or acceptable on the collaborator's machine | Inference (Node is ubiquitous) | A .NET/Python port would be needed; the architecture and tests would still hold but the code would not | Ask before integration | OPEN |
| A-12 | A hash-chained JSONL file is sufficient audit durability for v0.1 (no key signing, no external anchor) | Design decision DM-11 | Undetectable full-chain rewrite by a privileged local actor | Recorded in the threat matrix as residual T-12; revisit if the collaborator requires signed evidence | OPEN (accepted residual) |
| A-13 | The process is single-operator and single-user in v0.1; permissions are a flat granted set | Directive 1 (v0.1 scope) | Multi-user permission mapping and per-user credentials are needed (OWASP LLM06 mitigation 5). v0.1 would need an identity dimension in policy inputs | Ask the collaborator about multi-user requirements before integration | OPEN |
| A-14 | Journal writes are cheap and synchronous enough not to distort the demo | Design assumption | If not, evidence writes move to a buffered writer with explicit flush-before-execute (the ordering guarantee must remain) | Measured in the benchmark latency percentiles | PARTIALLY VERIFIED (measured in the benchmark report) |

## Assumptions deliberately *not* made

| Not assumed | Why |
|---|---|
| Any collaborator route path, method, schema, or field name | No specification has been provided; inventing one would be fabrication (directive §SOURCE/IP BOUNDARY) |
| That AES-256-GCM is correctly used or that their key custody is sound | REPORTED only; UNKNOWN implementation |
| That four tax regions are implemented or conformant | REPORTED only; and v0.1 implements no tax logic at all |
| That "400 routes" is accurate | REPORTED only; a capability inventory is required |
| That the model will behave | Every model property is treated as untrusted (R-26, R-27) |
