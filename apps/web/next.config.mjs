/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Compile the in-repo shared package (it ships raw .ts via the workspace).
  transpilePackages: ['@lumen/shared'],
};

export default nextConfig;
