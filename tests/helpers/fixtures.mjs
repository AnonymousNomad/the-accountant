/**
 * Shared test fixtures and helpers.
 *
 * Tests build real harnesses (never mocks of the harness) so that the pipeline under test is
 * the pipeline that ships. The only injected pieces are the provider (a labelled fixture
 * replay) and, where a test is specifically about a defective component, an adapter.
 *
 * @module tests/helpers/fixtures
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHarnessFromConfig } from '../../src/bootstrap.mjs';
import { createClock } from '../../src/core/util.mjs';

export const BASE_TIME = Date.parse('2026-05-01T00:00:00.000Z');

/**
 * @typedef {Awaited<ReturnType<typeof createHarnessFromConfig>>} Bundle
 */

/**
 * Build a fully wired harness over a temporary evidence directory.
 * @param {Record<string, any>} [options] Passed through to createHarnessFromConfig.
 * @returns {Promise<{ bundle: Bundle, evidenceDir: string, cleanup: () => Promise<void> }>}
 */
export async function makeHarness(options = {}) {
  const evidenceDir = await mkdtemp(join(tmpdir(), 'sah-'));
  const bundle = await createHarnessFromConfig({
    providerKind: 'scripted',
    evidenceDir,
    clock: createClock(BASE_TIME),
    ...options
  });
  return {
    bundle,
    evidenceDir,
    cleanup: async () => {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  };
}

/**
 * Queue one fixture response and run one user instruction.
 * @param {Bundle} bundle
 * @param {string} text
 * @param {Record<string, unknown>} envelope
 * @param {{ raw?: boolean }} [options]
 */
export async function turn(bundle, text, envelope, options = {}) {
  /** @type {any} */ (bundle.provider).respondWith(options.raw ? String(envelope) : JSON.stringify(envelope));
  return bundle.harness.handleUserMessage(text);
}

/**
 * Queue a raw (possibly malformed) response and run one instruction.
 * @param {Bundle} bundle
 * @param {string} text
 * @param {string} raw
 */
export async function rawTurn(bundle, text, raw) {
  /** @type {any} */ (bundle.provider).respondWith(raw);
  return bundle.harness.handleUserMessage(text);
}

/**
 * @param {string} capability
 * @param {Record<string, unknown>} args
 * @param {string} [proposalId]
 */
export function proposal(capability, args, proposalId = `p-${Math.random().toString(36).slice(2, 10)}`) {
  return {
    kind: 'proposal',
    proposalId,
    capability,
    arguments: args,
    reasoningSummary: `The user asked for ${capability}.`
  };
}

/**
 * A mock adapter that always reports success without touching any state. Its only purpose is
 * to prove that verification catches a lying adapter (docs/matrices/FAILURE_MATRIX.md F-22).
 */
export const lyingMockAdapter = {
  kind: 'mock',
  enabled: true,
  has: () => true,
  execute: () => ({
    ok: true,
    data: { customerId: 'CUS-9999', name: 'Ghost Customer', email: 'ghost@synthetic.example', version: 1 }
  })
};

/**
 * A mock adapter that always fails, to prove that adapter failure cannot become success.
 */
export const failingMockAdapter = {
  kind: 'mock',
  enabled: true,
  has: () => true,
  execute: () => ({ ok: false, code: 'ADAPTER_ERROR', detail: 'synthetic adapter failure' })
};

/**
 * Start a local HTTP server for adapter and provider tests. Localhost only, ephemeral port.
 * @param {(req: any, res: any) => void} handler
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export async function startLocalServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: async () => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  };
}

/**
 * Read the journal events for one run id.
 * @param {Bundle} bundle
 * @param {string} runId
 */
export async function eventsFor(bundle, runId) {
  const events = await bundle.journal.read(200);
  return events.filter((event) => event.runId === runId);
}

/**
 * Event types for one run, in order.
 * @param {Bundle} bundle
 * @param {string} runId
 */
export async function eventTypes(bundle, runId) {
  return (await eventsFor(bundle, runId)).map((event) => event.type);
}
