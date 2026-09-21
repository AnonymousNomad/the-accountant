# Decision Matrix

Each entry records the chosen option **and** the rejected alternatives with reasons
(directive §7). "Reversibility" states how expensive it is to change later.

---

## DM-01 — Expose semantic capabilities, not internal routes

- **Decision:** The model sees ~8–12 semantic capabilities (`customer.create`,
  `invoice.issue`). Trusted adapter bindings map them to real operations.
- **Alternatives:** (a) expose all ~400 collaborator routes as tools; (b) ingest their
  OpenAPI and generate tools dynamically; (c) give the model a generic `http.request` tool.
- **Rejected because:** (a) 400 tools destroys selection accuracy (R-22) and hands the model
  the collaborator's internal surface (R-30); (b) dynamic ingestion creates tools whose risk
  and permissions are unknown at review time — nothing to classify, nothing to verify;
  (c) that is precisely the "open-ended extension (fetch a URL)" OWASP LLM06 warns against.
- **Consequence:** Onboarding a route is a deliberate act with a risk class, a schema, a
  verifier, and a test (`sops/capability_onboarding.md`).
- **Reversibility:** High (the registry is additive; the adapter layer absorbs change).

## DM-02 — Use Ollama's `format` (structured output), not `tools`

- **Decision:** The harness requests the proposal envelope via `format: <schema>` on native
  `/api/chat`, with `stream:false`.
- **Alternatives:** (a) Ollama `tools`/`tool_calls`; (b) OpenAI-compatible `/v1/chat/completions`;
  (c) free-form text parsed by regex.
- **Rejected because:** (a) `tool_choice` is unsupported, multiple calls are possible, and no
  argument-validity guarantee is published (R-06, R-07); (b) the native API exposes `num_ctx`
  and `keep_alive` which the compatibility layer does not (R-14), and we want no OpenAI
  assumptions; (c) a regex parser is a fake-success machine.
- **Consequence:** One object per turn, enforced; the harness validates regardless (R-15).
- **Reversibility:** High (provider interface).

## DM-03 — Node.js ESM with zero runtime dependencies

- **Decision:** Plain `.mjs`, standard library only.
- **Alternatives:** (a) TypeScript with a build step; (b) a framework + validation library
  (zod/express); (c) C# mirroring the reference solution.
- **Rejected because:** (a) a build step and toolchain for a v0.1 that is ~2.5k lines adds no
  capability (a real type gate is still obtained with `tsc --checkJs` on JSDoc, dev-only);
  (b) adds supply chain and audit surface for `JSON.stringify` and a schema subset we can
  write, test, and read; (c) the deliverable must run on the operator's machine and be
  trivially runnable by the collaborator (Node is ubiquitous; .NET is not), and the reference
  repository's own Node layer shows the pattern works.
- **Consequence:** `npm install` is never required; the only external tool is the optional
  type gate.
- **Reversibility:** Medium (a TS migration is mechanical but touches every file).

## DM-04 — Authority is in-process, not a separate policy service

- **Decision:** Policy engine and permit store are library components in the same process,
  with an injectable clock and journal.
- **Alternatives:** (a) a separate policy daemon; (b) an external authorization service.
- **Rejected because:** it adds process, protocol, and failure surface for a single-operator
  local tool; v0.1 must be small enough for the collaborator to audit in one sitting. The
  interface (`evaluate`, `issue`, `consume`) is the seam where a remote implementation could
  later plug in.
- **Consequence:** All authority state is lost on restart — which is fail-closed.
- **Reversibility:** High (interfaces are narrow).

## DM-05 — Hash-bound, single-use, expiring permits (not confirmation alone)

- **Decision:** Confirmation records the user's intent; execution additionally requires a
  permit bound to the canonical proposal hash, risk, capability, run, and expiry.
- **Alternatives:** (a) confirmation alone (approved = execute); (b) a session-wide "trusted
  mode"; (c) an allowlist of capability names with no per-action artifact.
- **Rejected because:** (a) leaves the approval decoupled from the exact arguments that will
  execute (argument substitution, T-08); (b) collapses per-action mediation (R-29);
  (c) same defect as (a) plus no expiry.
- **Consequence:** Two independent things must line up to execute: the user's confirmation and
  the permit derived from the frozen proposal.
- **Reversibility:** Low (this is a load-bearing control).

## DM-06 — Deny on replay rather than idempotent replay

- **Decision:** A consumed permit is refused. A repeat instruction is a new action needing new
  authority.
- **Alternatives:** idempotent replay (return the first result for a repeated key, as Stripe
  does).
- **Rejected because:** R-34 and R-35 disagree, and for *authority* artifacts the RFC 6749
  semantics (deny + treat as an attack) are the safe reading; idempotency belongs at the
  application boundary, not the authority layer.
- **Consequence:** Adapter-level idempotency keys are an explicit integration requirement
  (`docs/INTEGRATION_CONTRACT.md`).
- **Reversibility:** Medium (can be layered later at the adapter without weakening permits).

## DM-07 — Strict single-object envelope, no tolerant extraction

- **Decision:** The model response must be exactly one JSON object (optionally in one fenced
  block). Anything else is REJECTED.
- **Alternatives:** extract the first JSON-looking substring; ask the model to repair.
- **Rejected because:** tolerant extraction turns malformed output into plausible action;
  repair loops were deferred (R-25) and would double model calls in v0.1.
- **Consequence:** Parse-success rate is an honest, measured metric (benchmark), and Ollama's
  `format` should make it high.
- **Reversibility:** High (the parser is one module with its own tests).

## DM-08 — Harness-side validation is mandatory and independent of the runtime

