/**
 * Inert "engine" used by provider-lifecycle tests.
 *
 * It exists so the test suite can prove one specific failure path deterministically: when the
 * configured executable cannot start, the provider reports a typed error and leaves no process
 * behind. It intentionally does nothing else — there is no fake inference anywhere in this
 * repository, and the live-model validation runs the real engine.
 *
 * Invoked by tests as `node tests/helpers/fake-engine.mjs <ignored args...>`; node rejects the
 * llama-server-style first argument (`-m`), which is exactly the "exited during startup" case.
 */

process.stdout.write('fake-engine: inert\n');
process.exit(3);
