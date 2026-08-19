/**
 * On-chain surface Lumen talks to (Wave 3).
 *
 * LumenCompanion is our own ERC-7857 INFT: one companion per wallet, holding a
 * pointer (a 0G Storage merkle root) to the owner's client-encrypted memory
 * snapshot. It never holds journal content.
 *
 * The ABI is trimmed to what the app calls but DELIBERATELY KEEPS EVERY CUSTOM
 * ERROR: that is what lets viem decode a revert into honest UI copy ("you
 * already have a companion") instead of a bare "execution reverted".
 *
 * Generated from the compiled artifact; regenerate if the contract changes.
 */
import type { ZgNetworkKey } from './networks';

export const LUMEN_COMPANION_ABI = [
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        },
        {
          "internalType": "address",
          "name": "user",
          "type": "address"
        }
      ],
      "name": "AlreadyAuthorized",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "owner",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        }
      ],
      "name": "AlreadyHasCompanion",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "sender",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        },
        {
          "internalType": "address",
          "name": "owner",
          "type": "address"
        }
      ],
      "name": "ERC721IncorrectOwner",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "operator",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        }
      ],
      "name": "ERC721InsufficientApproval",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "approver",
          "type": "address"
        }
      ],
      "name": "ERC721InvalidApprover",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "operator",
          "type": "address"
        }
      ],
      "name": "ERC721InvalidOperator",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "owner",
          "type": "address"
        }
      ],
      "name": "ERC721InvalidOwner",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "receiver",
          "type": "address"
        }
      ],
      "name": "ERC721InvalidReceiver",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "sender",
          "type": "address"
        }
      ],
      "name": "ERC721InvalidSender",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        }
      ],
      "name": "ERC721NonexistentToken",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        },
        {
          "internalType": "address",
          "name": "user",
          "type": "address"
        }
      ],
      "name": "NotAuthorizedUser",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        },
        {
          "internalType": "address",
          "name": "caller",
          "type": "address"
        }
      ],
      "name": "NotTokenOwner",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "OracleNotLive",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "bytes32",
          "name": "root",
          "type": "bytes32"
        }
      ],
      "name": "SameRoot",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "SingleDataEntryOnly",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        },
        {
          "internalType": "bytes32",
          "name": "expectedPrev",
          "type": "bytes32"
        },
        {
          "internalType": "bytes32",
          "name": "actualLatest",
          "type": "bytes32"
        }
      ],
      "name": "StaleAnchor",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "TransferRequiresOracle",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "ZeroAddress",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "ZeroRoot",
      "type": "error"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "uint64",
          "name": "seq",
          "type": "uint64"
        },
        {
          "indexed": false,
          "internalType": "bytes32",
          "name": "prevRoot",
          "type": "bytes32"
        },
        {
          "indexed": false,
          "internalType": "bytes32",
          "name": "newRoot",
          "type": "bytes32"
        }
      ],
      "name": "MemoryRootAnchored",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "owner",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "bytes32",
          "name": "memoryRoot",
          "type": "bytes32"
        },
        {
          "indexed": false,
          "internalType": "string",
          "name": "dataDescription",
          "type": "string"
        }
      ],
      "name": "Minted",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "from",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "to",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        }
      ],
      "name": "Transfer",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "bytes32[]",
          "name": "oldDataHashes",
          "type": "bytes32[]"
        },
        {
          "indexed": false,
          "internalType": "bytes32[]",
          "name": "newDataHashes",
          "type": "bytes32[]"
        }
      ],
      "name": "Updated",
      "type": "event"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "name": "anchorCount",
      "outputs": [
        {
          "internalType": "uint64",
          "name": "",
          "type": "uint64"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        },
        {
          "internalType": "bytes32",
          "name": "newRoot",
          "type": "bytes32"
        },
        {
          "internalType": "bytes32",
          "name": "expectedPrevRoot",
          "type": "bytes32"
        }
      ],
      "name": "anchorMemoryRoot",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        },
        {
          "internalType": "address",
          "name": "user",
          "type": "address"
        }
      ],
      "name": "authorizeUsage",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        }
      ],
      "name": "authorizedUsersOf",
      "outputs": [
        {
          "internalType": "address[]",
          "name": "",
          "type": "address[]"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "owner",
          "type": "address"
        }
      ],
      "name": "balanceOf",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "owner",
          "type": "address"
        }
      ],
      "name": "companionOf",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        },
        {
          "components": [
            {
              "components": [
                {
                  "internalType": "bytes32",
                  "name": "oldDataHash",
                  "type": "bytes32"
                },
                {
                  "internalType": "bytes32",
                  "name": "newDataHash",
                  "type": "bytes32"
                },
                {
                  "internalType": "bytes",
                  "name": "nonce",
                  "type": "bytes"
                },
                {
                  "internalType": "bytes",
                  "name": "encryptedPubKey",
                  "type": "bytes"
                },
                {
                  "internalType": "bytes",
                  "name": "proof",
                  "type": "bytes"
                }
              ],
              "internalType": "struct AccessProof",
              "name": "accessProof",
              "type": "tuple"
            },
            {
              "components": [
                {
                  "internalType": "enum OracleType",
                  "name": "oracleType",
                  "type": "uint8"
                },
                {
                  "internalType": "bytes32",
                  "name": "oldDataHash",
                  "type": "bytes32"
                },
                {
                  "internalType": "bytes32",
                  "name": "newDataHash",
                  "type": "bytes32"
                },
                {
                  "internalType": "bytes",
                  "name": "sealedKey",
                  "type": "bytes"
                },
                {
                  "internalType": "bytes",
                  "name": "encryptedPubKey",
                  "type": "bytes"
                },
                {
                  "internalType": "bytes",
                  "name": "nonce",
                  "type": "bytes"
                },
                {
                  "internalType": "bytes",
                  "name": "proof",
                  "type": "bytes"
                }
              ],
              "internalType": "struct OwnershipProof",
              "name": "ownershipProof",
              "type": "tuple"
            }
          ],
          "internalType": "struct TransferValidityProof[]",
          "name": "",
          "type": "tuple[]"
        }
      ],
      "name": "iTransfer",
      "outputs": [],
      "stateMutability": "pure",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        }
      ],
      "name": "intelligentDataOf",
      "outputs": [
        {
          "components": [
            {
              "internalType": "string",
              "name": "dataDescription",
              "type": "string"
            },
            {
              "internalType": "bytes32",
              "name": "dataHash",
              "type": "bytes32"
            }
          ],
          "internalType": "struct IntelligentData[]",
          "name": "",
          "type": "tuple[]"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        }
      ],
      "name": "intelligentDatasOf",
      "outputs": [
        {
          "components": [
            {
              "internalType": "string",
              "name": "dataDescription",
              "type": "string"
            },
            {
              "internalType": "bytes32",
              "name": "dataHash",
              "type": "bytes32"
            }
          ],
          "internalType": "struct IntelligentData[]",
          "name": "",
          "type": "tuple[]"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        }
      ],
      "name": "latestMemoryRoot",
      "outputs": [
        {
          "internalType": "bytes32",
          "name": "",
          "type": "bytes32"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "bytes32",
          "name": "memoryRoot",
          "type": "bytes32"
        },
        {
          "internalType": "string",
          "name": "dataDescription",
          "type": "string"
        }
      ],
      "name": "mint",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "name",
      "outputs": [
        {
          "internalType": "string",
          "name": "",
          "type": "string"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        }
      ],
      "name": "ownerOf",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        },
        {
          "internalType": "address",
          "name": "user",
          "type": "address"
        }
      ],
      "name": "revokeAuthorization",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "bytes4",
          "name": "interfaceId",
          "type": "bytes4"
        }
      ],
      "name": "supportsInterface",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "symbol",
      "outputs": [
        {
          "internalType": "string",
          "name": "",
          "type": "string"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        }
      ],
      "name": "tokenURI",
      "outputs": [
        {
          "internalType": "string",
          "name": "",
          "type": "string"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "tokenId",
          "type": "uint256"
        },
        {
          "components": [
            {
              "internalType": "string",
              "name": "dataDescription",
              "type": "string"
            },
            {
              "internalType": "bytes32",
              "name": "dataHash",
              "type": "bytes32"
            }
          ],
          "internalType": "struct IntelligentData[]",
          "name": "newDatas",
          "type": "tuple[]"
        }
      ],
      "name": "update",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "verifier",
      "outputs": [
        {
          "internalType": "contract IERC7857DataVerifier",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "pure",
      "type": "function"
    }
  ] as const;

