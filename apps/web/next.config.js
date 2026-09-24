import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@xactions/api-client'],
  outputFileTracingRoot: path.resolve('.'),
};

export default nextConfig;
