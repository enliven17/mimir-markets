/** Base counterpart of scripts/arc/create-safe.mjs. --check-only never signs or broadcasts. */
import { readFileSync } from "node:fs";
import { concat, createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, getAddress, getCreate2Address, http, keccak256, parseAbi, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const e = process.env;
if (!["mainnet", "sepolia", "testnet"].includes(e.BASE_NETWORK ?? "sepolia")) throw new Error("Invalid BASE_NETWORK");
const chain = e.BASE_NETWORK === "mainnet" ? base : baseSepolia;
const checkOnly = process.argv.includes("--check-only");
if (chain.id === 8453 && !checkOnly && e.BASE_CONFIRM_MAINNET !== "1") throw new Error("Set BASE_CONFIRM_MAINNET=1 to deploy the mainnet Safe");
const client = createPublicClient({ chain, transport: http(e.BASE_RPC_URL || chain.rpcUrls.default.http[0], { timeout: 15_000, retryCount: 1 }) });
if (await client.getChainId() !== chain.id) throw new Error("Wrong RPC chain");
const owners = (e.SAFE_OWNERS ?? "").split(",").filter(Boolean).map((a) => getAddress(a.trim()));
const threshold = BigInt(e.SAFE_THRESHOLD ?? "2");
if (owners.length !== 3 || new Set(owners).size !== 3 || threshold !== 2n || owners.includes(zeroAddress)) throw new Error("Use three distinct nonzero owners and SAFE_THRESHOLD=2, as on Arc");
const singleton = getAddress("0x29fcB43b46531BcA003ddC8FCB67FFE91900C762");
const factory = getAddress("0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67");
const fallback = getAddress("0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99");
for (const a of [singleton, factory, fallback]) if (!await client.getCode({ address: a })) throw new Error("Canonical Safe 1.4.1 contracts missing");
const abi = parseAbi([
  "function setup(address[] owners,uint256 threshold,address to,bytes data,address handler,address paymentToken,uint256 payment,address paymentReceiver)",
  "function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)",
  "function proxyCreationCode() view returns (bytes)",
  "function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address)",
]);
const initializer = encodeFunctionData({ abi, functionName: "setup", args: [owners, threshold, zeroAddress, "0x", fallback, zeroAddress, 0n, zeroAddress] });
const saltNonce = BigInt(e.SAFE_SALT ?? "0");
const creationCode = await client.readContract({ address: factory, abi, functionName: "proxyCreationCode" });
const salt = keccak256(concat([keccak256(initializer), encodeAbiParameters([{ type: "uint256" }], [saltNonce])]));
const safe = getCreate2Address({ from: factory, salt, bytecode: concat([creationCode, encodeAbiParameters([{ type: "address" }], [singleton])]) });
let deployed = Boolean(await client.getCode({ address: safe }));
console.log(JSON.stringify({ chainId: chain.id, safe, owners, threshold: Number(threshold), deployed, checkOnly }));
if (checkOnly) process.exit(0);
if (!deployed) {
  const key = (e.BASE_DEPLOYER_KEY_FILE ? readFileSync(e.BASE_DEPLOYER_KEY_FILE, "utf8") : e.BASE_DEPLOYER_KEY ?? "").trim() as Hex;
  const wallet = createWalletClient({ chain, transport: http(e.BASE_RPC_URL || chain.rpcUrls.default.http[0]), account: privateKeyToAccount(key) });
  if (owners.includes(wallet.account.address)) throw new Error("Deployer must keep no Safe role");
  const args = [singleton, initializer, saltNonce] as const;
  await client.simulateContract({ address: factory, abi, functionName: "createProxyWithNonce", args, account: wallet.account });
  const hash = await wallet.writeContract({ address: factory, abi, functionName: "createProxyWithNonce", args });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Safe creation reverted");
  console.log(`Created Safe ${safe}: ${hash}`);
  deployed = true;
}
const [actualOwners, actualThreshold] = await Promise.all([
  client.readContract({ address: safe, abi, functionName: "getOwners" }),
  client.readContract({ address: safe, abi, functionName: "getThreshold" }),
]);
if (actualThreshold !== threshold || actualOwners.length !== owners.length || owners.some((a) => !actualOwners.includes(a))) throw new Error("Safe owners/threshold mismatch");
console.log("Safe owners and threshold verified");
