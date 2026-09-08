import type { NextConfig } from 'next';

/**
 * Cloud Shell serves the dev server through a proxy host that sits two labels
 * below `cloudshell.dev`, which a single-level wildcard does not match — hence
 * the explicit hostname alongside the patterns.
 *
 * `NEXT_PUBLIC_DEV_ORIGIN` lets a new Cloud Shell session add its own host
 * without editing this file: the preview URL changes every time the VM is
 * recreated.
 *
 * All of this affects the development server only. A production build ignores
 * `allowedDevOrigins` entirely.
 */
const devOrigins = [
  '*.cloudshell.dev',
  '*.cs-europe-west4-bhnf.cloudshell.dev',
  '*.app.github.dev',
  process.env.NEXT_PUBLIC_DEV_ORIGIN,
].filter((entry): entry is string => Boolean(entry));

/**
 * A build id that does not change unless the source does.
 *
 * WHY THIS EXISTS — AND IT IS NOT A MICRO-OPTIMISATION
 * ---------------------------------------------------
 * Next.js generates a random build id per build and writes it into every one of
 * the seventy-two prerendered HTML files. Deploy the same unchanged source
 * twice and Firebase Hosting sees a hundred and forty-odd *different* files,
 * because the bytes differ even though nothing meaningful does.
 *
 * On a good connection nobody notices. On one that drops part-way through an
 * upload it is fatal, and it was: a retry loop uploaded ten files, the next
 * attempt rebuilt with a fresh id, and those ten were stale again. The deploy
 * hovered around a hundred remaining files for an hour without ever
 * approaching zero — not because the network was hopeless, but because the
 * target moved every time.
 *
 * With a content-derived id the same source produces byte-identical output, so
 * every file that reaches Firebase STAYS reached and a retry resumes instead of
 * restarting. It is also correct for caching: the id changes exactly when the
 * code changes, which is what a build id is for.
 *
 * `BUILD_ID` in the environment overrides it, for a CI system that would rather
 * use a commit hash.
 */
function contentBuildId(): string {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;

  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const { readdirSync, readFileSync, statSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');

  const hash = createHash('sha256');

  /** Every file under a directory, in a fixed order — sorted, so it is stable. */
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // A directory that is not in this checkout is simply skipped.
    }

    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (statSync(full).isFile()) {
        // The path as well as the bytes: a renamed file is a changed build.
        hash.update(full);
        hash.update(readFileSync(full));
      }
    }
  };

  for (const dir of ['src', 'shared', 'public']) walk(dir);
  for (const file of ['package.json', 'package-lock.json', 'next.config.ts']) {
    try {
      hash.update(readFileSync(file));
    } catch {
      // Not present in every environment; skipping keeps the id derivable.
    }
  }

  // Base36, trimmed to the length Next's own ids use. Long enough that two
  // different builds colliding is not a thing that happens.
  return `q${BigInt('0x' + hash.digest('hex').slice(0, 20)).toString(36)}`;
}


/**
 * QAPINDA — the Azerbaijani routes, kept alive as redirects.
 *
 * WHY EVERY SINGLE ONE IS LISTED
 * ------------------------------
 * The routes moved to English (`/hesabim` → `/account`, `/restoran-paneli` →
 * `/panel`, and so on down to the last settings page). Renaming a URL is not a
 * cosmetic change: the old one is written down in places this codebase does not
 * control and cannot edit.
 *
 *   • Every push notification ALREADY DELIVERED carries a link like
 *     `/sifarislerim/abc123`. Tapping it must still open that order.
 *   • Restaurant staff have the panel bookmarked; a kitchen tablet may have it
 *     as its home page.
 *   • Google has been given a sitemap naming `/restoran/<slug>`.
 *   • The owner has sent links to partners over WhatsApp.
 *
 * A 308 tells a browser and a crawler that the move is permanent and that the
 * new address inherits whatever the old one had earned. Anything less — a 404,
 * or no rule at all — silently breaks all four of those at once, and the only
 * symptom is people quietly not arriving.
 *
 * The `:path*` twin under each entry carries the children along, because the
 * segments BELOW a renamed root were renamed too: `/hesabim/unvanlar` is not
 * reachable by rewriting only its first segment. Longest source first, so the
 * specific rule is matched before the general one.
 *
 * These stay. They cost one lookup on a request that would otherwise fail, and
 * the day they are deleted is the day an old notification stops working.
 */
