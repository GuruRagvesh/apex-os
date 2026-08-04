/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for Phase 1A of the vertical-slice migration: the Sales CRM Leads
  // slice lives at platforms/business/sales-crm/leads/, outside this app root.
  // Without this, Next 14 will not run external TS/TSX through SWC.
  // Vercel additionally needs "Include files outside the Root Directory"
  // enabled for the frontend project — that is a dashboard setting, not a repo
  // change. See platforms/business/sales-crm/leads/docs/README.md.
  experimental: {
    externalDir: true,
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
  },
  images: {
    domains: ['api.dicebear.com', 'avatars.githubusercontent.com'],
  },
};

module.exports = nextConfig;
