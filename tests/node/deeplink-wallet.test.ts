import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { DeeplinkWalletAdapter } from "../../lib/solana/deeplink-adapter";
import { decryptPayload, encryptPayload, sharedSecret, walletError, walletKeyParam, type DeeplinkWallet } from "../../lib/solana/deeplink-protocol";
import { isUserRejection } from "../../lib/solana/wallet-events";
import { MAX_PARAMS_BYTES, TTL_MS, pickParams, putRelay, takeRelay } from "../../lib/server/wallet-relay";

const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

/**
 * A wallet app, simulated: it reads the deeplink our adapter opens, answers the way Phantom does (approve, or
 * reject with `reject`), and "opens the redirect link", which here parks the answer in a relay map that the
 * adapter's fetch reads. `user` is the wallet's account key.
 */
function fakeWallet(wallet: DeeplinkWallet, opts: { reject?: boolean } = {}) {
  const enc = nacl.box.keyPair();
  const user = Keypair.generate();
  const relay = new Map<string, Record<string, string>>();
  const opened: string[] = [];
  let shared: Uint8Array | null = null;
  const session = "session-token";

  const open = (url: string) => {
    opened.push(url);
    const u = new URL(url);
    const q = u.searchParams;
    const op = new URL(q.get("redirect_link")!).searchParams.get("op")!;
    const method = u.pathname.split("/").pop();
    if (opts.reject) return void relay.set(op, { errorCode: "4001", errorMessage: "User rejected the request." });
    if (method === "connect") {
      shared = nacl.box.before(bs58.decode(q.get("dapp_encryption_public_key")!), enc.secretKey);
      const { nonce, payload } = encryptPayload({ public_key: user.publicKey.toBase58(), session }, shared);
      return void relay.set(op, { [walletKeyParam(wallet)]: bs58.encode(enc.publicKey), nonce, data: payload });
    }
    const req = decryptPayload<Record<string, unknown>>(q.get("payload")!, q.get("nonce")!, shared!);
    assert.equal(req.session, session, "every request carries the session");
    let answer: unknown;
    if (method === "signMessage") answer = { signature: bs58.encode(nacl.sign.detached(bs58.decode(req.message as string), user.secretKey)) };
    if (method === "signTransaction") {
      const tx = Transaction.from(bs58.decode(req.transaction as string));
      tx.partialSign(user);
      answer = { transaction: bs58.encode(tx.serialize({ requireAllSignatures: false })) };
    }
    if (method === "signAllTransactions") {
      answer = {
        transactions: (req.transactions as string[]).map((t) => {
          const tx = Transaction.from(bs58.decode(t));
          tx.partialSign(user);
          return bs58.encode(tx.serialize({ requireAllSignatures: false }));
        }),
      };
    }
    const { nonce, payload } = encryptPayload(answer, shared!);
    relay.set(op, { nonce, data: payload });
  };

  const fetchImpl = (async (url: string) => {
    const op = new URL(url).searchParams.get("op")!;
    const params = relay.get(op);
    relay.delete(op);
    return params ? new Response(JSON.stringify({ params }), { status: 200 }) : new Response(null, { status: 204 });
  }) as unknown as typeof fetch;

  return { user, open, fetchImpl, opened };
}

function adapterFor(wallet: DeeplinkWallet, w: ReturnType<typeof fakeWallet>, storage = memStore()) {
  return new DeeplinkWalletAdapter({
    wallet,
    name: wallet,
    icon: "",
    url: "",
    cluster: "devnet",
    origin: "https://mimirmarkets.xyz",
    open: w.open,
    fetchImpl: w.fetchImpl,
    storage,
    pendingStorage: memStore(),
    pollMs: 2,
    waitMs: 2000,
  });
}

const transfer = (from: PublicKey) => {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  tx.recentBlockhash = bs58.encode(nacl.randomBytes(32));
  tx.feePayer = from;
  return tx;
};

test("protocol: a nacl box under the shared secret opens on the other side", () => {
  const dapp = nacl.box.keyPair();
  const wallet = nacl.box.keyPair();
  const a = sharedSecret(bs58.encode(wallet.publicKey), dapp.secretKey);
  const b = nacl.box.before(dapp.publicKey, wallet.secretKey);
  const { nonce, payload } = encryptPayload({ hello: "mimir" }, a);
  assert.deepEqual(decryptPayload(payload, nonce, b), { hello: "mimir" });
  assert.throws(() => decryptPayload(payload, nonce, nacl.randomBytes(32)), /could not be decrypted/);
});

