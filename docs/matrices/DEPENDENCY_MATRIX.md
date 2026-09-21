# Dependency Matrix

Policy: a dependency is guilty until proven necessary. Standard library first. Any addition
must complete the checklist below and be recorded here **before** it is used.

## Runtime and development dependencies

| Component | Dependency | Why required | Version | Trust boundary | Failure effect | Replacement possibility | Status |
|---|---|---|---|---|---|---|---|
| Harness core | Node.js standard library (`node:crypto`, `node:fs`, `node:path`, `node:stream`, `node:readline/promises`, `node:url`) | Hashing, canonical JSON, journal I/O, CLI | v26.4.0 (VERIFIED on this machine 2026-09-21) | Local runtime; no network | Nothing runs | No (language runtime) | ACCEPTED |
| Tests | `node:test`, `node:assert/strict`, `node:http` | Test runner and a local HTTP server for adapter/provider tests | bundled with Node 26 | localhost only | Tests cannot run | Alternative: any external runner (rejected, adds dependency) | ACCEPTED |
| CLI | `node:readline/promises` | Interactive prompt | bundled | local process | CLI only | Plain stdin parsing | ACCEPTED |
| Model runtime | Ollama HTTP API (external process) | Local inference | contract documented in `docs/research/RESEARCH_LEDGER.md` §1; server version not fixed | Localhost network; **response body is untrusted** | Proposal stage unavailable → action denied, no execution | Yes: any implementation of `src/models/provider.mjs` | ACCEPTED (optional; NOT installed on the dev machine — verified 2026-09-21) |
| Type gate | `tsc` (TypeScript compiler), `@types/node` | `npm run typecheck` | not pinned to a package (resolved from the operator's local toolchain) | Local dev tool; **not a runtime dependency** | Type gate cannot run; `verify` fails loudly (exit 2) | `node --check` only (weaker, rejected as a substitute) | ACCEPTED as dev-only |
| Third-party runtime packages | — | — | — | — | — | — | **NONE. This is a design property, not an accident.** |

## Dependency discipline checklist (applied before any future addition)

| Question | Required answer |
|---|---|
| Can the standard library do this safely? | If yes, no dependency. |
| Is it actively maintained? | Evidence required (release within 12 months, security policy). |
| What transitive dependencies enter? | Enumerated and listed in the table above. |
| What privilege does it require? | Must be less than or equal to what we already hold. |
| Does it introduce network behaviour? | Any phone-home/telemetry = automatic rejection. |
| Can it execute code dynamically? | `eval`, `new Function`, native addons with codegen = rejection unless unavoidable and sandboxed. |
| Is the licence compatible? | Must be recorded with the package, with the licence file cited. |
| Is it necessary for v0.1? | If it serves a deferred feature, it is deferred too. |
| Pinned? | Exact version, lockfile committed; no ranges for runtime deps. |

## Supply-chain notes

- **No install step exists.** `npm install` is not required to run, test, or benchmark this
  repository. That removes the registry as an attack path entirely.
- **No postinstall scripts** can run because there are no packages.
- The type gate is the only tool that may come from outside; it is dev-only, never imported
  by runtime code, and its absence fails the gate loudly rather than silently (see
  `docs/reviews/IMPLEMENTATION_CRITIC.md`).
- Vendored code: **none**. Reference-implementation concepts are re-implemented, not copied
  (see `docs/RECONNAISSANCE.md` §Reusable and the licence-hygiene note in the Change Log).