const LEGACY_ROUTES = [
  // The legal documents are a dynamic route, so they are not in the directory
  // sweep above — and their slugs moved too. Listed before `/huquqi/:path*` so
  // the specific answer wins; a link in the footer of an old email is exactly
  // the kind of thing that outlives a rename.
  { source: '/huquqi/istifade-sertleri', destination: '/legal/terms', permanent: true },
  { source: '/huquqi/mexfilik', destination: '/legal/privacy', permanent: true },
  { source: '/huquqi/kuki', destination: '/legal/cookies', permanent: true },
  { source: '/legal/istifade-sertleri', destination: '/legal/terms', permanent: true },
  { source: '/legal/mexfilik', destination: '/legal/privacy', permanent: true },
  { source: '/legal/kuki', destination: '/legal/cookies', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/bildirisler', destination: '/qapinda-idare-merkezi-7xk4m2/settings/notifications', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/bildirisler/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/settings/notifications/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/odenisler', destination: '/qapinda-idare-merkezi-7xk4m2/settings/payments', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/odenisler/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/settings/payments/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/platforma', destination: '/qapinda-idare-merkezi-7xk4m2/settings/platform', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/platforma/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/settings/platform/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/tehlukeli', destination: '/qapinda-idare-merkezi-7xk4m2/settings/danger', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/tehlukeli/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/settings/danger/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/hesab-kilidleri', destination: '/qapinda-idare-merkezi-7xk4m2/account-locks', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/hesab-kilidleri/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/account-locks/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/destek', destination: '/qapinda-idare-merkezi-7xk4m2/settings/support', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/destek/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/settings/support/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/umumi', destination: '/qapinda-idare-merkezi-7xk4m2/settings/general', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/umumi/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/settings/general/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/istifadeciler', destination: '/qapinda-idare-merkezi-7xk4m2/users', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/istifadeciler/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/users/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/bank', destination: '/qapinda-idare-merkezi-7xk4m2/settings/bank', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/bank/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/settings/bank/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/vaxt', destination: '/qapinda-idare-merkezi-7xk4m2/settings/timing', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/vaxt/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/settings/timing/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/bildirisler', destination: '/qapinda-idare-merkezi-7xk4m2/notifications', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/bildirisler/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/notifications/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/restoranlar', destination: '/qapinda-idare-merkezi-7xk4m2/restaurants', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/restoranlar/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/restaurants/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/sifarisler', destination: '/qapinda-idare-merkezi-7xk4m2/orders', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/sifarisler/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/orders/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/sikayetler', destination: '/qapinda-idare-merkezi-7xk4m2/complaints', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/sikayetler/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/complaints/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/odenisler', destination: '/qapinda-idare-merkezi-7xk4m2/payments', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/odenisler/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/payments/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/kuponlar', destination: '/qapinda-idare-merkezi-7xk4m2/coupons', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/kuponlar/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/coupons/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar', destination: '/qapinda-idare-merkezi-7xk4m2/settings', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/ayarlar/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/settings/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/maliyye', destination: '/qapinda-idare-merkezi-7xk4m2/finance', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/maliyye/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/finance/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/destek', destination: '/qapinda-idare-merkezi-7xk4m2/support', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/destek/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/support/:path*', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/reyler', destination: '/qapinda-idare-merkezi-7xk4m2/reviews', permanent: true },
  { source: '/qapinda-idare-merkezi-7xk4m2/reyler/:path*', destination: '/qapinda-idare-merkezi-7xk4m2/reviews/:path*', permanent: true },
  { source: '/restoran-paneli/ayarlar/bildirisler', destination: '/panel/settings/notifications', permanent: true },
  { source: '/restoran-paneli/ayarlar/bildirisler/:path*', destination: '/panel/settings/notifications/:path*', permanent: true },
  { source: '/restoran-paneli/ayarlar/is-saatlari', destination: '/panel/settings/hours', permanent: true },
  { source: '/restoran-paneli/ayarlar/is-saatlari/:path*', destination: '/panel/settings/hours/:path*', permanent: true },
  { source: '/restoran-paneli/ayarlar/tehvil-kodu', destination: '/panel/settings/handover-code', permanent: true },
  { source: '/restoran-paneli/ayarlar/tehvil-kodu/:path*', destination: '/panel/settings/handover-code/:path*', permanent: true },
  { source: '/restoran-paneli/ayarlar/catdirilma', destination: '/panel/settings/delivery', permanent: true },
  { source: '/restoran-paneli/ayarlar/catdirilma/:path*', destination: '/panel/settings/delivery/:path*', permanent: true },
  { source: '/restoran-paneli/ayarlar/printerler', destination: '/panel/settings/printers', permanent: true },
  { source: '/restoran-paneli/ayarlar/printerler/:path*', destination: '/panel/settings/printers/:path*', permanent: true },
  { source: '/restoran-paneli/ayarlar/gorunus', destination: '/panel/settings/appearance', permanent: true },
  { source: '/restoran-paneli/ayarlar/gorunus/:path*', destination: '/panel/settings/appearance/:path*', permanent: true },
  { source: '/restoran-paneli/ayarlar/odenis', destination: '/panel/settings/payment', permanent: true },
  { source: '/restoran-paneli/ayarlar/odenis/:path*', destination: '/panel/settings/payment/:path*', permanent: true },
  { source: '/restoran-paneli/ayarlar/profil', destination: '/panel/settings/profile', permanent: true },
  { source: '/restoran-paneli/ayarlar/profil/:path*', destination: '/panel/settings/profile/:path*', permanent: true },
  { source: '/hesabim/ayarlar/geri-bildirim', destination: '/account/settings/feedback', permanent: true },
  { source: '/hesabim/ayarlar/geri-bildirim/:path*', destination: '/account/settings/feedback/:path*', permanent: true },
  { source: '/restoran-paneli/ayarlar/mekan', destination: '/panel/settings/location', permanent: true },
  { source: '/restoran-paneli/ayarlar/mekan/:path*', destination: '/panel/settings/location/:path*', permanent: true },
  { source: '/operator/ayarlar/bildirisler', destination: '/operator/settings/notifications', permanent: true },
  { source: '/operator/ayarlar/bildirisler/:path*', destination: '/operator/settings/notifications/:path*', permanent: true },
  { source: '/hesabim/ayarlar/bildirisler', destination: '/account/settings/notifications', permanent: true },
  { source: '/hesabim/ayarlar/bildirisler/:path*', destination: '/account/settings/notifications/:path*', permanent: true },
  { source: '/restoran-paneli/ayarlar/dil', destination: '/panel/settings/language', permanent: true },
  { source: '/restoran-paneli/ayarlar/dil/:path*', destination: '/panel/settings/language/:path*', permanent: true },
  { source: '/restoran-paneli/bildirisler', destination: '/panel/notifications', permanent: true },
  { source: '/restoran-paneli/bildirisler/:path*', destination: '/panel/notifications/:path*', permanent: true },
  { source: '/kuryer/ayarlar/bildirisler', destination: '/courier/settings/notifications', permanent: true },
  { source: '/kuryer/ayarlar/bildirisler/:path*', destination: '/courier/settings/notifications/:path*', permanent: true },
  { source: '/restoran-paneli/hesablasma', destination: '/panel/settlement', permanent: true },
  { source: '/restoran-paneli/hesablasma/:path*', destination: '/panel/settlement/:path*', permanent: true },
  { source: '/restoran-paneli/sikayetler', destination: '/panel/complaints', permanent: true },
  { source: '/restoran-paneli/sikayetler/:path*', destination: '/panel/complaints/:path*', permanent: true },
  { source: '/hesabim/ayarlar/suallar', destination: '/account/settings/faq', permanent: true },
  { source: '/hesabim/ayarlar/suallar/:path*', destination: '/account/settings/faq/:path*', permanent: true },
  { source: '/restoran-paneli/ayarlar', destination: '/panel/settings', permanent: true },
  { source: '/restoran-paneli/ayarlar/:path*', destination: '/panel/settings/:path*', permanent: true },
  { source: '/restoran-paneli/hesabat', destination: '/panel/reports', permanent: true },
  { source: '/restoran-paneli/hesabat/:path*', destination: '/panel/reports/:path*', permanent: true },
  { source: '/restoran-paneli/isciler', destination: '/panel/staff', permanent: true },
  { source: '/restoran-paneli/isciler/:path*', destination: '/panel/staff/:path*', permanent: true },
  { source: '/restoran-paneli/destek', destination: '/panel/support', permanent: true },
  { source: '/restoran-paneli/destek/:path*', destination: '/panel/support/:path*', permanent: true },
  { source: '/restoran-paneli/reyler', destination: '/panel/reviews', permanent: true },
  { source: '/restoran-paneli/reyler/:path*', destination: '/panel/reviews/:path*', permanent: true },
  { source: '/restoran-paneli/menyu', destination: '/panel/menu', permanent: true },
  { source: '/restoran-paneli/menyu/:path*', destination: '/panel/menu/:path*', permanent: true },
  { source: '/restoran-paneli/satis', destination: '/panel/sales', permanent: true },
  { source: '/restoran-paneli/satis/:path*', destination: '/panel/sales/:path*', permanent: true },
  { source: '/operator/bildirisler', destination: '/operator/notifications', permanent: true },
  { source: '/operator/bildirisler/:path*', destination: '/operator/notifications/:path*', permanent: true },
  { source: '/hesabim/secilmisler', destination: '/account/favourites', permanent: true },
  { source: '/hesabim/secilmisler/:path*', destination: '/account/favourites/:path*', permanent: true },
  { source: '/hesabim/kuponlarim', destination: '/account/coupons', permanent: true },
  { source: '/hesabim/kuponlarim/:path*', destination: '/account/coupons/:path*', permanent: true },
  { source: '/kuryer/bildirisler', destination: '/courier/notifications', permanent: true },
  { source: '/kuryer/bildirisler/:path*', destination: '/courier/notifications/:path*', permanent: true },
  { source: '/kuryer/sifarisler', destination: '/courier/orders', permanent: true },
  { source: '/kuryer/sifarisler/:path*', destination: '/courier/orders/:path*', permanent: true },
  { source: '/hesabim/unvanlar', destination: '/account/addresses', permanent: true },
  { source: '/hesabim/unvanlar/:path*', destination: '/account/addresses/:path*', permanent: true },
  { source: '/operator/ayarlar', destination: '/operator/settings', permanent: true },
  { source: '/operator/ayarlar/:path*', destination: '/operator/settings/:path*', permanent: true },
  { source: '/hesabim/ayarlar', destination: '/account/settings', permanent: true },
  { source: '/hesabim/ayarlar/:path*', destination: '/account/settings/:path*', permanent: true },
  { source: '/restoran-paneli', destination: '/panel', permanent: true },
  { source: '/restoran-paneli/:path*', destination: '/panel/:path*', permanent: true },
  { source: '/hesabim/destek', destination: '/account/support', permanent: true },
  { source: '/hesabim/destek/:path*', destination: '/account/support/:path*', permanent: true },
  { source: '/kuryer/ayarlar', destination: '/courier/settings', permanent: true },
  { source: '/kuryer/ayarlar/:path*', destination: '/courier/settings/:path*', permanent: true },
  { source: '/kuryer/hesabim', destination: '/courier/account', permanent: true },
  { source: '/kuryer/hesabim/:path*', destination: '/courier/account/:path*', permanent: true },
  { source: '/restoran-qosul', destination: '/partner', permanent: true },
  { source: '/restoran-qosul/:path*', destination: '/partner/:path*', permanent: true },
  { source: '/kuryer/kecmis', destination: '/courier/history', permanent: true },
  { source: '/kuryer/kecmis/:path*', destination: '/courier/history/:path*', permanent: true },
  { source: '/odenis/ugurlu', destination: '/checkout/success', permanent: true },
  { source: '/odenis/ugurlu/:path*', destination: '/checkout/success/:path*', permanent: true },
  { source: '/sifarislerim', destination: '/orders', permanent: true },
  { source: '/sifarislerim/:path*', destination: '/orders/:path*', permanent: true },
  { source: '/admin-giris', destination: '/admin-login', permanent: true },
  { source: '/admin-giris/:path*', destination: '/admin-login/:path*', permanent: true },
  { source: '/odenis/xeta', destination: '/checkout/failed', permanent: true },
  { source: '/odenis/xeta/:path*', destination: '/checkout/failed/:path*', permanent: true },
  { source: '/restoran', destination: '/restaurant', permanent: true },
  { source: '/restoran/:path*', destination: '/restaurant/:path*', permanent: true },
  { source: '/hesabim', destination: '/account', permanent: true },
  { source: '/hesabim/:path*', destination: '/account/:path*', permanent: true },
  { source: '/huquqi', destination: '/legal', permanent: true },
  { source: '/huquqi/:path*', destination: '/legal/:path*', permanent: true },
  { source: '/kuryer', destination: '/courier', permanent: true },
  { source: '/kuryer/:path*', destination: '/courier/:path*', permanent: true },
  { source: '/odenis', destination: '/checkout', permanent: true },
  { source: '/odenis/:path*', destination: '/checkout/:path*', permanent: true },
  { source: '/axtar', destination: '/search', permanent: true },
  { source: '/axtar/:path*', destination: '/search/:path*', permanent: true },
  { source: '/giris', destination: '/login', permanent: true },
  { source: '/giris/:path*', destination: '/login/:path*', permanent: true },
  { source: '/sebet', destination: '/cart', permanent: true },
  { source: '/sebet/:path*', destination: '/cart/:path*', permanent: true },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
  generateBuildId: async () => contentBuildId(),
  redirects: async () => LEGACY_ROUTES,
};

export default nextConfig;