/**
 * Deployed and chainscan-verified 2026-08-16. The same address on both networks
 * because both were the nonce-0 CREATE of one fresh deploy wallet.
 *   mainnet  https://chainscan.0g.ai/address/0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738#code
 *   galileo  https://chainscan-galileo.0g.ai/address/0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738#code
 */
export const LUMEN_COMPANION_ADDRESS: Record<ZgNetworkKey, `0x${string}` | null> = {
  mainnet: '0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738',
  testnet: '0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738',
};

/**
 * The block each deployment landed in. Log queries start here, not at genesis:
 * 0G mainnet is past block 42M, and scanning from 0 turns a public proof page
 * into a 17-second wait. Read from contracts/deployments/*.json.
 */
export const LUMEN_COMPANION_DEPLOY_BLOCK: Record<ZgNetworkKey, bigint> = {
  mainnet: 41_801_714n,
  testnet: 49_747_640n,
};

/** 0G InferenceServing registry — the on-chain source of a provider's TEE signer
 *  address, which per-request verification checks recovered signatures against. */
export const INFERENCE_SERVING_ADDRESS =
  '0x47340d900bdFec2BD393c626E12ea0656F938d84' as const;

/** Minimal read ABI: getService(provider) -> the provider's service record. */
export const INFERENCE_SERVING_ABI = [
  {
    type: 'function',
    name: 'getService',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'provider', type: 'address' },
          { name: 'serviceType', type: 'string' },
          { name: 'url', type: 'string' },
          { name: 'inputPrice', type: 'uint256' },
          { name: 'outputPrice', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'model', type: 'string' },
          { name: 'verifiability', type: 'string' },
          { name: 'additionalInfo', type: 'string' },
          { name: 'teeSignerAddress', type: 'address' },
          { name: 'teeSignerAcknowledged', type: 'bool' },
        ],
      },
    ],
  },
] as const;

