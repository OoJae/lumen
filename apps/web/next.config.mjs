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
