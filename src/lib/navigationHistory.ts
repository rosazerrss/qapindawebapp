'use client';

/**
 * Whether "back" has somewhere of ours to go to.
 *
 * `router.back()` is the right way home when the person clicked into this
 * screen from somewhere else in the app — it returns them to that exact spot,
 * search text and filters intact. It is the wrong way home when this screen is
 * where their browsing session started: opened from a push notification, a
 * shared link, or typed straight into the address bar. There `back()` walks
 * out of Qapında entirely (or, worse, does nothing), and the button has to
 * fall back to an explicit route instead.
 *
 * The browser exposes no "how many of these history entries are ours" API, so
 * this counts them itself. `AppShell` reports every pathname it renders;
 * anything after the first one seen in this tab is a real in-app navigation.
 * The count lives in `sessionStorage` rather than a module variable so a hard
 * refresh of a deep page does not forget the history that is genuinely still
 * behind it — only a fresh tab (a fresh `sessionStorage`) starts back at zero,
 * which is exactly the notification/shared-link case this exists to catch.
 */
const DEPTH_KEY = 'qapinda:navDepth';

// The pathname most recently reported, kept outside storage: it is only ever
// compared against the very next report from the same tab, so it does not
// need to survive a reload — and if it did, a refresh of the current page
// would look like a "navigation" to the same address and inflate the count.
let lastPathname: string | null = null;

/** Called by `AppShell` whenever the pathname it is rendering changes. */
export function reportPathname(pathname: string): void {
  if (lastPathname === null) {
    // The first pathname this tab has rendered is where the session started,
    // not something navigated to — it must not count as history.
    lastPathname = pathname;
    return;
  }
  if (pathname === lastPathname) return;
  lastPathname = pathname;

  try {
    const depth = Number(sessionStorage.getItem(DEPTH_KEY) ?? '0');
    sessionStorage.setItem(DEPTH_KEY, String(depth + 1));
  } catch {
    // Private browsing or storage disabled — the back button below falls back
    // to its explicit route instead, which is always correct, just not always
    // the most specific place to land.
  }
}

/** Is there an in-app screen for `router.back()` to return to? */
export function hasInAppHistory(): boolean {
  try {
    return Number(sessionStorage.getItem(DEPTH_KEY) ?? '0') > 0;
  } catch {
    return false;
  }
}
