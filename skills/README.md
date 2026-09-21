# Skills Index

Portable engineering skills for Sovereign Action Harness v0.1. Each file below is a standalone
operating procedure for one recurring problem class; each cites the repository's own matrices,
research ledger ids, and test batteries. Sibling skill files in this directory maintained by
other workstreams are outside this index.

| Skill | Purpose | Use when |
|---|---|---|
| `local-model-tool-integration.md` | Model runtime as an untrusted proposal source behind `src/models/*` | Wiring or diagnosing the Ollama or scripted provider, prompt, envelope, or parse path |
| `safe-http-adapter-design.md` | Trusted-config HTTP execution with no redirects, timeouts, and untrusted responses | Enabling `src/adapters/generic-http-adapter.mjs`, adding bindings, or debugging adapter denials |
| `evidence-and-audit-journaling.md` | Append-only, hash-chained, redacted evidence via `src/evidence/journal.mjs` | Emitting events, changing redaction or chain logic, or investigating a broken chain |
| `independent-action-verification.md` | Execution success and verified success kept separate | Registering a verifier, reading `VERIFICATION_FAILED`, or proving a lying adapter is caught |
| `local-agent-benchmarking.md` | Deterministic fixture battery with reproducible reporting | Measuring proposal quality, comparing one changed variable, or classifying a failure |
| `external-collaboration-handoff.md` | Epistemic discipline and durable handoff record | Phase transitions, decisions, rejected work, or any claim reaching the collaborator |

## Format

The YAML frontmatter (`name`, `description`) follows the operator's canonical skill format at
`C:\Users\Grey_\.agents\skills\` — a directory-per-skill `SKILL.md` layout — extended here with
the collaboration directive's required body sections (`Purpose` through `Anti-patterns`, in
order). These files are portable: dropping `skills/<name>.md` into that tree as
`skills/<name>/SKILL.md` requires no edits.

## Grounding note

Module, config, benchmark, and test paths named in these skills are the v0.1 template paths
fixed by `docs/ARCHITECTURE.md` §2 and `docs/REQUIREMENTS_TRACEABILITY.md`. When a named path
is absent from the tree it is unimplemented, not optional; treat it as a blocker rather than
substituting an alternative. None of the six skills above claims implementation or a passing
test — each describes the procedure and the evidence that must exist before any such claim.
