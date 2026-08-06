import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { StagingBanner } from '@apex/shared-ui/components/staging-banner';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    template: '%s — Apex OS',
    default: 'Apex OS — AI-Powered Business OS by TechnoEdge',
  },
  description: 'Apex OS — AI-powered Business Operating System by TechnoEdge Learning Services',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="technoedge-light" data-accent="royal-blue">
      <head>
        {/* Anti-flash: read stored theme before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('apex-theme')||localStorage.getItem('apex-company-theme')||'technoedge-light';var a=localStorage.getItem('apex-accent')||localStorage.getItem('apex-company-accent')||'royal-blue';document.documentElement.setAttribute('data-theme',t);document.documentElement.setAttribute('data-accent',a);}catch(e){}})();`,
          }}
        />
      </head>
      <body className={inter.className}>
        {/* Visible staging indicator — renders only when NEXT_PUBLIC_APP_ENV=staging */}
        <StagingBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
