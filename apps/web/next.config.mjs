// Fail the BUILD on a bad network value rather than white-screening the browser
// for a dashboard typo. NEXT_PUBLIC_* is inlined at build time, so this is the
// last moment the value can be caught.
const zgNetwork = process.env.NEXT_PUBLIC_ZG_NETWORK?.trim().toLowerCase();
if (zgNetwork && zgNetwork !== 'mainnet' && zgNetwork !== 'testnet') {
  throw new Error(
    `NEXT_PUBLIC_ZG_NETWORK="${process.env.NEXT_PUBLIC_ZG_NETWORK}" is not a 0G network. ` +
      'Use "mainnet" or "testnet" (unset = mainnet).',
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Compile the in-repo shared package (it ships raw .ts via the workspace).
  transpilePackages: ['@lumen/shared'],
  // Keep heavyweight/native-flavored SDKs out of the server bundle. transformers
  // runs ONLY in a client Web Worker; the storage SDK is client-side (user-signed
  // uploads) except for dev scripts.
  serverExternalPackages: ['@huggingface/transformers', '@0gfoundation/0g-storage-ts-sdk'],
};

export default nextConfig;
