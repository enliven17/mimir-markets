// Fetch the on-chain Anchor IDLs of Circle's CCTP V2 Solana programs (devnet) into ./idl/.
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { mkdirSync, writeFileSync } from 'node:fs'
const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
const provider = new AnchorProvider(conn, new Wallet(Keypair.generate()), {})
mkdirSync('idl', { recursive: true })
for (const [name, id] of [['token_messenger_minter_v2', 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe'], ['message_transmitter_v2', 'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC']]) {
  const idl = await Program.fetchIdl(new PublicKey(id), provider)
  if (!idl) { console.log(name, 'no IDL on chain'); continue }
  writeFileSync(`idl/${name}.json`, JSON.stringify(idl, null, 2))
  const ix = idl.instructions.find((i) => i.name === 'deposit_for_burn')
  console.log(name, 'ok', ix ? `deposit_for_burn accounts: ${ix.accounts.map((a) => a.name).join(', ')}` : '')
  if (ix) console.log('  args:', JSON.stringify(ix.args))
}