- **Decision:** Every proposal is validated against the capability schema in our own code even
  when `format` constrained decoding is in use.
- **Alternatives:** trust the schema constraint.
- **Rejected because:** R-15 documents silent skipping of unsupported schema features, and
  R-17/R-18 show vendor guarantees are syntax-only and can silently disable.
- **Consequence:** A second, auditable validation path exists; complexity budget enforced on
  schemas so both paths agree.
- **Reversibility:** Low (core control).

## DM-09 — Synthetic accounting domain for v0.1, no invented integration

- **Decision:** Ship 8 synthetic capabilities over an in-memory deterministic store, plus a
  disabled-by-default generic HTTP adapter.
- **Alternatives:** (a) guess the collaborator's REST surface; (b) wait for his spec.
- **Rejected because:** (a) fabricates proprietary interfaces and would produce tests that
  prove nothing about his system; (b) blocks all progress.
- **Consequence:** The integration contract lists exactly what is needed next
  (`docs/INTEGRATION_CONTRACT.md`).
- **Reversibility:** High (capabilities are additive).

## DM-10 — Deterministic domain selection, no vector search

- **Decision:** Exposure is computed by rule: declaration order filtered by domain, then
  keyword tags, capped at `maxCapabilities`.
- **Alternatives:** embeddings + similarity ranking.
- **Rejected because:** for ≤ 20 capabilities, embedding search adds a model dependency, a
  non-deterministic ranking, and an index to maintain, while the directive explicitly permits
  "simple deterministic domain selection" for v0.1 and forbids vector databases.
- **Consequence:** Exposure is reproducible and hashable in the benchmark.
- **Reversibility:** High (the selector is a pure function).

## DM-11 — Hash-chained JSONL journal

- **Decision:** Append-only JSONL with `seq`, `prevHash`, `hash`, redaction, and a verify command.
- **Alternatives:** (a) plain structured log; (b) SQLite; (c) signed records with a key store.
- **Rejected because:** (a) no tamper evidence (AU-9); (b) a database adds schema migration and
  locking concerns for a v0.1 whose event volume is tiny; (c) signing requires key custody, a
  whole subsystem deferred from v0.1 (recorded in the threat matrix as residual T-12).
- **Consequence:** Tamper-evidence without key management; a full-chain rewrite by a
  privileged attacker remains undetectable (stated, not hidden).
- **Reversibility:** Medium (the journal interface is narrow).

## DM-12 — Scripted provider for deterministic tests and demos, clearly labelled

- **Decision:** A fixture-replay provider exists for tests, CI, and the scripted demo. It is
  never presented as model capability, and it traverses the identical pipeline.
- **Alternatives:** (a) mock the harness in tests; (b) require Ollama for every test.
- **Rejected because:** (a) mocking the harness would leave the most important code untested
  and would let tests pass while the pipeline is broken; (b) makes the test suite depend on an
  absent, non-deterministic external process (Ollama is not installed here, and R-28/R-50
  establish that "deterministic" inference is not achievable anyway).
- **Consequence:** The harness is fully tested end-to-end without a model; model quality
  remains unmeasured and is reported as such (never fabricated).
- **Reversibility:** High (test-only double).

## DM-13 — Confirmation must be armed in the current turn, and expires

- **Decision:** A pending confirmation is resolvable only by the immediately following input
  and within `confirmationTtlSeconds`.
- **Alternatives:** keep pending confirmations until answered.
- **Rejected because:** unbounded pending approvals produce stale-confirmation approvals
  (T-05) — the classic bug where a "yes" hours later authorizes something the user no longer
  remembers.
- **Consequence:** Re-issuing an instruction invalidates any earlier pending approval.
- **Reversibility:** Low (security-relevant semantics).

## DM-14 — Independent verification against domain state, never the adapter's own report

- **Decision:** Each capability names a verifier that re-reads authoritative state and checks
  facts. Only then may the status be `EXECUTED_VERIFIED`.
- **Alternatives:** trust the adapter's success flag; verify the HTTP 200.
- **Rejected because:** a 200 or an `ok:true` is a claim, not a fact; F-22 exists precisely
  because adapters can be optimistic, partial, or lying.
- **Consequence:** `tests/verification.test.mjs` includes a deliberate lying adapter.
- **Reversibility:** Low (core control; per-capability effort is the cost).

## DM-15 — No automatic repair/retry loop in v0.1

- **Decision:** A failed proposal ends the turn. The user (or a later version) decides to retry.
- **Alternatives:** 2–3 bounded repair attempts with error-typed feedback (Anthropic's pattern).
- **Rejected because:** it doubles model calls, complicates the evidence trail (which attempt
  was approved?), and its safety depends on idempotency guarantees the collaborator has not
  confirmed. Trigger to revisit: a measured parse-failure rate (R-25).
- **Reversibility:** High (an explicit loop can be added around `handleUserMessage`).

## DM-16 — A type gate that fails loudly when unavailable

- **Decision:** `npm run typecheck` runs real `tsc --checkJs`; if no compiler is found it exits
  2 with instructions instead of passing silently.
- **Alternatives:** (a) skip when missing (silent fallback); (b) commit `@types/node` and a
  compiler; (c) no type gate at all.
- **Rejected because:** (a) violates the no-silent-fallback law; (b) vendors a toolchain into a
  zero-dependency repository and pins nothing meaningful; (c) JSDoc + `tsc` catches real
  defects (wrong arity, wrong property, null handling) at no supply-chain cost.
- **Consequence:** `npm run verify` is honest on a machine without a compiler: it fails, and
  says why, rather than claiming a pass.
- **Reversibility:** High.
