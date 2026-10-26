/** The executor's enforced maximum debit: quoted input, 5% fee headroom, 0.02 SOL rent/priority. */
export const buySpendCeiling = (lamports: bigint) => lamports + lamports / 20n + 20_000_000n;
