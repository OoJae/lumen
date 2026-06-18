/**
 * 0G Compute — Router + model catalog and TEE constants.
 *
 * Verified (mid-2026): the Router is OpenAI-compatible at ROUTER_BASE_URL; Sealed
 * Inference runs every request inside an Intel TDX + NVIDIA H100/H200 TEE.
 *
 * Model ids below are the best-confirmed values; the exact id strings should be
 * checked against the live `GET /v1/models` once a key is provisioned. The active
 * model is env-configurable (ZG_COMPUTE_MODEL), so an id change is a config edit.
 */

export type ZgModality = 'chat' | 'vision' | 'speech' | 'image';
export type ZgVerifiability = 'TeeML' | 'TeeTLS';

export interface ZgModel {
  id: string;
  label: string;
  family: string;
  modality: ZgModality;
  verifiability: ZgVerifiability;
}

export const ZG_MODELS: ZgModel[] = [
  { id: 'glm-5', label: 'GLM-5', family: 'Zhipu AI', modality: 'chat', verifiability: 'TeeML' },
  { id: 'deepseek-v3', label: 'DeepSeek V3', family: 'DeepSeek', modality: 'chat', verifiability: 'TeeML' },
  { id: 'gpt-oss-120b', label: 'gpt-oss-120b', family: 'OpenAI (open weights)', modality: 'chat', verifiability: 'TeeML' },
  { id: 'qwen3-vl', label: 'Qwen3-VL', family: 'Alibaba', modality: 'vision', verifiability: 'TeeML' },
  { id: 'whisper-large-v3', label: 'Whisper Large v3', family: 'OpenAI', modality: 'speech', verifiability: 'TeeML' },
];

// glm-5.1 is TeeML on 0G mainnet (model runs directly inside the enclave and
// signs responses) — the strongest verifiability tier, so it's our default.
export const DEFAULT_MODEL_ID = 'glm-5.1';

/** Hardware basis of 0G Sealed Inference — shown in the attestation viewer. */
export const TEE_HARDWARE = {
  cpu: 'Intel TDX',
  gpu: 'NVIDIA H100/H200',
  standard: 'TeeML (responses signed inside the enclave)',
} as const;

/** OpenAI-compatible Router base URL. Overridable via ZG_ROUTER_BASE_URL. */
export const ROUTER_BASE_URL = 'https://router-api.0g.ai/v1';

/**
 * Header that requests fully-private inference. Confirmed from live pc.0g.ai
 * ("switch to fully private inference by adding a single header"). Sent
 * unconditionally — harmless if the Router ignores it, meaningful if honored.
 */
export const PRIVATE_MODE_HEADER = 'X-0G-Provider-Trust-Mode';
export const PRIVATE_MODE_VALUE = 'private';

/** Response header carrying the per-request proof reference (chatID). */
export const PROOF_HEADER = 'ZG-Res-Key';

export const SEALED_INFERENCE_URL = 'https://0g.ai/blog/0g-private-computer';
export const ATTESTATION_DOCS_URL =
  'https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference';
