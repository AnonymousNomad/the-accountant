/**
 * Mock accounting adapter: dispatches validated arguments to the synthetic domain store.
 *
 * This adapter is the one that makes the v0.1 demonstration complete. It performs no
 * calculation of its own — arithmetic belongs to the domain store, so that a verifier can
 * independently re-read the same state (docs/matrices/DECISION_MATRIX.md DM-14).
 *
 * @module adapters/mock-accounting-adapter
 */

import { AdapterError, CODES, messageOf } from '../core/errors.mjs';

/**
 * @typedef {{ ok: true, data: Record<string, unknown> } | { ok: false, code: string, detail: string, commitState: 'NOT_SENT'|'UNKNOWN' }} AdapterOutcome
 */

/**
 * @param {{ store: ReturnType<import('../domain/synthetic-accounting/store.mjs').createSyntheticAccountingStore>, enabled?: boolean }} deps
 */
export function createMockAccountingAdapter(deps) {
  const { store, enabled = true } = deps;

  /** @type {Record<string, (args: any) => Record<string, unknown>>} */
  const operations = {
    'customer.search': (args) => store.searchCustomers(args),
    'customer.create': (args) => store.createCustomer(args),
    'customer.update': (args) => store.updateCustomer(args),
    'invoice.create_draft': (args) => store.createDraftInvoice(args),
    'invoice.preview': (args) => store.previewInvoice(args),
    'invoice.issue': (args) => store.issueInvoice(args),
    'ledger.query': (args) => store.queryLedger(args),
    'journal.propose': (args) => store.proposeJournal(args)
  };

  return {
    kind: 'mock',
    enabled,

    /** @param {string} operation */
    has(operation) {
      return Object.prototype.hasOwnProperty.call(operations, operation);
    },

    /**
     * @param {{ capability: import('../registry/capability.mjs').Capability, operation: string, arguments: Record<string, unknown> }} input
     * @returns {AdapterOutcome}
     */
    execute(input) {
      if (!enabled) {
        return { ok: false, code: CODES.ADAPTER_DISABLED, detail: 'mock adapter is disabled by configuration', commitState: 'NOT_SENT' };
      }
      const operation = operations[input.operation];
      if (!operation) {
        return { ok: false, code: CODES.ADAPTER_NOT_REGISTERED, detail: `no mock operation "${input.operation}"`, commitState: 'NOT_SENT' };
      }
      try {
        const data = operation(input.arguments);
        return { ok: true, data: /** @type {Record<string, unknown>} */ (data) };
      } catch (err) {
        // In-process and synchronous: a refused domain operation definitely did not commit.
        return { ok: false, code: CODES.DOMAIN_OPERATION_FAILED, detail: messageOf(err), commitState: 'NOT_SENT' };
      }
    }
  };
}

export { AdapterError };
