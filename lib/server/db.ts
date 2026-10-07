/**
 * Postgres is retired. The app's records live in the backend (lib/server/store.ts, convex/appStore.ts).
 *
 * What still imports this is Solana-era code: the read index of the old program, its oracle's verdict bundles and
 * forecasts, challenge opportunities, notifications and the paid terminal's charges, plus the Solana workers in
 * agents/. Every one of them already ran without a database (`isDbEnabled()` false: empty lists, 503s, skipped
 * work), which is how they behave now. The Solana version, database included, lives on the `magicblock-er` branch.
 */

export function isDbEnabled(): boolean {
  return false;
}

const retired = (): never => {
  throw new Error("Postgres is retired: this Solana-era feature has no database (see the magicblock-er branch)");
};

/** Never resolves to a pool: callers check isDbEnabled() first, or catch. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the retired callers' pg types, kept loose
export async function getDb(): Promise<any> {
  return retired();
}

export async function query<T = Record<string, unknown>>(_sql: string, _args: readonly unknown[] = []): Promise<T[]> {
  return retired();
}

export async function getMeta(_key: string): Promise<string | null> {
  return null;
}

export async function setMeta(_key: string, _value: string, _now = Date.now()): Promise<void> {}
