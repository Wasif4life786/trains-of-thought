type Env = Record<string, string | undefined>;

// Works in Node and the browser (no process there): shared stays isomorphic.
const env = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};

/** True when code must not touch the network: TOT_OFFLINE=1, or under Vitest. Every live source must honour it. */
export function isOffline(): boolean {
  const e = env();
  return e.TOT_OFFLINE === "1" || Boolean(e.VITEST);
}
