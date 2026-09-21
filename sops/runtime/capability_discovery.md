# Capability Discovery — Deterministic Selection for This Turn

## Objective
Select, for exactly this turn, the relevant capabilities from the trusted registry by deterministic
filtering — domain, task, permissions, prerequisites, `enabled` — and define what happens when the
needed capability is absent: unsupported, not improvisation.

## Prerequisites
- The registry was built at startup from trusted packs; a capability without a verifier, adapter,
  permission, or risk class cannot register (I-10, F-25).
- Config validated: `exposure.domains`, `exposure.maxCapabilities`, `policy.grantedPermissions`.
- Each capability declares `enabled` and an idempotency class (`naturally_idempotent`,
  `idempotency_key_supported`, `non_idempotent`) in trusted metadata — never in model output.
- `:capabilities` displays the context that would be offered for the next request.

## Procedure
1. Build the candidate set from the registry only; never from model output, user text, prior turns, or
   adapter output.
2. Apply filters in fixed order: `enabled` is true; domain ∈ `exposure.domains`; every
   `requiredPermissions` entry is granted; every prerequisite check is available; then deterministic
   relevance (tag hits weight most, then id tokens, then description text) with ties by registration
   order; cap the set at `exposure.maxCapabilities`.
3. Record every exclusion with its reason (`DOMAIN_NOT_SELECTED`, `PERMISSION_NOT_GRANTED`,
   `PREREQUISITE_UNAVAILABLE`, `EXCEEDS_EXPOSURE_CAP`, plus `enabled:false` refusals) so a bad outcome
   is attributable to the model's choice or to the catalogue it was given.
4. Emit exactly the exposed set to the model and journal `CAPABILITIES_EXPOSED` with the snapshot
   identity: ids, definition hashes, `contextHash`, exclusions, budget.
5. On proposal, validate the id against this snapshot's ids and the definition hash against the
   snapshot's hash; a disabled or filtered capability is never proposable, even by exact id.
6. On execution, require the live snapshot identity to equal the identity shown at selection; selection
   and execution validate against the same snapshot, and a registry/config change mid-turn fails the
   turn closed.
7. If no exposed capability can produce the requested effect, return (and accept) `kind:"unsupported"`;
   the run ends in `UNSUPPORTED` and nothing executes. Never substitute a different capability, never
   invent an id, and never compose capabilities to imitate the missing effect.
8. Treat a filtered-but-registered capability as absent for this turn; do not reveal it to the model
   and do not accept it in a proposal (F-08). Widening exposure requires a reviewed config change.

## Gates
- G1: every proposal id is in the snapshot's exposed ids, and every definition hash matches.
- G2: the filter set is deterministic — same registry, config, and task text yield the same ids,
  exclusions, and order; confirm by re-running `:capabilities` on the same instruction.
- G3: `CAPABILITIES_EXPOSED` and the run's execution events carry the same snapshot identity.
- G4: an unsupported outcome is journaled with its reason and no permit exists for the run.

## Expected evidence
- `CAPABILITIES_EXPOSED`: snapshotId, contextHash, exposed ids, exclusion reasons, budget.
- For an absent capability: `UNSUPPORTED_REQUEST` with the reason; `:evidence` shows no `AUTHORIZED`,
  `AUTHORITY_CONSUMED`, or `EXECUTION_STARTED` record for the run.

## Failure conditions
- A disabled capability exposed or executed: process defect; stop the session and escalate.
- Non-deterministic ranking (different sets for identical inputs): defect; stop and escalate.
- A proposal for an id outside the snapshot: `REJECTED` (`CAPABILITY_NOT_EXPOSED`); an id absent from the
  registry: `REJECTED` (`UNKNOWN_CAPABILITY`); the turn is never repaired.
- An unsupported request approximated by another capability: process failure; the unrequested effect is
  reported exactly and never retried automatically.

## Recovery / rollback
- Do not widen exposure, grant a permission, or enable an adapter to make one turn pass (F-12).
- A needed capability is added by a reviewed build-time change (capability onboarding); a fresh session
  then discovers it, and a remembered id from the old snapshot never executes.
- After a registry or config change, restart so every permit and confirmation from the old snapshot is
  discarded.

## Completion criteria
- Every run's proposal, decision, and execution cite one snapshot; every capability used was exposed for
  that turn; unsupported requests ended in `UNSUPPORTED` with a recorded reason and no effect.
