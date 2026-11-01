/** Read-only launch gate. node --env-file=<reviewed mainnet env> --import tsx scripts/base/preflight-mainnet.mts */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createPublicClient, encodeFunctionData, getAddress, http, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { BASE_USDC, serverMarketChains } from "../../lib/chains/registry";

const e = process.env;
const failures: string[] = [];
const registry = serverMarketChains(e);
const cfg = registry.chains.base;
const need = (ok: unknown, message: string) => { if (!ok) failures.push(message); };
// Fixed command, no interpolated input. npm.cmd needs a shell on Windows.
const audit = spawnSync("npm audit --omit=dev --json", { shell: true, encoding: "utf8", timeout: 60_000 });
try {
  const counts = JSON.parse(audit.stdout).metadata.vulnerabilities;
  need(counts.critical === 0 && counts.high === 0, `Production dependency audit still reports ${counts.high} high / ${counts.critical} critical findings`);
} catch { failures.push("Could not verify the production dependency audit"); }
need(e.BASE_NETWORK === "mainnet", "BASE_NETWORK must be mainnet");
need(cfg.usdc.address.toLowerCase() === BASE_USDC.mainnet.toLowerCase(), "Canonical Base mainnet USDC required");
need((e.MARKET_CHAINS ?? "base") === "base", "Keep Arc dormant for the Base launch");
need(e.NEXT_PUBLIC_BASE_NETWORK === "mainnet", "Frontend network must be mainnet too");
need(e.NEXT_PUBLIC_CONVEX_URL === "https://groovy-marmot-393.convex.cloud", "Use the isolated Base mainnet Convex deployment");
need(e.CONVEX_DEPLOYMENT?.endsWith("groovy-marmot-393") || e.CONVEX_DEPLOYMENT?.endsWith(":base-mainnet"), "Explicit Base mainnet Convex target required");
need(e.CIRCLE_API_KEY?.startsWith("LIVE_API_KEY:"), "Circle LIVE credentials required");
need(e.ORACLE_GEMINI_API_KEY || e.ORACLE_ANTHROPIC_API_KEY, "Dedicated oracle LLM credentials required");
need(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_ADMIN_IDS, "Configure the existing watchdog's admin alert channel before launch");
need(e.COUNCIL_BETS === "0", "Council bets must remain off during launch");
need(e.MIMIR_PAUSE_CREATE_MARKET === "1", "House creator stays off until funded wallets and budgets are reviewed");
need(BigInt(e.BASE_DISPUTE_WINDOW ?? "0") >= 86400n, "Dispute window must be at least 24 hours");
need(e.BASE_RPC_URL && !/mainnet\.base\.org/.test(e.BASE_RPC_URL), "Configure a dedicated production RPC");
const client = createPublicClient({ chain: base, transport: http(e.BASE_RPC_URL || base.rpcUrls.default.http[0], { timeout: 10_000, retryCount: 0 }) });
const roles = ["BASE_OWNER", "BASE_ARBITER", "BASE_FEE_RECIPIENT", "ORACLE_ADDRESS", "BASE_FEE_SIGNER"] as const;
const addresses: Partial<Record<typeof roles[number], Address>> = {};
for (const name of roles) {
  try { addresses[name] = getAddress(e[name] ?? ""); } catch { failures.push(`${name} is missing or invalid`); }
}
try {
  need(await client.getChainId() === 8453, "RPC chain must be 8453");
  const abi = parseAbi(["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"]);
  const expected = (e.SAFE_OWNERS ?? "").split(",").filter(Boolean).map((s) => getAddress(s.trim()));
  need(expected.length === 3 && new Set(expected).size === 3, "Review the three Safe owners");
  for (const name of ["BASE_OWNER", "BASE_ARBITER"] as const) {
    const address = addresses[name];
    if (!address) continue;
    if (!await client.getCode({ address })) { failures.push(`${name} Safe is not deployed on Base`); continue; }
    const [owners, threshold] = await Promise.all([client.readContract({ address, abi, functionName: "getOwners" }), client.readContract({ address, abi, functionName: "getThreshold" })]);
    need(threshold === 2n && owners.length === 3 && expected.every((a) => owners.includes(a)), `${name} must match the reviewed 2/3 Safe`);
  }
  const key = e.BASE_DEPLOYER_KEY_FILE ? readFileSync(e.BASE_DEPLOYER_KEY_FILE, "utf8").trim() : null;
  if (key) {
    const deployer = privateKeyToAccount(key as Hex).address;
    need(!Object.values(addresses).includes(deployer), "Deployer must keep no role");
    need((await client.getBalance({ address: deployer })) >= parseUnits("0.001", 18), "Deployer needs at least 0.001 Base ETH; estimate gas again before sending");
  } else failures.push("Configure the local deployer key file");
  const oracle = addresses.ORACLE_ADDRESS;
  if (oracle) {
    need(![addresses.BASE_OWNER, addresses.BASE_ARBITER, addresses.BASE_FEE_RECIPIENT, addresses.BASE_FEE_SIGNER].includes(oracle), "Oracle must be separate from Safe/treasury/signer");
    need((await client.getBalance({ address: oracle })) > 0n, "Fund oracle with Base ETH");
  }
  need(addresses.BASE_FEE_SIGNER !== addresses.BASE_OWNER && addresses.BASE_FEE_SIGNER !== addresses.BASE_ARBITER, "Fee signer must be separate from Safe");
  need(cfg.enabled && cfg.contracts.mimirFees, "Fresh mainnet market contracts are not configured");
  const views = parseAbi(["function usdc() view returns (address)", "function owner() view returns (address)", "function arbiter() view returns (address)", "function oracle() view returns (address)", "function feeRecipient() view returns (address)", "function fees() view returns (address)", "function signer() view returns (address)", "function disputeWindow() view returns (uint256)", "function MIN_STAKE() view returns (uint256)", "function maxMarketStake() view returns (uint256)", "function maxAccountStake() view returns (uint256)", "function paused() view returns (bool)"]);
  const proposals = [];
  const marketCap = parseUnits(e.BASE_MAX_MARKET_USDC ?? "500", 6), accountCap = parseUnits(e.BASE_MAX_ACCOUNT_USDC ?? "50", 6);
  need(accountCap > 0n && marketCap >= accountCap, "Launch caps must be finite and consistent");
  for (const address of [cfg.contracts.mimirV3, cfg.contracts.mimirPool]) {
    if (!address) continue;
    const read = (functionName: "usdc" | "owner" | "arbiter" | "oracle" | "feeRecipient" | "fees" | "disputeWindow" | "MIN_STAKE" | "maxMarketStake" | "maxAccountStake" | "paused") => client.readContract({ address, abi: views, functionName });
    for (const [fn, expected] of [["owner", addresses.BASE_OWNER], ["arbiter", addresses.BASE_ARBITER], ["oracle", oracle], ["feeRecipient", addresses.BASE_FEE_RECIPIENT], ["fees", cfg.contracts.mimirFees], ["usdc", cfg.usdc.address]] as const) need(String(await read(fn)).toLowerCase() === expected?.toLowerCase(), `${fn} mismatch at ${address}`);
    need(await read("disputeWindow") === BigInt(e.BASE_DISPUTE_WINDOW ?? "86400"), `Dispute window mismatch at ${address}`);
    need(await read("MIN_STAKE") === cfg.contracts.minStakeWei / 10n ** 12n, `Minimum stake mismatch at ${address}`);
    need(await read("maxMarketStake") === marketCap && await read("maxAccountStake") === accountCap, `Execute reviewed Safe caps at ${address}`);
    need(await read("paused") === false, `${address} is paused`);
    proposals.push({ to: address, value: "0", data: encodeFunctionData({ abi: parseAbi(["function setCaps(uint256 market,uint256 account)"]), functionName: "setCaps", args: [marketCap, accountCap] }) });
  }
  if (cfg.contracts.mimirFees) {
    need(await client.readContract({ address: cfg.contracts.mimirFees, abi: views, functionName: "owner" }) === addresses.BASE_OWNER, "Fees owner mismatch");
    need(await client.readContract({ address: cfg.contracts.mimirFees, abi: views, functionName: "signer" }) === addresses.BASE_FEE_SIGNER, "Fees signer mismatch");
  }
  console.log(JSON.stringify({ chainId: 8453, launchCapsSafeProposals: proposals }, null, 2));
} catch { failures.push("RPC/on-chain verification failed; review configuration and retry"); }
console.log(JSON.stringify({ ready: failures.length === 0, blockers: failures, broadcast: false }, null, 2));
process.exitCode = failures.length ? 1 : 0;
