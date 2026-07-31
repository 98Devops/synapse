import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Synapse — your second brain',
  description:
    'Speak a thought. Synapse transcribes it, extracts the people, projects and ideas inside it, and weaves it into a living knowledge graph you can question.',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Synapse' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0d12' },
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

/** Runs before paint so there is no flash of the wrong theme. */
const THEME_SCRIPT = `(function(){try{
var s=localStorage.getItem('synapse-theme');
var t=s||(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');
document.documentElement.setAttribute('data-theme',t);
}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