for (const wallet of ["phantom", "solflare"] as const) {
  test(`${wallet}: connect, signMessage, signTransaction and signAllTransactions round trip through the relay`, async () => {
    const w = fakeWallet(wallet);
    const storage = memStore();
    const adapter = adapterFor(wallet, w, storage);
    await adapter.connect();
    assert.equal(adapter.publicKey?.toBase58(), w.user.publicKey.toBase58());
    const connect = new URL(w.opened[0]);
    assert.equal(connect.origin + connect.pathname, wallet === "phantom" ? "https://phantom.app/ul/v1/connect" : "https://solflare.com/ul/v1/connect");
    assert.equal(connect.searchParams.get("cluster"), "devnet");
    assert.match(connect.searchParams.get("redirect_link")!, /^https:\/\/mimirmarkets\.xyz\/api\/wallet-return\?op=[A-Za-z0-9_-]{22}$/);

    const message = new TextEncoder().encode("Mimir holder proof");
    const sig = await adapter.signMessage(message);
    assert.ok(nacl.sign.detached.verify(message, sig, w.user.publicKey.toBytes()));

    const signed = await adapter.signTransaction(transfer(w.user.publicKey));
    assert.ok(signed.verifySignatures(), "the wallet's signature is on the transaction");

    const all = await adapter.signAllTransactions([transfer(w.user.publicKey), transfer(w.user.publicKey)]);
    assert.equal(all.length, 2);
    assert.ok(all.every((t) => t.verifySignatures()));

    // A reload: a fresh adapter on the same storage reconnects without opening the wallet.
    const opens = w.opened.length;
    const again = adapterFor(wallet, w, storage);
    await again.autoConnect();
    assert.equal(again.publicKey?.toBase58(), w.user.publicKey.toBase58());
    assert.equal(w.opened.length, opens);

    await again.disconnect();
    const after = adapterFor(wallet, w, storage);
    await after.autoConnect();
    assert.equal(after.publicKey, null, "disconnect forgets the session");
    assert.equal(w.opened.length, opens, "autoConnect never opens the wallet");
  });
}

test("a rejection in the wallet is a user rejection to the UI", async () => {
  const adapter = adapterFor("phantom", fakeWallet("phantom", { reject: true }));
  const errors: unknown[] = [];
  adapter.on("error", (e) => errors.push(e));
  await assert.rejects(adapter.connect(), (e) => isUserRejection(e));
  assert.equal(errors.length, 1);
  assert.deepEqual(walletError({ errorCode: "-32603", errorMessage: "Internal" }), { code: -32603, message: "Internal" });
  assert.equal(walletError({}), null);
});

test("a wallet that never answers times out", async () => {
  const w = fakeWallet("phantom");
  const adapter = new DeeplinkWalletAdapter({
    wallet: "phantom", name: "p", icon: "", url: "", cluster: "devnet", origin: "https://x.test",
    open: () => undefined, fetchImpl: w.fetchImpl, storage: memStore(), pendingStorage: memStore(), pollMs: 2, waitMs: 30,
  });
  adapter.on("error", () => undefined);
  await assert.rejects(adapter.connect(), /did not answer/);
});

test("relay: first write wins, one read, expiry, size cap, op format", async () => {
  const op = "AAAAAAAAAAAAAAAAAAAAAA";
  const t0 = 1_000_000;
  assert.equal(await putRelay(op, { nonce: "n", data: "d" }, t0), true);
  assert.equal(await putRelay(op, { nonce: "x", data: "y" }, t0), false, "a second answer cannot overwrite the first");
  assert.deepEqual(await takeRelay(op, t0), { nonce: "n", data: "d" });
  assert.equal(await takeRelay(op, t0), null, "read once");

  const old = "BBBBBBBBBBBBBBBBBBBBBB";
  await putRelay(old, { nonce: "n" }, t0);
  assert.equal(await takeRelay(old, t0 + TTL_MS + 1), null, "expired answers are never returned");

  assert.equal(await putRelay("short", { nonce: "n" }, t0), false);
  assert.equal(await putRelay("CCCCCCCCCCCCCCCCCCCCCC", { data: "x".repeat(MAX_PARAMS_BYTES) }, t0), false);

  const picked = pickParams(new URLSearchParams("op=AAAAAAAAAAAAAAAAAAAAAA&nonce=n&data=d&evil=1"));
  assert.deepEqual(picked, { nonce: "n", data: "d" }, "only the wallet's own fields are kept");
  assert.equal(pickParams(new URLSearchParams("op=x")), null);
});
