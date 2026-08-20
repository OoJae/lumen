# contracts — LumenCompanion (Wave 3, live)

Hardhat project for Lumen's ownership layer. **Deployed and source-verified on
both 0G networks**, at the same address:

| | |
|---|---|
| Address | `0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738` |
| Mainnet (Aristotle, chainId **16661**) | block 41801714 · [chainscan](https://chainscan.0g.ai/address/0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738) |
| Testnet (Galileo, chainId **16602**) | block 49747640 · [chainscan-galileo](https://chainscan-galileo.0g.ai/address/0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738) |
| Compiler | solc 0.8.24, `evmVersion: cancun`, optimizer on, 200 runs, **`viaIR` off** |
| Deployer | `0x446106F3E5b94C297C5c45bC0958ACD86C861CcB` (deploy-only hot wallet) |
| Tests | 20, in `test/LumenCompanion.test.ts` |

`viaIR` is deliberately **off** — the contract is small (~5KB), so the IR
pipeline buys nothing and adds a variable that source verification can trip on.
`hardhat.config.ts` is the authority; this table mirrors it.

## What it is

A companion is the on-chain identity of one person's journal. The token holds a
**pointer**, never the journal: `dataHash` is the 0G Storage merkle root of a
snapshot encrypted on the user's device with a key derived from their wallet
signature. Lumen cannot read it, and neither can the chain.

Four invariants, all enforced in the contract:

1. **One companion per wallet, minted to self.**
2. **Exactly one `IntelligentData` entry per token** — the current memory root.
3. **Zero admin keys.** No owner, no pause, no upgrade, no mint fee, no settable
   verifier. Lumen holds no power over anyone's companion. This is the strongest
   form of the ownership claim the product makes, and it is why the contract is
   not upgradeable: a fix would be a new deployment, not a silent rewrite.
4. **Soulbound until an oracle exists.** ERC-7857 transfers require a TEE
   re-encryption oracle. 0G's reference oracle address is an inert EOA with no
   published signing service (checked 2026-08), so `iTransfer` and `iClone`
   revert rather than ship a transfer that cannot re-encrypt — or let Lumen
   appoint itself the "TEE".

## The anchor chain — what the logs prove, and what they don't

`anchorMemoryRoot(tokenId, newRoot, expectedPrevRoot)` is compare-and-swap: it
reverts with `StaleAnchor` unless `expectedPrevRoot` equals the current root. It
is the only path the app calls, and it makes a concurrent overwrite from a second
device fail loudly instead of silently winning.

**But be precise about what a log replayer can verify.** Both `anchorMemoryRoot`
and `update` call the same private `_anchor`, which always writes
`prevRoot = current` and emits a **byte-identical** `MemoryRootAnchored`. `update`
— the 0G reference-implementation alias — performs **no** `expectedPrevRoot`
check. So from the event log alone:

- **Provable:** the roots form an unbroken chain. Every event's `prevRoot` is the
  previous event's `newRoot`, `seq` increments by one, and no root can be
  inserted, removed or reordered without breaking it.
- **Not provable:** that every link was compare-and-swapped, i.e. that the caller
  knew the prior root before replacing it. An owner calling `update` produces a
  link indistinguishable from one produced by `anchorMemoryRoot`.

Both writers are owner-only (`_requireTokenOwner`), so neither lets a third party
touch the pointer. The honest claim is *"an unbroken, append-only chain of roots,
which only you can extend"* — not *"nothing can be replaced quietly"*.

## Divergence from the ERC-7857 reference

The contract implements the **final** ERC-7857 interface as published in
`ethereum/ERCs`, and additionally exposes 0G reference-implementation aliases so
tooling written against either shape works. This is the full table the contract's
own NatSpec points at.

| Surface | Final ERC-7857 | 0G reference | LumenCompanion |
|---|---|---|---|
| Read the data entries | `intelligentDataOf` | `intelligentDatasOf` | **both** — `intelligentDatasOf` delegates to `intelligentDataOf` |
| Replace the data entries | — | `update(tokenId, IntelligentData[])` | **implemented**, restricted to exactly one entry (`SingleDataEntryOnly`), no CAS check |
| Anchor a new root | — | — | **`anchorMemoryRoot`**, a Lumen addition: compare-and-swap, plus a `MemoryRootAnchored(tokenId, seq, prevRoot, newRoot)` event that makes the history replayable |
| `iTransfer` / `iClone` | oracle-verified re-encryption | oracle-verified re-encryption | **revert** (`TransferRequiresOracle` / `OracleNotLive`) — see invariant 4 |
| `verifier()` | returns the data verifier | returns the data verifier | returns `address(0)`, honestly: there is no verifier |
| `authorizeUsage` / `revokeAuthorization` / `authorizedUsersOf` | ✅ | ✅ | ✅ |
| `delegateAccess` / `getDelegateAccess` | ✅ | ✅ | ✅ |
| ERC-721 transfers | — | — | **revert** — soulbound, enforced in `_update` |
| Mint | oracle-verified | oracle-verified | `mint(memoryRoot, dataDescription)`, self-mint only, one per wallet |

`supportsInterface` reports `IERC7857`, `IERC7857Metadata` and the ERC-721 ids.
A consumer that checks the interface id and then calls `iTransfer` will get a
revert, which is the intended outcome: the contract advertises the interface it
implements and refuses the operation it cannot honour.

## Working on it

```bash
pnpm --filter contracts test                       # 20 tests, local hardhat
npx hardhat run scripts/deploy.ts --network mainnet
npx hardhat verify <ADDRESS> --network mainnet     # apiURL: https://chainscan.0g.ai/open/api
```

`scripts/smoke.ts` mints and anchors against a live network — note that it mints
with **its own** `dataDescription`, so token #1 on each network is not an
app-minted companion and its descriptor does not match the app's.

Deploy wallet is a deploy-only hot wallet, funded minimally. `.env.example` only —
never commit a key.
