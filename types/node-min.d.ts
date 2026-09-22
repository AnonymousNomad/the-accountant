/**
 * Minimal ambient declarations for the Node.js built-ins used by this repository.
 *
 * WHY THIS FILE EXISTS: this repository has zero dependencies and no install step, so it
 * cannot import `@types/node`. With `"types": []` in tsconfig.json, TypeScript would report
 * "cannot find module 'node:fs'" for every built-in import, which would make the type gate
 * useless. This shim declares exactly the built-ins and globals we use.
 *
 * HONEST LIMITATION: the Node API surfaces here are typed loosely (parameters are `any` in
 * several places). The gate therefore checks OUR modules' internal consistency and catches
 * misspelled Node function names, but it is weaker than `@types/node`. To get the stronger
 * gate, install TypeScript plus `@types/node` and remove `"types": []` from tsconfig.json.
 * Recorded in docs/matrices/DEPENDENCY_MATRIX.md (dev-only tool).
 */

declare module 'node:crypto' {
  export interface Hash {
    update(data: string | Uint8Array, inputEncoding?: string): Hash;
    digest(encoding: 'hex' | 'base64'): string;
  }
  export function createHash(algorithm: string): Hash;
  export function randomUUID(): string;
  export function randomBytes(size: number): { toString(encoding: 'hex'): string };
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding?: string): string;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function appendFileSync(path: string | number, data: string, encoding?: string): void;
  export function openSync(path: string, flags: string): number;
  export function closeSync(fd: number): void;
  export function fsyncSync(fd: number): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export function readdirSync(path: string, options?: { withFileTypes?: boolean }): any[];
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean; size: number; mtimeMs: number };
}

declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: string): Promise<string>;
  export function writeFile(path: string, data: string, encoding?: string): Promise<void>;
  export function appendFile(path: string, data: string, encoding?: string): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  export function readdir(path: string, options?: { withFileTypes?: boolean }): Promise<any[]>;
  export function stat(path: string): Promise<{ size: number }>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, ext?: string): string;
  export function extname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function relative(from: string, to: string): string;
  export const sep: string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;
}

declare module 'node:http' {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    on(event: string, listener: (...args: any[]) => void): void;
    [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array>;
  }
  export interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string | number | string[]): void;
    write(chunk: string | Uint8Array): boolean;
    end(chunk?: string | Uint8Array): void;
    writeHead(statusCode: number, headers?: Record<string, string>): void;
  }
  export interface Server {
    listen(port: number, host?: string, callback?: () => void): Server;
    listen(port: number, callback?: () => void): Server;
    address(): { port: number } | string | null;
    close(callback?: () => void): Server;
    closeAllConnections?: () => void;
    unref(): Server;
  }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server;
}

declare module 'node:readline/promises' {
  export interface Interface {
    question(query: string): Promise<string>;
    close(): void;
    [Symbol.asyncIterator](): AsyncIterableIterator<string>;
  }
  export function createInterface(options: { input: any; output: any; terminal?: boolean }): Interface;
}

declare module 'node:os' {
  export function tmpdir(): string;
  export function platform(): string;
  export function cpus(): Array<{ model: string }>;
}

declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args?: string[],
    options?: {
      cwd?: string;
      encoding?: string;
      timeout?: number;
      env?: Record<string, string | undefined>;
      shell?: boolean;
      stdio?: any;
    }
  ): { status: number | null; stdout: string; stderr: string; error?: Error; pid?: number };

  export interface ChildProcess {
    pid?: number;
    exitCode: number | null;
    killed: boolean;
    killedByUs?: boolean;
    kill(signal?: string): boolean;
    on(event: string, listener: (...args: any[]) => void): ChildProcess;
    once(event: string, listener: (...args: any[]) => void): ChildProcess;
    removeAllListeners(event?: string): ChildProcess;
    unref(): void;
    stderr?: any;
    stdout?: any;
  }

  export function spawn(
    command: string,
    args?: string[],
    options?: { cwd?: string; env?: Record<string, string | undefined>; stdio?: any; windowsHide?: boolean; detached?: boolean }
  ): ChildProcess;
}

declare module 'node:test' {
  interface TestFn {
    (name: string, fn: () => void | Promise<void>): Promise<void>;
    (name: string, options: { timeout?: number }, fn: () => void | Promise<void>): Promise<void>;
  }
  const test: TestFn;
  export default test;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
}

declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    match(value: string, pattern: RegExp, message?: string): void;
    doesNotMatch(value: string, pattern: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: unknown, message?: string): void;
    doesNotThrow(fn: () => unknown, message?: string): void;
    rejects(fn: () => Promise<unknown>, expected?: unknown, message?: string): Promise<void>;
    fail(message?: string): never;
  }
  const assert: Assert;
  export default assert;
}

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode: number;
  exit(code?: number): never;
  cwd(): string;
  pid: number;
  platform: string;
  arch: string;
  version: string;
  execPath: string;
  stdin: any;
  stdout: { write(chunk: string): boolean; isTTY?: boolean };
  stderr: { write(chunk: string): boolean; isTTY?: boolean };
  on(event: string, listener: (...args: any[]) => void): void;
};

declare const console: {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
};

declare function fetch(url: string, init?: any): Promise<any>;
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): any;
declare function clearTimeout(handle: any): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): any;
declare function clearInterval(handle: any): void;

declare class URLSearchParams {
  set(name: string, value: string): void;
  get(name: string): string | null;
  toString(): string;
}

declare class URL {
  constructor(input: string | URL, base?: string | URL);
  protocol: string;
  hostname: string;
  host: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  href: string;
  origin: string;
  searchParams: URLSearchParams;
  toString(): string;
  static canParse(input: string, base?: string): boolean;
}

declare class Response {
  ok: boolean;
  status: number;
  headers: any;
  text(): Promise<string>;
  json(): Promise<any>;
}

declare class AbortController {
  signal: any;
  abort(): void;
}

declare interface ImportMeta {
  url: string;
}

declare function structuredClone<T>(value: T): T;
