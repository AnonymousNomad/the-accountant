# Capability Mapping Worksheet

One worksheet per semantic capability. Copy the template, fill every row, keep unresolved rows visible
rather than guessing. **The model never sees the right-hand column** — routes, modules, permissions and
idempotency are trusted configuration and adapter concerns.

## Template

| Field | Value |
|---|---|
| Semantic capability id | e.g. `customer.search` |
| Purpose (user intent it serves) | |
| Risk class | READ / DRAFT / MUTATION / FINANCIAL |
| Real route / service / function | *from the application audit — not invented here* |
| Source file / module | |
| Request schema | field, type, required?, units/encoding |
| Response schema | field, type, meaning |
| Actor / workspace requirements | |
| Permission requirements | the permission **the application actually enforces** |
| Transaction behaviour | atomic? partial possible? what commits when |
| Idempotency behaviour | naturally idempotent / key supported / non-idempotent |
| Authoritative success condition | the fact that must be true after success |
| Read-back verification method | the exact read that proves it (never a cache) |
| Possible ambiguous-commit state | what an unknown result looks like, and what to do |
| Expected evidence | ids, digests, statuses the harness must record |
| Notes / unresolved questions | anything UNKNOWN, with who can answer it |

## Worked examples (generic — replace with the real application's contracts)

### customer.search — READ

| Field | Value |
|---|---|
| Purpose | resolve a user-named customer to one or more identifiers |
| Risk class | READ |
| Real route / service | `<application customer search service>` |
| Request | `query` (string, required, 1–80 chars), `limit` (integer, optional, 1–25) |
| Response | `items[]` with `{ id, name, email }`, `count` |
| Permission | the read permission the service enforces (e.g. customer read) |
| Transaction | none (read-only) |
| Idempotency | naturally idempotent |
| Success condition | a well-formed result set (including an empty one) was returned |
| Read-back | re-run the same search and compare (a read proves itself only if the source is not cached) |
| Ambiguous state | none — a failed read is a failed read |
| Evidence | query digest, result count, first N ids |

### customer.create — MUTATION

| Field | Value |
|---|---|
| Purpose | create a new customer record |
| Risk class | MUTATION |
| Real route / service | `<application customer create service>` |
| Request | `name` (string, required), `email` (string, optional) |
| Response | the created record's `id` plus the stored fields |
| Permission | the write permission the service enforces |
| Transaction | must be atomic for the record; note whether related rows are written |
| Idempotency | **ask**: is a key honoured? if not, duplicates are possible |
| Success condition | a customer exists whose id the service returned and whose fields match the request |
| Read-back | fetch the created customer by id and compare fields |
| Ambiguous state | timeout after send ⇒ `COMMIT_UNKNOWN`; reconcile by searching for the created record before any retry |
| Evidence | returned id, read-back digest, idempotency class |

### invoice.create_draft — DRAFT

| Field | Value |
|---|---|
| Purpose | prepare an invoice for review without posting any financial effect |
| Risk class | DRAFT |
| Real route / service | `<application draft invoice service>` |
| Request | `customerId` (required), `lines[]` with description/quantity/unit price |
| Response | draft id, status, stored lines, computed total |
| Permission | the write permission the service enforces |
| Transaction | line and header must commit together; verify |
| Idempotency | likely non-idempotent (each call may create a new draft) — confirm |
| Success condition | a draft exists with status DRAFT, the right customer and the intended lines |
| Read-back | fetch the draft by id; compare lines and the **service-computed** total |
| Ambiguous state | timeout after send ⇒ reconcile by listing recent drafts before any retry |
| Evidence | draft id, status, total digest; explicitly note the draft has **no posted effect** |

## Rules

- Never copy a route name from documentation or memory: read it from the application.
- If a row cannot be filled with evidence, the capability is **not ready**; record the unknown and the
  person who can answer it.
- A capability with no authoritative read-back is `UNVERIFIABLE` — do not ship it with a plausible
  verifier. Propose a compensating read or leave it out of the first slice.
