# Capability Awareness

This document explains the subsystem that decides **what the model is told it can do**. It exists
because a large share of "the model can't do that" failures are not intelligence failures at all.

## Three kinds of awareness (plus the one the harness owns)

| Kind | Question | Who supplies it |
|---|---|---|
| System awareness | "What am I allowed to do at all?" | Trusted configuration |
| Task awareness | "What is the user trying to accomplish right now?" | The resident SOP + the user's text |
| Capability awareness | "What operations are available right now that could accomplish it?" | The capability context pack |
| Authority | "Even knowing how, am I permitted to execute it?" | Policy + permit (never the model) |

Conflating these is the most common design mistake. In particular, **availability is not
authority**: the presence of `invoice.issue` in the context does not mean anything may be issued.
That is decided later, per action, by the policy engine.

## Four failure modes that look like model weakness

1. **Route exists, no tool.** The function was never described to the model, so it answered "I
   cannot do that." Nothing is wrong with the model.
2. **Hundreds of tools, no discrimination.** The model picks the wrong one, or none, because 394
   similarly-named operations were loaded at once (research R-22: aim for far fewer than 20).
3. **Correct tool, stale context.** The capability was removed, renamed, disabled, or was never in
   this turn's snapshot. A remembered tool is not an executable tool.
4. **Correct tool, thin description.** "Creates customer" does not tell a small model when *not* to
   create one, so it creates a duplicate instead of searching first.

All four are harness defects, not model defects. The failure taxonomy in `docs/BENCHMARK.md`
separates them (`CAPABILITY_MISSING`, `CAPABILITY_IRRELEVANT_EXPOSURE`,
`CAPABILITY_CONTEXT_STALE`, `CAPABILITY_DESCRIPTION_AMBIGUOUS`, `CAPABILITY_SELECTION_WRONG`, …)
so a failure is never automatically filed as "the model is bad".

## How the context is built (one turn)

`src/registry/context.mjs`, called from `src/harness.mjs` before every model call:

1. **Candidates** — the whole registry is read (the model never sees it).
2. **Filter**, recording a reason for every exclusion:
   - `CAPABILITY_DISABLED` — `enabled: false`;
   - `DOMAIN_NOT_SELECTED` — outside `exposure.domains`;
   - `PERMISSION_NOT_GRANTED` — the operator lacks a required permission;
   - `PREREQUISITE_UNAVAILABLE` — a registered state check fails (e.g. no draft invoice exists);
   - `EXCEEDS_EXPOSURE_CAP` — beyond `exposure.maxCapabilities` after ranking.
3. **Rank deterministically** by keyword overlap with `tags`, then id tokens, then description
   words. No embeddings, no randomness, no vector database. The same text always produces the same
   order, which is why the context has a hash.
4. **Render** one compact block per capability containing: id, domain, what it does, **when to use
   it**, **when not to use it**, required and optional arguments with their documented bounds,
   expected output, side effects, risk class, retry safety, whether confirmation is required,
   required permission, prerequisites, and related capabilities.
5. **Freeze the snapshot**: `snapshotId`, `actorId`, `workspaceId`, `createdAt`, the exposed ids
   **and versions**, the registry hash, the context hash, and a budget measurement
   (capability count, characters, approximate tokens, schema bytes).
6. **Bind**: policy validation, the permit, and the confirmation all reference *this* snapshot. If
   the registry changed, the context is stale and the action is denied
   (`CAPABILITY_CONTEXT_STALE`); a capability version that does not match the snapshot is denied
   (`CAPABILITY_VERSION_MISMATCH`).

`relatedCapabilities` are filtered to the exposed set, and capability prose must never name another
capability (a registration-time convention checked by a test), so a disabled capability cannot
leak into the context even as a cross-reference.

## What the model is never told

Adapter kind, operation names, HTTP methods and paths, bindings, hosts, credentials, database or
service internals, permission internals, policy internals, and the existence of capabilities it was
not given this turn.

## Adding a capability

Follow `sops/engineering/capability_onboarding.md`. The short version:

1. pick one business intent (not a route);
2. write the description, `whenToUse`, `whenNotToUse`, tags, output summary, side effects;
3. write the strict argument schema (`additionalProperties: false`, bounds, patterns);
4. classify risk by hand (`sops/engineering/capability_risk_classification.md`);
5. declare permissions, prerequisites, idempotency and sensitivity;
6. map the adapter binding in trusted configuration;
7. write the verifier (it must re-read state, not repeat the adapter's claim);
8. register it (registration fails loudly on anything missing) and add a fixture case.

## Diagnosing a failure: model or context?

Use the evidence. For any run id, `:evidence` and `benchmarks/results/**/report.json` show:

- `CAPABILITIES_EXPOSED`: what was offered, what was filtered and why, the context budget;
- `PROPOSED`: what the model actually chose, and with which arguments;
- `POLICY_DECISION` / `DENIED`: whether trusted policy agreed;
- `EXECUTION_*`, `VERIFIED` / `VERIFICATION_FAILED`, `COMMIT_UNKNOWN`: what happened afterwards.

| Symptom | Most likely class | First check |
|---|---|---|
| Model says it cannot do something | `CAPABILITY_MISSING` / `CAPABILITY_NOT_EXPOSED` | Was the capability in `exposed`? Was it filtered, and why? |
| Model picks the wrong operation | `CAPABILITY_SELECTION_WRONG` | How many capabilities were exposed? Are the `whenNotToUse` lines distinguishable? |
| Model uses a removed or disabled tool | `CAPABILITY_CONTEXT_STALE` | Is the version in the snapshot current? Is `enabled` still true? |
| Model asks for information it already had | `PROMPT_SOP` / `CONTEXT` | Was the data actually in the turn, or assumed from memory? |

## Measuring context effects

`node benchmarks/run-benchmark.mjs --arm overloaded --filler 40` runs the same fixture against a
deliberately overloaded surface (no domain filter, cap 32, plus 40 unimplemented filler
capabilities) and reports the measured context cost per arm. With the scripted provider this
measures **context construction only** — model accuracy differences cannot be concluded from a
scripted run, and the report states that explicitly. The same runner is the intended path for a
real-model comparison once a local runtime is available (`docs/BENCHMARK.md`).
