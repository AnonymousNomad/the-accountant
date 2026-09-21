/**
 * The synthetic accounting capability pack — eight semantic operations, with the metadata the
 * model needs in order to choose correctly (addendum §1, §4).
 *
 * Every field is written for a small local model: `whenToUse` and `whenNotToUse` exist to
 * remove ambiguous choices, and the descriptions name the distinguishing condition rather than
 * restating the verb. The risk classes are fixed here by a human, never by a model
 * (sops/capability_risk_classification.md).
 *
 * @module domain/synthetic-accounting/capabilities
 */

/**
 * @typedef {import('../../registry/capability.mjs').Capability} Capability
 */

/**
 * @returns {Record<string, unknown>[]}
 */
export function syntheticAccountingCapabilities() {
  return [
    {
      id: 'customer.search',
      version: 1,
      description: 'Search existing customer records by name or email and return their identifiers.',
      whenToUse:
        'Use when the user names a customer but you do not have its identifier, or when you must check whether a customer already exists before creating one.',
      whenNotToUse: 'Do not use to create or change a customer, and do not use when the user already supplied a customer identifier.',
      domain: 'accounting.customers',
      risk: 'READ',
      outputSummary: 'The count and a bounded list of matching customers with customerId, name, email and version.',
      requiredPermissions: ['accounting.read'],
      requiresConfirmation: false,
      sideEffects: ['none'],
      relatedCapabilities: ['customer.create', 'customer.update'],
      tags: ['customer', 'client', 'search', 'find', 'lookup', 'existing', 'name', 'email'],
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 80, nonPlaceholder: true, description: 'Name or email fragment to search for.' },
          limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Maximum number of matches to return (default 10).' }
        }
      },
      adapter: { kind: 'mock', operation: 'customer.search' },
      enabled: true,
      idempotency: 'naturally_idempotent',
      sensitivity: 'low',
      verifier: 'read.matches_result'
    },
    {
      id: 'customer.create',
      version: 1,
      description: 'Create a new customer record.',
      whenToUse:
        'Use when the user explicitly asks for a new customer to be recorded and no existing customer with that name should be reused.',
      whenNotToUse:
        'Do not use if a customer with the same name may already exist; search for the existing customer first. Do not use to modify an existing customer.',
      domain: 'accounting.customers',
      risk: 'MUTATION',
      outputSummary: 'The new customerId, the stored name and email, and the initial record version.',
      requiredPermissions: ['accounting.write'],
      requiresConfirmation: false,
      sideEffects: ['creates a persistent customer record'],
      relatedCapabilities: ['customer.search', 'customer.update'],
      tags: ['customer', 'client', 'create', 'new', 'add', 'register', 'acme'],
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80, nonPlaceholder: true, description: 'Customer name as the user stated it.' },
          email: { type: 'string', minLength: 5, maxLength: 120, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', description: 'Optional billing email.' }
        }
      },
      adapter: { kind: 'mock', operation: 'customer.create' },
      enabled: true,
      idempotency: 'idempotency_key_supported',
      sensitivity: 'moderate',
      verifier: 'customer.created'
    },
    {
      id: 'customer.update',
      version: 1,
      description: 'Change the name or email of an existing customer record.',
      whenToUse: 'Use when the user asks to correct or change details of a customer you can identify by customerId.',
      whenNotToUse: 'Do not use to create a customer, and do not use without a customer identifier obtained from a search or supplied by the user.',
      domain: 'accounting.customers',
      risk: 'MUTATION',
      outputSummary: 'The updated customerId, the stored name and email, and the incremented record version.',
      requiredPermissions: ['accounting.write'],
      requiresConfirmation: false,
      sideEffects: ['modifies an existing customer record and increments its version'],
      relatedCapabilities: ['customer.search', 'customer.create'],
      tags: ['customer', 'client', 'update', 'change', 'edit', 'rename', 'correct'],
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['customerId'],
        properties: {
          customerId: { type: 'string', minLength: 8, maxLength: 8, pattern: '^CUS-[0-9]{4}$', nonPlaceholder: true },
          name: { type: 'string', minLength: 1, maxLength: 80, nonPlaceholder: true },
          email: { type: 'string', minLength: 5, maxLength: 120, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' }
        }
      },
      adapter: { kind: 'mock', operation: 'customer.update' },
      enabled: true,
      idempotency: 'idempotency_key_supported',
      sensitivity: 'moderate',
      verifier: 'customer.updated'
    },
    {
      id: 'invoice.create_draft',
      version: 1,
      description: 'Create a draft invoice for an existing customer. The draft has no posted financial effect.',
      whenToUse: 'Use when the user wants an invoice prepared for review, and the customer and line items are known.',
      whenNotToUse: 'Do not use to issue or post an invoice; issuing is a separate, confirmation-required operation. Do not guess line items.',
      domain: 'accounting.invoices',
      risk: 'DRAFT',
      outputSummary: 'The new invoiceId, its status (DRAFT), the lines as stored and the computed total in integer cents.',
      requiredPermissions: ['accounting.write'],
      requiresConfirmation: false,
      sideEffects: ['creates a draft invoice record with no posted financial effect'],
      relatedCapabilities: ['invoice.preview', 'invoice.issue', 'customer.search'],
      tags: ['invoice', 'bill', 'draft', 'create', 'new', 'prepare', 'smith'],
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['customerId', 'lines'],
        properties: {
          customerId: { type: 'string', minLength: 8, maxLength: 8, pattern: '^CUS-[0-9]{4}$', nonPlaceholder: true },
          lines: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['description', 'quantity', 'unitPriceCents'],
              properties: {
                description: { type: 'string', minLength: 2, maxLength: 120, nonPlaceholder: true },
                quantity: { type: 'integer', minimum: 1, maximum: 1000 },
                unitPriceCents: { type: 'integer', minimum: 0, maximum: 100000000 }
              }
            }
          }
        }
      },
      adapter: { kind: 'mock', operation: 'invoice.create_draft' },
      enabled: true,
      idempotency: 'non_idempotent',
      sensitivity: 'moderate',
      verifier: 'invoice.drafted'
    },
    {
      id: 'invoice.preview',
      version: 1,
      description: 'Read a draft or issued invoice: status, lines and total. Never changes state.',
      whenToUse: 'Use to check what an invoice currently contains, or to confirm its status before issuing it.',
      whenNotToUse: 'Do not use to create, change or issue an invoice.',
      domain: 'accounting.invoices',
      risk: 'READ',
      outputSummary: 'The invoice status, customerId, stored lines, total and currency.',
      requiredPermissions: ['accounting.read'],
      requiresConfirmation: false,
      sideEffects: ['none'],
      relatedCapabilities: ['invoice.create_draft', 'invoice.issue'],
      tags: ['invoice', 'preview', 'show', 'read', 'detail', 'status', 'total', 'inv'],
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['invoiceId'],
        properties: {
          invoiceId: { type: 'string', minLength: 8, maxLength: 8, pattern: '^INV-[0-9]{4}$', nonPlaceholder: true }
        }
      },
      adapter: { kind: 'mock', operation: 'invoice.preview' },
      enabled: true,
      idempotency: 'naturally_idempotent',
      sensitivity: 'low',
      verifier: 'read.matches_result'
    },
    {
      id: 'invoice.issue',
      version: 1,
      description: 'Issue a draft invoice. This is a one-way transition from DRAFT to ISSUED that posts a ledger entry.',
      whenToUse: 'Use only when the user asks to issue, post, finalize or send a specific draft invoice that already exists.',
      whenNotToUse: 'Do not use for an invoice that is already issued, and do not use before previewing a draft you have not seen.',
      domain: 'accounting.invoices',
      risk: 'FINANCIAL',
      outputSummary: 'The issued invoiceId, its issue timestamp, its total and the ledger entry the posting created.',
      requiredPermissions: ['accounting.financial'],
      requiresConfirmation: true,
      sideEffects: ['invoice state becomes ISSUED irreversibly', 'posts a ledger entry for the invoice total'],
      prerequisites: { descriptions: ['at least one draft invoice must exist'], checks: ['invoice.has_draft'] },
      relatedCapabilities: ['invoice.preview', 'invoice.create_draft', 'ledger.query'],
      tags: ['invoice', 'issue', 'post', 'finalize', 'send', 'inv', 'financial'],
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['invoiceId'],
        properties: {
          invoiceId: { type: 'string', minLength: 8, maxLength: 8, pattern: '^INV-[0-9]{4}$', nonPlaceholder: true }
        }
      },
      adapter: { kind: 'mock', operation: 'invoice.issue' },
      enabled: true,
      idempotency: 'non_idempotent',
      sensitivity: 'high',
      verifier: 'invoice.issued'
    },
    {
      id: 'ledger.query',
      version: 1,
      description: 'Read ledger entries, optionally filtered by account name.',
      whenToUse: 'Use when the user asks what has been posted to the ledger, or wants recent entries for one account.',
      whenNotToUse: 'Do not use to post, correct or reverse a ledger entry; no such capability exists in this harness.',
      domain: 'accounting.ledger',
      risk: 'READ',
      outputSummary: 'The count and a bounded list of ledger entries with entryId, account, amount, memo and source.',
      requiredPermissions: ['accounting.read'],
      requiresConfirmation: false,
      sideEffects: ['none'],
      relatedCapabilities: ['invoice.issue'],
      tags: ['ledger', 'entries', 'posted', 'account', 'balance', 'receivable', 'history'],
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: [],
        properties: {
          account: { type: 'string', minLength: 3, maxLength: 60, nonPlaceholder: true },
          limit: { type: 'integer', minimum: 1, maximum: 50 }
        }
      },
      adapter: { kind: 'mock', operation: 'ledger.query' },
      enabled: true,
      idempotency: 'naturally_idempotent',
      sensitivity: 'low',
      verifier: 'read.matches_result'
    },
    {
      id: 'journal.propose',
      version: 1,
      description: 'Propose a balanced journal entry as a DRAFT for human review. It does not post.',
      whenToUse: 'Use when the user wants a correcting or adjusting entry drafted, and they have stated the accounts and amounts.',
      whenNotToUse: 'Do not use to post or reverse anything, and do not invent accounts or amounts the user did not state.',
      domain: 'accounting.ledger',
      risk: 'DRAFT',
      outputSummary: 'The new journalId, its DRAFT status, the memo, the date and the balanced debit/credit totals.',
      requiredPermissions: ['accounting.write'],
      requiresConfirmation: false,
      sideEffects: ['creates a draft journal entry that must be reviewed before it is posted'],
      relatedCapabilities: ['ledger.query'],
      tags: ['journal', 'entry', 'draft', 'adjust', 'correct', 'accrual', 'debit', 'credit'],
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['memo', 'date', 'lines'],
        properties: {
          memo: { type: 'string', minLength: 3, maxLength: 120, nonPlaceholder: true },
          date: { type: 'string', minLength: 10, maxLength: 10, pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', nonPlaceholder: true },
          lines: {
            type: 'array',
            minItems: 2,
            maxItems: 12,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['account', 'debitCents', 'creditCents'],
              properties: {
                account: { type: 'string', minLength: 3, maxLength: 60, nonPlaceholder: true },
                debitCents: { type: 'integer', minimum: 0, maximum: 100000000 },
                creditCents: { type: 'integer', minimum: 0, maximum: 100000000 }
              }
            }
          }
        }
      },
      adapter: { kind: 'mock', operation: 'journal.propose' },
      enabled: true,
      idempotency: 'non_idempotent',
      sensitivity: 'moderate',
      verifier: 'journal.proposed'
    }
  ];
}
