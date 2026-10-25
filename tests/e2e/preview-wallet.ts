import { expect, type Page } from "@playwright/test";
export function registerTestWallet() {
  const listeners: Record<string, ((arg: unknown) => void)[]> = {};
  const emit = (event: string, arg: unknown) => (listeners[event] ?? []).forEach((fn) => fn(arg));
  const publicKey = new Uint8Array(32).fill(7);
  const account = {
    address: "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx",
    publicKey,
    chains: ["solana:devnet"],
    features: ["solana:signTransaction", "solana:signMessage"],
  };
  const wallet: Record<string, unknown> & { accounts: unknown[] } = {
    version: "1.0.0",
    name: "Mimir Test Wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=",
    chains: ["solana:devnet"],
    accounts: [],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          wallet.accounts = [account];
          emit("change", { accounts: wallet.accounts });
          return { accounts: wallet.accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          wallet.accounts = [];
          emit("change", { accounts: [] });
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (event: string, fn: (arg: unknown) => void) => {
          (listeners[event] ??= []).push(fn);
          return () => {
            listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
          };
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
          inputs.map((input) => ({ signedTransaction: input.transaction })),
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (...inputs: { message: Uint8Array }[]) =>
          inputs.map((input) => ({ signedMessage: input.message, signature: new Uint8Array(64) })),
      },
    },
  };
  (window as unknown as { previewTestWallet: unknown }).previewTestWallet = wallet;
  const register = (api: { register: (w: unknown) => void }) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) => register((event as CustomEvent).detail));
}

export async function connectPreviewWallet(page: Page) {
  await page.getByRole("button", { name: "Connect wallet for Preview", exact: true }).click();
  await page.getByRole("button", { name: /^Solana/ }).click();
  await page.getByRole("button", { name: /Mimir Test Wallet/ }).click();
  await expect(page.getByRole("button", { name: "Verify wallet for Preview", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Verify wallet for Preview", exact: true }).click();
}
