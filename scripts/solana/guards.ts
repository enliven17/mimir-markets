/**
 * Mainnet guards for the operator scripts (audit P0-1 / P0-7). The pure
 * `*Problem` functions take the cluster and argv as arguments so every branch
 * is unit-tested; the `require*` wrappers print the cluster and exit.
 *
 *   - devnet tooling that moves funds or state (smoke, demo, migration,
 *     funding): refused on mainnet unless `--mainnet` is passed;
 *   - admin.ts / initialize.ts: allowed on mainnet, but every write needs
 *     `--yes`;
 *   - initialize.ts on mainnet: the oracle and the fee recipient must be set
 *     explicitly and differ from the admin key.
 */
import { IS_MAINNET, SOLANA_CLUSTER } from "../../lib/solana/config";

export interface GuardOpts {
  mainnet: boolean;
  argv: readonly string[];
}

export function devnetOnlyProblem(script: string, opts: GuardOpts): string | null {
  if (!opts.mainnet || opts.argv.includes("--mainnet")) return null;
  return `${script} writes state and moves funds; it refuses to run on mainnet-beta without --mainnet`;
}

export function mainnetConfirmProblem(script: string, opts: GuardOpts): string | null {
  if (!opts.mainnet || opts.argv.includes("--yes")) return null;
  return `${script} is about to write to MAINNET-BETA; re-run with --yes to confirm`;
}

/** initialize.ts on mainnet: oracle and fee recipient explicit, and neither is the admin. */
export function initKeysProblem(opts: {
  mainnet: boolean;
  admin: string;
  oracle: string | undefined;
  feeRecipient: string | undefined;
}): string | null {
  if (!opts.mainnet) return null;
  const oracle = opts.oracle?.trim();
  const fee = opts.feeRecipient?.trim();
  if (!oracle) return "MIMIR_ORACLE must be set on mainnet (a separate oracle key, not the admin)";
  if (!fee) return "MIMIR_FEE_RECIPIENT must be set on mainnet (a cold address, not the admin)";
  if (oracle === opts.admin) return "MIMIR_ORACLE must differ from the admin key on mainnet";
  if (fee === opts.admin) return "MIMIR_FEE_RECIPIENT must differ from the admin key on mainnet";
  return null;
}

/** Positional arguments only (flags like --yes / --mainnet removed). */
export function positional(args: readonly string[]): string[] {
  return args.filter((a) => !a.startsWith("--"));
}

function exitOn(problem: string | null): void {
  if (!problem) return;
  console.error(`✗ ${problem}`);
  process.exit(1);
}

export function requireDevnetOrFlag(script: string, argv: readonly string[] = process.argv): void {
  console.log(`cluster: ${SOLANA_CLUSTER}`);
  exitOn(devnetOnlyProblem(script, { mainnet: IS_MAINNET, argv }));
}

export function requireMainnetConfirm(script: string, argv: readonly string[] = process.argv): void {
  console.log(`cluster: ${SOLANA_CLUSTER}`);
  exitOn(mainnetConfirmProblem(script, { mainnet: IS_MAINNET, argv }));
}

export function requireInitKeys(admin: string, env: NodeJS.ProcessEnv = process.env): void {
  exitOn(initKeysProblem({ mainnet: IS_MAINNET, admin, oracle: env.MIMIR_ORACLE, feeRecipient: env.MIMIR_FEE_RECIPIENT }));
}
