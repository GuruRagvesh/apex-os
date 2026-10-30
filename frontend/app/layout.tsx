import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@apex/apps-web/components/providers';
import { StagingBanner } from '@apex/shared-ui/components/staging-banner';

export const metadata: Metadata = {
  title: {
    template: '%s — Apex OS',
    default: 'Apex OS — AI-Powered Business OS by TechnoEdge',
  },
  description: 'Apex OS — AI-powered Business Operating System by TechnoEdge Learning Services',
  icons: { icon: '/favicon.svg' },
  manifest: '/manifest.webmanifest',
  other: {
    // Chromium now expects the standard PWA capability declaration. Keep the
    // Apple-specific metadata below for older iOS home-screen installations.
    'mobile-web-app-capable': 'yes',
  },
  appleWebApp: {
    capable: true,
    title: 'Apex OS',
    statusBarStyle: 'black-translucent',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="technoedge-light" data-accent="royal-blue">
      <head>
        {/* Anti-flash: read stored theme before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var auth=JSON.parse(localStorage.getItem('apex-auth')||'null');var state=auth&&auth.state;var id=state&&state.isAuthenticated&&state.user&&state.user.id;var pref=function(key){return id?localStorage.getItem('apex-appearance:'+id+':'+key):null};var t=pref('theme')||localStorage.getItem('apex-company-theme');var a=pref('accent')||localStorage.getItem('apex-company-accent');var f=pref('font-size');document.documentElement.setAttribute('data-theme',t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'john-wick-dark':'technoedge-light'):(t==='john-wick-dark'?t:'technoedge-light'));document.documentElement.setAttribute('data-accent',['royal-blue','emerald','violet','gold','crimson','slate'].includes(a)?a:'royal-blue');document.documentElement.setAttribute('data-font-size',f==='small'||f==='large'?f:'medium');document.documentElement.setAttribute('data-compact',pref('compact')==='true'?'true':'false');document.documentElement.setAttribute('data-contrast',pref('contrast')==='more'?'more':'normal');document.documentElement.setAttribute('data-motion',pref('motion')==='reduce'?'reduce':'normal');document.documentElement.setAttribute('data-sidebar-density',pref('sidebar-density')==='compact'?'compact':'comfortable');}catch(e){}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        {/* Visible staging indicator — renders only when NEXT_PUBLIC_APP_ENV=staging */}
        <StagingBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
