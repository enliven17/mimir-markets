/**
 * Phantom and Solflare on a phone without leaving Mimir: a wallet adapter over their deeplink protocol
 * (lib/solana/deeplink-protocol.ts), registered on phones only (lib/solana/wallet-providers.tsx).
 *
 * A request opens the wallet app; the wallet answers by opening `redirect_link`, which is our
 * /api/wallet-return?op=… In the Android app that link is caught by the app, which forwards it to the server and
 * closes, so this page is back on screen with its request still pending; in a phone browser the wallet opens it in
 * a new tab that forwards it. Either way the server parks the answer (lib/server/wallet-relay.ts) and this page
 * collects it by polling /api/wallet-relay while visible, then decrypts it here. No page reload, no wallet browser.
 *
 * The session (public key, session token, shared secret) is kept in localStorage, so a reload or autoConnect is
 * silent. A connect that was in flight when the page reloaded resumes from sessionStorage.
 */
import {
  BaseMessageSignerWalletAdapter,
  WalletConnectionError,
  WalletDisconnectionError,
  WalletNotConnectedError,
  WalletReadyState,
  WalletSignMessageError,
  WalletSignTransactionError,
  type TransactionOrVersionedTransaction,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { PublicKey, Transaction, VersionedTransaction, type TransactionVersion } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import {
  connectUrl,
  decryptPayload,
  methodUrl,
  newOp,
  sharedSecret,
  walletError,
  walletKeyParam,
  type DeeplinkCluster,
  type DeeplinkMethod,
  type DeeplinkWallet,
} from "./deeplink-protocol";

/** How long a request waits for the wallet before giving up (the relay keeps an answer as long). */
export const WAIT_MS = 10 * 60_000;
const POLL_MS = 1000;

interface Session {
  publicKey: string;
  session: string;
  /** The shared secret, base58. */
  shared: string;
  /** Our encryption public key for this session, base58 (every request names it). */
  dappPublicKey: string;
}

interface PendingConnect {
  op: string;
  secretKey: string;
  at: number;
}

type Params = Record<string, string | undefined>;

export interface DeeplinkAdapterOptions {
  wallet: DeeplinkWallet;
  name: string;
  icon: string;
  url: string;
  cluster: DeeplinkCluster;
  /** Injectable for tests; default window.location.origin, fetch, location.assign, localStorage, sessionStorage. */
  origin?: string;
  fetchImpl?: typeof fetch;
  open?: (url: string) => void;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  pendingStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  pollMs?: number;
  waitMs?: number;
}

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

const serialize = (tx: TransactionOrVersionedTransaction<ReadonlySet<TransactionVersion>>) =>
  tx instanceof Transaction ? tx.serialize({ requireAllSignatures: false, verifySignatures: false }) : tx.serialize();

/** The signed bytes back into the caller's kind of transaction. */
function revive<T extends TransactionOrVersionedTransaction<ReadonlySet<TransactionVersion>>>(like: T, b58: string): T {
  const bytes = bs58.decode(b58);
  return (like instanceof Transaction ? Transaction.from(bytes) : VersionedTransaction.deserialize(bytes)) as T;
}

export class DeeplinkWalletAdapter extends BaseMessageSignerWalletAdapter {
  /** Marks these rows in the connect sheet (they open the wallet app and come back). */
  readonly deeplink = true;
  readonly name: WalletName;
  readonly url: string;
  readonly icon: string;
  readonly supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set<TransactionVersion>(["legacy", 0]);

  private _publicKey: PublicKey | null = null;
  private _connecting = false;
  private _session: Session | null = null;
  private readonly opts: DeeplinkAdapterOptions;
  private readonly key: string;

  constructor(opts: DeeplinkAdapterOptions) {
    super();
    this.opts = opts;
    this.name = opts.name as WalletName;
    this.url = opts.url;
    this.icon = opts.icon;
    this.key = `mimir-deeplink:${opts.wallet}`;
  }

  get publicKey() {
    return this._publicKey;
  }
  get connecting() {
    return this._connecting;
  }
  get readyState() {
    return typeof window === "undefined" ? WalletReadyState.Unsupported : WalletReadyState.Loadable;
  }

  private get storage() {
    return this.opts.storage ?? localStorage;
  }
  private get pending() {
    return this.opts.pendingStorage ?? sessionStorage;
  }
  private origin() {
    return this.opts.origin ?? window.location.origin;
  }
  private redirect(op: string) {
    return `${this.origin()}/api/wallet-return?op=${op}`;
  }
  private open(url: string) {
    if (this.opts.open) return this.opts.open(url);
    window.location.assign(url);
  }

  private restore(): boolean {
    const s = safe(() => JSON.parse(this.storage.getItem(this.key) ?? "null") as Session | null, null);
    if (!s?.publicKey || !s.session || !s.shared || !s.dappPublicKey) return false;
    this._session = s;
    this._publicKey = new PublicKey(s.publicKey);
    this.emit("connect", this._publicKey);
    return true;
  }

  /** Page load: restore a stored session, or finish a connect the reload interrupted. Never opens the wallet. */
  async autoConnect(): Promise<void> {
    if (this.connected || this.restore()) return;
    const p = safe(() => JSON.parse(this.pending.getItem(this.key) ?? "null") as PendingConnect | null, null);
    if (p && Date.now() - p.at < (this.opts.waitMs ?? WAIT_MS)) await this.finishConnect(p);
  }

  async connect(): Promise<void> {
    if (this.connected || this._connecting) return;
    if (this.restore()) return;
    const kp = nacl.box.keyPair();
    const pending: PendingConnect = { op: newOp(), secretKey: bs58.encode(kp.secretKey), at: Date.now() };
    safe(() => this.pending.setItem(this.key, JSON.stringify(pending)), undefined);
    this.open(connectUrl(this.opts.wallet, { dappPublicKey: kp.publicKey, redirect: this.redirect(pending.op), appUrl: this.origin(), cluster: this.opts.cluster }));
    await this.finishConnect(pending);
  }

  private async finishConnect(p: PendingConnect): Promise<void> {
    this._connecting = true;
    try {
      const params = await this.waitFor(p.op);
      const err = walletError(params);
      if (err) throw new WalletConnectionError(err.message, err);
      const walletKey = params[walletKeyParam(this.opts.wallet)];
      if (!walletKey || !params.data || !params.nonce) throw new WalletConnectionError("The wallet's answer was incomplete");
      const secretKey = bs58.decode(p.secretKey);
      const shared = sharedSecret(walletKey, secretKey);
      const data = decryptPayload<{ public_key: string; session: string }>(params.data, params.nonce, shared);
      const session: Session = {
        publicKey: data.public_key,
        session: data.session,
        shared: bs58.encode(shared),
        dappPublicKey: bs58.encode(nacl.box.keyPair.fromSecretKey(secretKey).publicKey),
      };
      safe(() => this.storage.setItem(this.key, JSON.stringify(session)), undefined);
      this._session = session;
      this._publicKey = new PublicKey(session.publicKey);
      this.emit("connect", this._publicKey);
    } catch (error) {
      const e = error instanceof WalletConnectionError ? error : new WalletConnectionError((error as Error)?.message, error);
      this.emit("error", e);
      throw e;
    } finally {
      safe(() => this.pending.removeItem(this.key), undefined);
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    // Local only: asking the wallet to end the session would open it for nothing.
    try {
      this.storage.removeItem(this.key);
    } catch (error) {
      this.emit("error", new WalletDisconnectionError((error as Error)?.message, error));
    }
    this._session = null;
    this._publicKey = null;
    this.emit("disconnect");
  }

  /** Polls the relay until the wallet's answer for `op` is there (only while the page is visible). */
  private waitFor(op: string): Promise<Params> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const deadline = Date.now() + (this.opts.waitMs ?? WAIT_MS);
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let busy = false;
      const done = () => {
        if (timer) clearTimeout(timer);
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
      };
      const check = async () => {
        if (busy) return;
        if (Date.now() > deadline) {
          done();
          return reject(new Error("The wallet did not answer in time"));
        }
        busy = true;
        try {
          if (visible()) {
            const res = await fetchImpl(`${this.origin()}/api/wallet-relay?op=${op}`, { cache: "no-store" });
            if (res.status === 200) {
              const { params } = (await res.json()) as { params: Params };
              done();
              return resolve(params);
            }
          }
        } catch {
          // A dropped poll: the next one tries again.
        } finally {
          busy = false;
        }
        timer = setTimeout(check, this.opts.pollMs ?? POLL_MS);
      };
      const onVisible = () => {
        if (!visible()) return;
        if (timer) clearTimeout(timer);
        void check();
      };
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
      timer = setTimeout(check, this.opts.pollMs ?? POLL_MS);
    });
  }

  /** One signing round trip: encrypt, open the wallet, wait for the answer, decrypt it. */
  private async request<T>(method: DeeplinkMethod, payload: Record<string, unknown>): Promise<T> {
    const s = this._session;
    if (!s) throw new WalletNotConnectedError();
    const op = newOp();
    const shared = bs58.decode(s.shared);
    this.open(methodUrl(this.opts.wallet, method, { dappPublicKey: s.dappPublicKey, redirect: this.redirect(op), payload: { ...payload, session: s.session }, shared }));
    const params = await this.waitFor(op);
    const err = walletError(params);
    if (err) throw Object.assign(new Error(err.message), { code: err.code });
    if (!params.data || !params.nonce) throw new Error("The wallet's answer was incomplete");
    return decryptPayload<T>(params.data, params.nonce, shared);
  }

  async signTransaction<T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>>(transaction: T): Promise<T> {
    try {
      const { transaction: signed } = await this.request<{ transaction: string }>("signTransaction", { transaction: bs58.encode(serialize(transaction)) });
      return revive(transaction, signed);
    } catch (error) {
      const e = error instanceof WalletSignTransactionError ? error : new WalletSignTransactionError((error as Error)?.message, error);
      this.emit("error", e);
      throw e;
    }
  }

  async signAllTransactions<T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>>(transactions: T[]): Promise<T[]> {
    try {
      const { transactions: signed } = await this.request<{ transactions: string[] }>("signAllTransactions", {
        transactions: transactions.map((tx) => bs58.encode(serialize(tx))),
      });
      if (signed?.length !== transactions.length) throw new Error("The wallet returned a different number of transactions");
      return transactions.map((tx, i) => revive(tx, signed[i]));
    } catch (error) {
      const e = error instanceof WalletSignTransactionError ? error : new WalletSignTransactionError((error as Error)?.message, error);
      this.emit("error", e);
      throw e;
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      const { signature } = await this.request<{ signature: string }>("signMessage", { message: bs58.encode(message), display: "utf8" });
      return bs58.decode(signature);
    } catch (error) {
      const e = error instanceof WalletSignMessageError ? error : new WalletSignMessageError((error as Error)?.message, error);
      this.emit("error", e);
      throw e;
    }
  }
}

/** The two phone wallets, for the devnet cluster this build runs on. */
export function deeplinkAdapters(cluster: DeeplinkCluster): DeeplinkWalletAdapter[] {
  return [
    new DeeplinkWalletAdapter({ wallet: "phantom", name: "Phantom", icon: "/wallets/phantom.svg", url: "https://phantom.com", cluster }),
    new DeeplinkWalletAdapter({ wallet: "solflare", name: "Solflare", icon: "/wallets/solflare.svg", url: "https://solflare.com", cluster }),
  ];
}
