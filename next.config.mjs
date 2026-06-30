/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdf-parse uses Node APIs and must not be bundled by the server compiler
    serverComponentsExternalPackages: ["pdf-parse"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
};

export default nextConfig;
