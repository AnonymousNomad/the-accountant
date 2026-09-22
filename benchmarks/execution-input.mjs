/**
 * Execution input boundary (Phase 2 anti-leak repair).
 *
 * S19 exposed a real defect: the bounded discovery filter was derived from the task's *expected*
 * capability — the scoring answer decided which tools were shown. That is ground-truth leakage and
 * it must be impossible to reintroduce.
 *
 * The boundary is enforced by projection plus refusal:
 *   - `executionTaskOf(task)` projects a task onto exactly the fields execution may see;
 *   - `buildExecutionInput(executionTask)` refuses (throws) if it is handed anything else, so a future
 *     caller who passes a raw benchmark task gets a loud failure instead of a silent leak.
 *
 * Scoring truth (`expected`, `notes`, reference arguments, failure classes) exists only in the
 * post-inference scoring path. Execution receives: the user's request, the trusted UI context
 * (screen / selected entity / jurisdiction), and nothing about the answer.
 *
 * @module benchmarks/execution-input
 */

import { sha256Hex, canonicalJson } from '../src/core/canonical.mjs';

/** Fields execution may see. Anything else is scoring truth or bookkeeping. */
export const ALLOWED_EXECUTION_FIELDS = Object.freeze(['id', 'text', 'screen', 'entity', 'jurisdiction', 'category', 'difficulty']);

/** Fields that must never reach execution, named explicitly so the refusal is self-documenting. */
export const FORBIDDEN_EXECUTION_FIELDS = Object.freeze(['expected', 'notes', 'answer', 'referenceArgs', 'failureClass', 'scripted']);

export class ExecutionBoundaryError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'ExecutionBoundaryError';
    this.code = 'EXECUTION_BOUNDARY_VIOLATION';
  }
}

/**
 * Project a benchmark task onto the execution-visible fields.
 * @param {Record<string, unknown>} task
 * @returns {{ id: string, text: string, screen: string, entity: string, jurisdiction: string, category: string, difficulty: string }}
 */
export function executionTaskOf(task) {
  if (task === null || typeof task !== 'object') {
    throw new ExecutionBoundaryError('executionTaskOf: task must be an object');
  }
  for (const forbidden of FORBIDDEN_EXECUTION_FIELDS) {
    if (forbidden in task) {
      // Deliberately allowed here: projection is the sanitisation step. The refusal lives in
      // buildExecutionInput, which must never see these fields.
      continue;
    }
  }
  const text = typeof task.text === 'string' ? task.text.trim() : '';
  if (text.length === 0) throw new ExecutionBoundaryError('executionTaskOf: task needs a non-empty text');
  return {
    id: String(task.id ?? ''),
    text,
    screen: typeof task.screen === 'string' ? task.screen : '',
    entity: typeof task.entity === 'string' ? task.entity : '',
    jurisdiction: typeof task.jurisdiction === 'string' ? task.jurisdiction : '',
    category: typeof task.category === 'string' ? task.category : '',
    difficulty: typeof task.difficulty === 'string' ? task.difficulty : ''
  };
}

/**
 * Build the exact input execution receives. Refuses any object carrying fields outside the allowed
 * set — including every forbidden scoring-truth field.
 * @param {Record<string, unknown>} executionTask  Output of `executionTaskOf`.
 * @returns {{ userMessage: string, textForDiscovery: string, labels: { screen: string, entity: string, jurisdiction: string } }}
 */
export function buildExecutionInput(executionTask) {
  if (executionTask === null || typeof executionTask !== 'object') {
    throw new ExecutionBoundaryError('buildExecutionInput: execution task must be an object');
  }
  for (const key of Object.keys(executionTask)) {
    if (!ALLOWED_EXECUTION_FIELDS.includes(key)) {
      const kind = FORBIDDEN_EXECUTION_FIELDS.includes(key) ? 'scoring truth' : 'unknown field';
      throw new ExecutionBoundaryError(
        `buildExecutionInput: refusing to execute with ${kind} "${key}" present. ` +
          'Execution input must come from executionTaskOf(), never from a raw benchmark task.'
      );
    }
  }

  const source = /** @type {{ screen?: string, entity?: string, jurisdiction?: string }} */ (executionTask);
  const labels = {
    screen: typeof source.screen === 'string' ? source.screen : '',
    entity: typeof source.entity === 'string' ? source.entity : '',
    jurisdiction: typeof source.jurisdiction === 'string' ? source.jurisdiction : ''
  };
  // Trusted UI context is legitimate execution input (Phase 3: current screen / selected entity /
  // jurisdiction). It is stated as context, never as an answer.
  const contextParts = [];
  if (labels.screen) contextParts.push(`screen=${labels.screen}`);
  if (labels.entity) contextParts.push(`selected=${labels.entity}`);
  if (labels.jurisdiction) contextParts.push(`jurisdiction=${labels.jurisdiction}`);
  const prefix = contextParts.length > 0 ? `[context: ${contextParts.join(' ')}]\n` : '';

  return {
    userMessage: `${prefix}${executionTask.text}`,
    // Discovery signals: user language plus the same trusted context, so keyword ranking can use them.
    textForDiscovery: `${executionTask.text} ${labels.screen} ${labels.entity} ${labels.jurisdiction} ${executionTask.category}`.trim(),
    labels
  };
}

/**
 * Fingerprint the configuration that was actually loaded, not the path that was requested.
 * @param {Record<string, unknown>} effectiveConfig
 * @returns {string}
 */
export function effectiveConfigFingerprint(effectiveConfig) {
  return sha256Hex(canonicalJson(effectiveConfig)).slice(0, 32);
}

/**
 * Refuse to run when the harness configuration that will execute differs from the one declared for
 * the experiment. Returns the fingerprint when they agree.
 * @param {{ requestedPath: string, specPath: string, loadedPath: string, effectiveConfig: Record<string, unknown> }} input
 * @returns {string}
 */
export function assertConfigTruth(input) {
  if (input.specPath && input.requestedPath && input.specPath !== input.loadedPath) {
    throw new ExecutionBoundaryError(
      `configuration truth violation: the experiment declares ${input.specPath} but ${input.loadedPath} was loaded`
    );
  }
  return effectiveConfigFingerprint(input.effectiveConfig);
}
