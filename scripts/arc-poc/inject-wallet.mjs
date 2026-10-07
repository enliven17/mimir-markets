/** Runs in the page before any script: a Wallet Standard wallet backed by window.__e2eSign. */
export function injectWallet(name, address, publicKey) {
  localStorage.setItem('walletName', JSON.stringify(name))
  const b64 = (u8) => btoa(String.fromCharCode(...u8))
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  const chains = ['solana:devnet', 'solana:testnet', 'solana:mainnet']
  const account = Object.freeze({ address, publicKey: new Uint8Array(publicKey), chains, features: ['solana:signTransaction', 'solana:signMessage'] })
  const listeners = new Set()
  let accounts = []
  const wallet = {
    version: '1.0.0',
    name,
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4=',
    chains,
    get accounts() {
      return accounts
    },
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async () => {
          accounts = [account]
          listeners.forEach((fn) => fn({ accounts }))
          return { accounts }
        },
      },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => { accounts = []; listeners.forEach((fn) => fn({ accounts })) } },
      'standard:events': { version: '1.0.0', on: (_event, fn) => (listeners.add(fn), () => listeners.delete(fn)) },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async (...inputs) =>
          Promise.all(inputs.map(async ({ transaction }) => ({ signedTransaction: unb64(await window.__e2eSign('tx', b64(transaction))) }))),
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async (...inputs) =>
          Promise.all(inputs.map(async ({ message }) => ({ signedMessage: message, signature: unb64(await window.__e2eSign('msg', b64(message))) }))),
      },
    },
  }
  const register = ({ register }) => register(wallet)
  window.addEventListener('wallet-standard:app-ready', (e) => register(e.detail))
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }))
}
