import type { NextConfig } from 'next'
import path from 'path'

const supabaseHost =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https?:\/\//, '').replace(/\/$/, '') ||
  'qppnaxvwslwlsvsdwhvp.supabase.co'

// Pin the app root when a parent folder also has a lockfile (avoids wrong module resolution).
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  async rewrites() {
    return [
      {
        // Same-origin proxy so product photos always pass CSP img-src 'self'.
        source: '/media/product-images/:path*',
        destination: `https://${supabaseHost}/storage/v1/object/public/product-images/:path*`,
      },
    ]
  },
  async headers() {
    // CSP: Next.js App Router requires 'unsafe-inline' for its own hydration scripts.
    // A full nonce-based CSP would need custom middleware; this is the practical baseline.
    const isDev = process.env.NODE_ENV === 'development'
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://js.stripe.com`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // Exact Supabase host + wildcard — some browsers mishandle *.supabase.co alone.
      `img-src 'self' data: blob: https://${supabaseHost} https://*.supabase.co https://images.unsplash.com https://lovelyqueenmart.com https://www.lovelyqueenmart.com`,
      `connect-src 'self' https://${supabaseHost} https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://r.stripe.com`,
      "frame-src https://js.stripe.com https://hooks.stripe.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://js.stripe.com",
      "worker-src 'self'",
      "manifest-src 'self'",
    ].join('; ')

    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/admin/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(self)',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ]
  },
  images: {
    // Vercel Image Optimization is quota-gated (402 OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED).
    unoptimized: true,
    qualities: [50, 60, 70, 75, 90],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [64, 96, 128, 256, 384, 640],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lovelyqueenmart.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'www.lovelyqueenmart.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: supabaseHost,
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
}

const phoneHosts =
  process.env.DEV_PHONE_HOSTS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? []

if (process.env.NODE_ENV === 'development') {
  nextConfig.allowedDevOrigins = ['127.0.0.1', ...phoneHosts]
}

export default nextConfig
