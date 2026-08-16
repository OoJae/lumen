/**
 * Serves the provider's on-chain service record so the browser knows which
 * signer a valid enclave signature must recover to.
 *
 * Read from the 0G InferenceServing registry rather than hardcoded: if a
 * provider rotates its TEE key, verification degrades honestly ("couldn't
 * confirm the signer") instead of quietly checking against a stale constant.
 * Cached in-process — it changes about never, and every reflection needs it.
 */
import { createPublicClient, http } from 'viem';
import {
  CHAT_PROVIDER_ADDRESS,
  INFERENCE_SERVING_ABI,
  INFERENCE_SERVING_ADDRESS,
  ZG_MAINNET,
} from '@lumen/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 60 * 60 * 1000;

export interface TeeSignerInfo {
  providerAddress: string;
  teeSignerAddress: string;
  teeSignerAcknowledged: boolean;
  providerUrl: string;
  model: string;
  verifiability: string;
  /** Parsed from the record's additionalInfo — drives the honest disclosure
   *  that a 'centralized' provider runs the model at an upstream host. */
  disclosure: { providerType: string; providerIdentity: string };
  fetchedAt: string;
}

let cache: { value: TeeSignerInfo; at: number } | null = null;

function parseDisclosure(additionalInfo: string): TeeSignerInfo['disclosure'] {
  try {
    const parsed = JSON.parse(additionalInfo) as {
      ProviderType?: string;
      ProviderIdentity?: string;
    };
    return {
      providerType: parsed.ProviderType ?? 'unknown',
      providerIdentity: parsed.ProviderIdentity ?? 'unknown',
    };
  } catch {
    return { providerType: 'unknown', providerIdentity: 'unknown' };
  }
}

export async function GET(): Promise<Response> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return Response.json(cache.value);
  }

  // The compute provider is registered on 0G mainnet regardless of which
  // network the app's storage/wallet is pointed at.
  const client = createPublicClient({
    transport: http(process.env.ZG_COMPUTE_RPC || ZG_MAINNET.rpcUrl),
  });

  const provider = (process.env.ZG_PROVIDER_ADDRESS || CHAT_PROVIDER_ADDRESS) as `0x${string}`;

  try {
    const service = await client.readContract({
      address: INFERENCE_SERVING_ADDRESS,
      abi: INFERENCE_SERVING_ABI,
      functionName: 'getService',
      args: [provider],
    });

    const value: TeeSignerInfo = {
      providerAddress: service.provider,
      teeSignerAddress: service.teeSignerAddress,
      teeSignerAcknowledged: service.teeSignerAcknowledged,
      providerUrl: service.url,
      model: service.model,
      verifiability: service.verifiability,
      disclosure: parseDisclosure(service.additionalInfo),
      fetchedAt: new Date().toISOString(),
    };

    cache = { value, at: Date.now() };
    return Response.json(value);
  } catch (err) {
    // Serve a stale cache rather than break verification on a flaky RPC.
    if (cache) return Response.json(cache.value);
    console.error('[tee-signer] registry read failed:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'signer-record-unavailable' }, { status: 503 });
  }
}
