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
        {/* Modern companion to Next's appleWebApp metadata; avoids Chromium's deprecation warning. */}
        <meta name="mobile-web-app-capable" content="yes" />
        {/* Anti-flash: read stored theme before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('apex-theme')||localStorage.getItem('apex-company-theme')||'technoedge-light';var a=localStorage.getItem('apex-accent')||localStorage.getItem('apex-company-accent')||'royal-blue';document.documentElement.setAttribute('data-theme',t==='john-wick-dark'?t:'technoedge-light');document.documentElement.setAttribute('data-accent',a);var f=localStorage.getItem('apex-font-size');if(f==='small'||f==='medium'||f==='large')document.documentElement.setAttribute('data-font-size',f);document.documentElement.setAttribute('data-compact',localStorage.getItem('apex-compact')==='true'?'true':'false');}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        {/* Visible staging indicator — renders only when NEXT_PUBLIC_APP_ENV=staging */}
        <StagingBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
