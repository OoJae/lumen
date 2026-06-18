# contracts — (Wave 3)

Hardhat project for Lumen's on-chain ownership layer. **Not built in Wave 1** —
Wave 1 ships the core inference loop only. Scaffolded here so the structure is
visible and the integration plan is concrete.

## Planned (Wave 3, on 0G Aristotle mainnet — chainId 16661, `evmVersion: "cancun"`)
- **`LumenCompanion` (ERC-7857 / Agentic ID INFT)** — the user's companion as an
  intelligent NFT whose encrypted metadata + memory-root pointer live on 0G
  Storage. Reference: [`0gfoundation/0g-agent-nft`](https://github.com/0gfoundation/0g-agent-nft)
  (EIP-7857). Transfers re-encrypt via the TEE oracle.
- **`MemoryAnchor` registry** — `setMemoryRoot(tokenId, root)` keeps the on-chain
  pointer to the latest encrypted memory root current.

## Config notes (verified mid-2026)
- Hardhat `solidity` with `evmVersion: "cancun"`, `optimizer` on, `viaIR: true`.
- Verify on chainscan: `npx hardhat verify <ADDRESS> --network mainnet`
  (`apiURL: https://chainscan.0g.ai/open/api`). Verified contracts are required
  for the Wave 3 rubric.
- Deploy wallet = a deploy-only hot wallet, funded minimally.

See [`docs/0g-integration.md`](../docs/0g-integration.md) for the full forward plan.
