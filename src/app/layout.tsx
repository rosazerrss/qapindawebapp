import type { Metadata, Viewport } from 'next';

import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { CartProvider } from '@/contexts/CartContext';
import { RegionProvider } from '@/contexts/RegionContext';
import { FavouritesProvider } from '@/contexts/FavouritesContext';
import { LocaleProvider } from '@/i18n';
import { CookieConsent } from '@/components/layout/CookieConsent';
import { ConfigNotice } from '@/components/layout/ConfigNotice';
import { NotificationSoundProvider } from '@/components/notifications/NotificationSoundProvider';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://qapinda.az';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Qapında — Sevdiyin yeməklər, qapında',
    template: '%s · Qapında',
  },
  description:
    'Şəhərin restoranlarından yemək sifariş edin. Qapıda nağd və ya kartla ödəyin. Restoranlar öz kuryeri ilə çatdırır.',
  applicationName: 'Qapında',
  openGraph: {
    type: 'website',
    siteName: 'Qapında',
    locale: 'az_AZ',
    title: 'Qapında — Sevdiyin yeməklər, qapında',
    description: 'Şəhərin restoranlarından yemək sifariş edin.',
  },
  robots: { index: true, follow: true },

  /**
   * The installable-app half.
   *
   * `manifest` is what makes a browser offer "Add to home screen" and what a
   * restaurant tablet needs before it can stop being a browser tab. The Apple
   * entries beside it are not decoration: iOS ignores the manifest almost
   * entirely and reads these instead, so without them an installed Qapında on
   * an iPhone shows a screenshot of the page as its icon and keeps Safari's
   * chrome around it.
   */
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Qapında',
    // Matches the header, so the status bar does not sit on a colour of its own.
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#b4321f',
  width: 'device-width',
  initialScale: 1,
  // The bottom bar sits on the safe area; zoom must still work.
  maximumScale: 5,
  /*
   * Draw under the notch when installed.
   *
   * Only takes effect in a standalone window, where there is no browser chrome
   * to fill the space. The layout already pads for `env(safe-area-inset-*)`, so
   * this is what turns that padding from decoration into the thing keeping the
   * bottom bar off an iPhone's home indicator.
   */
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="az" className="h-full">
      <body className="min-h-full">
        <LocaleProvider>
          <AuthProvider>
            <FavouritesProvider>
              <RegionProvider>
                <CartProvider>
                  <ConfigNotice />
                  {/* One AudioContext for the whole session, started above every
                      route change — see the component for why that matters. */}
                  <NotificationSoundProvider />
                  {children}
                  <CookieConsent />
                </CartProvider>
              </RegionProvider>
            </FavouritesProvider>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
