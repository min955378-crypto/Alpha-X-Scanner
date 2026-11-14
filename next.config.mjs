/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The custom server (`server/index.ts`) owns HTTP + WebSocket upgrade handling.
  // Nothing here may bind a second port: the browser reaches the app through
  // exactly one origin, so client code only ever uses relative URLs.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
