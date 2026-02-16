/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // ignoreBuildErrors was removed — TypeScript errors MUST be fixed, not hidden.
    // This is a critical safety net. See: https://nextjs.org/docs/api-reference/next.config.js/ignoring-typescript-errors
  },
  // Disable caching ONLY in development to ensure fresh code on every reload.
  // In production, Next.js default caching applies for optimal performance.
  headers: async () => {
    if (process.env.NODE_ENV !== 'production') {
      return [
        {
          source: '/(.*)',
          headers: [
            { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
          ],
        },
      ];
    }
    return [];
  },
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000', '*.trycloudflare.com', '*.erlancarreira.com.br'],
    },
  },
}

export default nextConfig
