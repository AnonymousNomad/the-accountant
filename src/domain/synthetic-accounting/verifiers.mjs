/**
 * Verifiers for the synthetic accounting pack.
 *
 * Each verifier re-reads the store and checks the claim the adapter made. It never inspects
 * the adapter's return value as if it were evidence — the return value is the claim under
 * test (docs/ARCHITECTURE.md §5 boundary 6, research R-41, decision DM-14). Reads are
 * verified by re-executing the same deterministic read and comparing results, which is a real
 * check because the store is deterministic.
 *
 * @module domain/synthetic-accounting/verifiers
 */

import { check } from '../../evidence/verifier.mjs';

/**
 * @param {ReturnType<import('../../evidence/verifier.mjs').createVerifierRegistry>} registry
 * @param {ReturnType<import('./store.mjs').createSyntheticAccountingStore>} store
 */
export function registerSyntheticAccountingVerifiers(registry, store) {
  registry.register('customer.created', ({ arguments: args, execution }) => {
    const id = String(execution.data?.customerId ?? '');
    const customer = store.getCustomer(id);
    return {
      checks: [
        check('customer_exists', customer !== null, customer ? undefined : `no customer ${id} in the store`),
        check('name_matches', Boolean(customer) && customer?.name === args.name, `expected "${String(args.name)}", found "${customer?.name ?? 'nothing'}"`),
        check(
          'email_matches',
          Boolean(customer) && (args.email === undefined || customer?.email === args.email),
          'stored email does not match the requested email'
        )
      ]
    };
  });

  registry.register('customer.updated', ({ arguments: args, execution }) => {
    const id = String(args.customerId);
    const customer = store.getCustomer(id);
    const checks = [
      check('customer_exists', customer !== null, customer ? undefined : `no customer ${id} in the store`),
      check('version_incremented', Boolean(customer) && Number(customer?.version ?? 0) >= 2, 'record version did not increase'),
      check(
        'reported_version_matches_store',
        Boolean(customer) && execution.data?.version === customer?.version,
        'adapter reported a version that the store does not have'
      )
    ];
    if (args.name !== undefined) checks.push(check('name_matches', Boolean(customer) && customer?.name === args.name));
    if (args.email !== undefined) checks.push(check('email_matches', Boolean(customer) && customer?.email === args.email));
    return { checks };
  });

  registry.register('invoice.drafted', ({ arguments: args, execution }) => {
    const id = String(execution.data?.invoiceId ?? '');
    const invoice = store.getInvoice(id);
    const expectedTotal = /** @type {Array<{ quantity: number, unitPriceCents: number }>} */ (args.lines ?? []).reduce(
      (sum, line) => sum + line.quantity * line.unitPriceCents,
      0
    );
    return {
      checks: [
        check('invoice_exists', invoice !== null, invoice ? undefined : `no invoice ${id} in the store`),
        check('status_is_draft', invoice?.status === 'DRAFT', `status is ${invoice?.status ?? 'missing'}`),
        check('customer_matches', invoice?.customerId === args.customerId),
        check('total_matches_lines', invoice?.totalCents === expectedTotal, `expected ${expectedTotal}, found ${String(invoice?.totalCents)}`),
        check('reported_total_matches_store', execution.data?.totalCents === invoice?.totalCents)
      ]
    };
  });

  registry.register('invoice.issued', ({ arguments: args, execution }) => {
    const id = String(args.invoiceId);
    const invoice = store.getInvoice(id);
    const ledgerEntry = invoice?.ledgerEntryId ? store.listLedger().find((entry) => entry.entryId === invoice.ledgerEntryId) : undefined;
    return {
      checks: [
        check('invoice_exists', invoice !== null, invoice ? undefined : `no invoice ${id} in the store`),
        check('status_is_issued', invoice?.status === 'ISSUED', `status is ${invoice?.status ?? 'missing'}`),
        check('issued_at_recorded', typeof invoice?.issuedAt === 'string' && invoice.issuedAt.length > 0),
        check('ledger_entry_present', Boolean(ledgerEntry), 'no ledger entry references this invoice'),
        check('ledger_entry_matches_total', Boolean(ledgerEntry) && ledgerEntry?.amountCents === invoice?.totalCents),
        check('reported_ledger_entry_matches_store', execution.data?.ledgerEntryId === invoice?.ledgerEntryId)
      ]
    };
  });

  registry.register('journal.proposed', ({ arguments: args, execution }) => {
    const id = String(execution.data?.journalId ?? '');
    const journal = store.getJournal(id);
    const lines = /** @type {Array<{ debitCents: number, creditCents: number }>} */ (journal?.lines ?? []);
    const debits = lines.reduce((sum, line) => sum + line.debitCents, 0);
    const credits = lines.reduce((sum, line) => sum + line.creditCents, 0);
    return {
      checks: [
        check('journal_exists', journal !== null, journal ? undefined : `no journal ${id} in the store`),
        check('status_is_draft', journal?.status === 'DRAFT', `status is ${String(journal?.status)}`),
        check('balanced', debits === credits && debits > 0, `debits ${debits} vs credits ${credits}`),
        check('memo_matches', journal?.memo === args.memo),
        check('date_matches', journal?.date === args.date)
      ]
    };
  });

  registry.register('read.matches_result', ({ capability, arguments: args, execution }) => {
    let reread;
    switch (capability.id) {
      case 'customer.search':
        reread = store.searchCustomers(/** @type {{ query: string, limit?: number }} */ (args));
        break;
      case 'invoice.preview':
        reread = store.previewInvoice(/** @type {{ invoiceId: string }} */ (args));
        break;
      case 'ledger.query':
        reread = store.queryLedger(/** @type {{ limit?: number, account?: string }} */ (args));
        break;
      default:
        return { checks: [check('read_is_verifiable', false, `no read verifier for ${capability.id}`)] };
    }
    const reported = JSON.stringify(execution.data ?? {});
    const actual = JSON.stringify(reread);
    return {
      checks: [
        check('read_reproduced', reported === actual, reported === actual ? undefined : 're-read returned a different result'),
        check('result_shape', execution.data !== undefined && execution.data !== null, 'adapter returned no data')
      ]
    };
  });
}