/**
 * Our live chat provider and the TEE signer it has registered on-chain.
 * These are an EXPECTATION used by tests and docs — at runtime the app reads the
 * signer from the registry, so a provider key rotation degrades verification
 * honestly instead of silently checking against a stale constant.
 */
export const CHAT_PROVIDER_ADDRESS = '0xDB7B465300B0acf454867683c5481055f698b2e8' as const;
export const CHAT_PROVIDER_EXPECTED_TEE_SIGNER =
  '0x806C12A614272f6eE23c179a3D6Bc3f68b7Eb8e5' as const;

export function resolveCompanionAddress(
  network: ZgNetworkKey,
  override?: string,
): `0x${string}` | null {
  const candidate = override?.trim() || LUMEN_COMPANION_ADDRESS[network];
  if (!candidate) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(candidate)) return null;
  return candidate as `0x${string}`;
}

/**
 * A 0G Storage rootHash is already 32 bytes of hex, so it drops straight into
 * the contract's bytes32 — but fail loudly if the SDK's format ever shifts.
 */
export function asMemoryRootBytes32(rootHash: string): `0x${string}` {
  const value = rootHash.startsWith('0x') ? rootHash : `0x${rootHash}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Not a bytes32 memory root: ${rootHash}`);
  }
  return value as `0x${string}`;
}
