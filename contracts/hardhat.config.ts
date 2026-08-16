import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Network values MIRROR packages/shared/src/networks.ts (ZG_MAINNET / ZG_TESTNET).
 * They are mirrored, not imported: this config runs under CJS ts-node and must
 * not pull in the workspace's Bundler-resolution ESM TypeScript. Keep in sync by
 * hand — packages/shared carries the same note.
 *
 * Galileo testnet chainId is 16602 (verified live: eth_chainId -> 0x40da).
 * Mainnet Aristotle is 16661. Both need evmVersion "cancun" per 0G docs.
 */
const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
      // viaIR intentionally OFF: LumenCompanion is small (~5KB), so the IR
      // pipeline buys nothing and adds a verification variable.
    },
  },
  networks: {
    hardhat: { hardfork: 'cancun' },
    galileo: { url: 'https://evmrpc-testnet.0g.ai', chainId: 16602, accounts },
    mainnet: { url: 'https://evmrpc.0g.ai', chainId: 16661, accounts },
  },
  etherscan: {
    // chainscan accepts a placeholder key (verified live).
    apiKey: { galileo: '00', mainnet: '00' },
    customChains: [
      {
        network: 'mainnet',
        chainId: 16661,
        urls: { apiURL: 'https://chainscan.0g.ai/open/api', browserURL: 'https://chainscan.0g.ai' },
      },
      {
        network: 'galileo',
        chainId: 16602,
        urls: {
          apiURL: 'https://chainscan-galileo.0g.ai/open/api',
          browserURL: 'https://chainscan-galileo.0g.ai',
        },
      },
    ],
  },
  sourcify: { enabled: false },
};

export default config;
