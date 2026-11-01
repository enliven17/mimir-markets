/** Base Sepolia only: real USDC approve/permit, pool settlement/payout, and VS create/cancel.
 * Run after deploy-markets.mts with BASE_DEPLOYER_KEY_FILE, ORACLE_KEY, and MIMIR_BASE_* env.
 * Uses 2 test USDC and funds an isolated participant and the oracle with 0.0001 test ETH each.
 * The generated participant key and the transaction report stay under ignored .temp/.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, parseEther, zeroAddress, keccak256, toHex, parseEventLogs, parseSignature, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const e = process.env;
if (e.BASE_NETWORK !== "testnet" && e.BASE_NETWORK !== "sepolia") throw new Error("This smoke test requires BASE_NETWORK=testnet or sepolia");
const transport = http(e.BASE_RPC || "https://sepolia.base.org", { timeout: 20_000 });
const pub = createPublicClient({ chain: baseSepolia, transport });
assert.equal(await pub.getChainId(), 84532);
const owner = privateKeyToAccount(readFileSync(e.BASE_DEPLOYER_KEY_FILE!, "utf8").trim() as Hex);
const oracle = privateKeyToAccount(e.ORACLE_KEY as Hex);
mkdirSync(".temp", { recursive: true });
const participantFile = ".temp/base-smoke-participant.key";
if (!existsSync(participantFile)) writeFileSync(participantFile, generatePrivateKey(), { mode: 0o600 });
const participant = privateKeyToAccount(readFileSync(participantFile, "utf8").trim() as Hex);
const wallet = (account: typeof owner) => createWalletClient({ account, chain: baseSepolia, transport });
const ownerWallet = wallet(owner), participantWallet = wallet(participant), oracleWallet = wallet(oracle);
const usdc = (e.MIMIR_BASE_USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;
const pool = e.MIMIR_BASE_POOL_ADDRESS as Address, vs = e.MIMIR_BASE_V3_ADDRESS as Address;
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)", "function nonces(address) view returns (uint256)", "function name() view returns (string)", "function version() view returns (string)"]);
const artifact = (name: string) => JSON.parse(readFileSync(`forge-out/${name}.sol/${name}.json`, "utf8")).abi;
const poolAbi = artifact("MimirPoolErc20"), vsAbi = artifact("MimirV3Erc20");
const transactions: Record<string, string> = {};
const save = () => writeFileSync(".temp/base-smoke.json", JSON.stringify({ chainId: 84532, pool, vs, owner: owner.address, participant: participant.address, oracle: oracle.address, transactions }, null, 2));
async function confirmed(label: string, hash: Hex) {
  const receipt = await pub.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", label);
  transactions[label] = hash; save(); console.log(`${label}: ${hash}`);
  return receipt;
}
async function write(label: string, w: typeof ownerWallet, address: Address, abi: any, functionName: string, args: any[] = []) {
  const { request } = await pub.simulateContract({ account: w.account, address, abi, functionName, args });
  return confirmed(label, await w.writeContract(request as any));
}
const balance = (address: Address) => pub.readContract({ address: usdc, abi: tokenAbi, functionName: "balanceOf", args: [address] });
assert.ok(await balance(owner.address) >= 2_100_000n, "Deployer needs at least 2.1 test USDC");
for (const account of [participant, oracle]) {
  if (await pub.getBalance({ address: account.address }) < parseEther("0.00005")) await confirmed(`fund gas ${account.address}`, await ownerWallet.sendTransaction({ to: account.address, value: parseEther("0.0001") }));
}
await write("fund participant USDC", ownerWallet, usdc, tokenAbi, "transfer", [participant.address, 1_000_000n]);
await write("approve pool", ownerWallet, usdc, tokenAbi, "approve", [pool, 1_000_000n]);
const block = await pub.getBlock();
const deadline = block.timestamp + 150n;
const created = await write("create pool", ownerWallet, pool, poolAbi, "createMarket", ["Base Sepolia integration test: side A wins", "Yes", "No", "https://mimirmarkets.xyz", "custom", deadline, 1, zeroAddress, 1_000_000n]);
const event = parseEventLogs({ abi: poolAbi, logs: created.logs, eventName: "MarketCreated" })[0] as any;
const poolId = event.args.id as bigint;
const nonce = await pub.readContract({ address: usdc, abi: tokenAbi, functionName: "nonces", args: [participant.address] });
const [name, version] = await Promise.all([pub.readContract({address:usdc,abi:tokenAbi,functionName:"name"}),pub.readContract({address:usdc,abi:tokenAbi,functionName:"version"})]);
const permitDeadline = deadline + 300n;
const sig = parseSignature(await participant.signTypedData({ domain: { name, version, chainId: 84532, verifyingContract: usdc }, types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, primaryType: "Permit", message: { owner: participant.address, spender: pool, value: 1_000_000n, nonce, deadline: permitDeadline } }));
await write("stake with USDC permit", participantWallet, pool, poolAbi, "stakeWithPermit", [poolId, 2, zeroAddress, 1_000_000n, permitDeadline, Number(sig.v), sig.r, sig.s]);
assert.equal(await pub.readContract({address:usdc,abi:tokenAbi,functionName:"nonces",args:[participant.address]}),nonce+1n);
await write("approve VS", ownerWallet, usdc, tokenAbi, "approve", [vs, 100_000n]);
const duel = await write("create VS", ownerWallet, vs, vsAbi, "createClaim", ["Base Sepolia integration test: cancel this duel", "Yes", "No", "https://mimirmarkets.xyz", deadline + 600n, 100_000n, "custom", 0n, "binary", "pool", 0n, "", "", 0n, false, "", zeroAddress]);
const duelEvent = parseEventLogs({abi:vsAbi,logs:duel.logs,eventName:"ClaimCreated"})[0] as any;
await write("cancel VS and refund", ownerWallet, vs, vsAbi, "cancelClaim", [duelEvent.args.id]);
await assert.rejects(pub.simulateContract({account:participant,address:pool,abi:poolAbi,functionName:"resolve",args:[poolId,1,"Unauthorized",keccak256(toHex("invalid"))]}));
console.log(`Pool ${poolId}: waiting until deadline ${deadline} for settlement`);
while ((await pub.getBlock()).timestamp <= deadline) await new Promise((r) => setTimeout(r, 5000));
const proposed = await write("oracle proposes", oracleWallet, pool, poolAbi, "resolve", [poolId, 1, "Base Sepolia integration test passed", keccak256(toHex("Base Sepolia smoke test"))]);
const proposedBlock = await pub.getBlock({blockNumber:proposed.blockNumber});
const disputeWindow = await pub.readContract({address:pool,abi:poolAbi,functionName:"disputeWindow"}) as bigint;
assert.ok(disputeWindow <= 300n, "Smoke test only waits up to five minutes for a testnet dispute window");
while ((await pub.getBlock()).timestamp <= proposedBlock.timestamp + disputeWindow) await new Promise((r) => setTimeout(r, 5000));
await write("finalize pool", ownerWallet, pool, poolAbi, "finalize", [poolId]);
const before = await balance(owner.address);
await write("claim winning USDC", ownerWallet, pool, poolAbi, "claim", [poolId]);
assert.ok(await balance(owner.address) > before + 1_000_000n, "Winner must receive the pooled USDC");
console.log(`PASS: pool ${poolId}, VS ${duelEvent.args.id}; report .temp/base-smoke.json`);
