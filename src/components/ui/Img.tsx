'use client';

/**
 * QAPINDA — Two ways to show a picture without naming Google.
 *
 * WHY THERE ARE TWO
 * -----------------
 * The platform's images fall into two groups with genuinely different answers,
 * and using one mechanism for both would be wrong in one direction or the
 * other.
 *
 * PUBLIC — a restaurant's logo and cover, a dish photo, an avatar. Anybody may
 * see these; they appear sixty at a time on a menu; they should be cached by
 * the browser and by the CDN, and they have to render server-side so the
 * shopfront is not a page of empty boxes on first paint. `<Img>` handles these
 * by pointing at `/m/…` on our own domain.
 *
 * PRIVATE — a complaint photograph, a support attachment, a licence document.
 * Only a signed-in operator or the right restaurant may read these, and that
 * decision belongs to the storage rules. They appear one or two at a time,
 * inside a panel, behind a login. `<SecureImage>` handles these by fetching the
 * bytes in the browser and rendering a `blob:` URL — no Google hostname on
 * screen, and the rules still decide who may read.
 *
 * WHY NOT PROXY THE PRIVATE ONES TOO
 * ----------------------------------
 * Because the proxy reads with the server's own credentials. Anything it agrees
 * to serve, it serves to everyone. Routing a complaint photo through it would
 * take a file the rules restrict to signed-in accounts and publish it to the
 * internet, which is a far worse outcome than a hostname in an address bar.
 *
 * WHY NOT USE BLOBS FOR EVERYTHING
 * --------------------------------
 * A `blob:` URL is created per page load and cached by nothing. A menu of sixty
 * photographs would re-download every one on every visit, and none of them
 * would exist during server rendering.
 */

import { useEffect, useState, type ImgHTMLAttributes } from 'react';

import { mediaSrc } from '@/shared/media';

type ImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | null | undefined;
};

/**
 * A public image, served from our own domain.
 *
 * A drop-in replacement for `<img>`: anything that is not a Firebase Storage
 * URL — a data URI, a relative path, an image somewhere else — passes through
 * untouched, so this is safe to use everywhere rather than only where a storage
 * URL is expected.
 */
export function Img({ src, alt = '', width, height, loading, decoding, ...rest }: ImgProps) {
  const resolved = mediaSrc(src);
  if (!resolved) return null;

  /*
   * A plain `<img>`, deliberately.
   *
   * `next/image` would fetch the picture through its own optimiser, which means
   * a second round trip and — the part that matters here — the original URL
   * handed back to the browser as a query parameter, putting the Google
   * hostname straight back into the page this component exists to keep it out
   * of. The proxy is the optimiser: it is on our CDN and the files are
   * immutable.
   */
  /*
   * `width`, `height`, `loading` and `decoding`, with sane defaults.
   *
   * WHY THE DIMENSIONS MATTER MORE THAN THEY LOOK
   * ---------------------------------------------
   * A plain `<img>` with no intrinsic size occupies zero height until the file
   * arrives, and then suddenly occupies its real height. Every dish below it
   * jumps down the page at that moment. On a menu of forty pictures on a slow
   * connection the whole list shifts under the reader's thumb repeatedly — and
   * a tap that lands during a shift opens the wrong dish, which on a food app
   * ends up in somebody's basket.
   *
   * The numbers do not have to be the displayed size; the browser needs only
   * the RATIO to reserve the right box, and CSS still decides how large it
   * actually draws. 4:3 is what every card in this app uses.
   *
   * `loading="lazy"` keeps a forty-item menu from fetching forty pictures at
   * once, and `decoding="async"` keeps the decode off the main thread. Both are
   * overridable, because the restaurant's cover image at the top of the page is
   * exactly the one picture that should NOT be lazy.
   */
  /* eslint-disable-next-line @next/next/no-img-element -- see the note above */
  return (
    <img
      src={resolved}
      alt={alt}
      width={width ?? 400}
      height={height ?? 300}
      loading={loading ?? 'lazy'}
      decoding={decoding ?? 'async'}
      {...rest}
    />
  );
}

/**
 * A picture only a signed-in account may see.
 *
 * Fetched by the browser, as that account, so Firebase Storage applies exactly
 * the rule it applies today — and rendered from a `blob:` URL, so the address
 * bar shows nothing about where it came from.
 *
 * The object URL is revoked when the component goes away. Without that, a
 * support conversation with thirty photographs in it leaks thirty images' worth
 * of memory for as long as the tab is open.
 */
export function SecureImage({
  src,
  alt = '',
  ...rest
}: ImgProps) {
  /**
   * One piece of state, stamped with the URL it belongs to.
   *
   * Three separate `useState` calls would need resetting at the top of the
   * effect every time `src` changed, and setting state synchronously inside an
   * effect is a cascading render — the lint rule that forbids it is right. With
   * the source recorded alongside the result, "is this answer about the picture
   * we are being asked for" is a comparison during render instead, and stale
   * state from a previous URL can never be shown.
   */
  const [state, setState] = useState<{ for: string; url: string | null; failed: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (!src) return;

    let live = true;
    let created: string | null = null;
    const controller = new AbortController();

    void fetch(src, { signal: controller.signal })
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error('refused'))))
      .then((blob) => {
        if (!live) return;
        created = URL.createObjectURL(blob);
        setState({ for: src, url: created, failed: false });
      })
      .catch(() => {
        // A refusal by the storage rules, an expired token, a dead connection.
        // None is actionable by the person looking at the screen, and all three
        // have the same honest answer: this picture cannot be shown.
        if (live && !controller.signal.aborted) setState({ for: src, url: null, failed: true });
      });

    return () => {
      live = false;
      controller.abort();
      // Without this a support conversation with thirty photographs in it leaks
      // thirty images' worth of memory for as long as the tab is open.
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);

  if (!src) return null;

  // Anything the state says about a different URL is not an answer about this
  // one — during a change of `src` it is last picture's answer.
  const current = state?.for === src ? state : null;

  if (current?.failed) return null;

  if (!current?.url) {
    // A placeholder of the same shape, so a grid of photographs does not jump
    // as each one lands.
    return (
      <span
        className={rest.className}
        aria-hidden
        style={{ background: 'var(--color-ink-100, #eee)' }}
      />
    );
  }

  /*
   * NO LINK, NO NEW TAB, NO SAVE — and the reasoning, because this looks like
   * a feature being removed.
   *
   * These pictures are evidence in somebody else's complaint: a receipt, a
   * wrong dish, sometimes a document. They are shown to the operator or the
   * restaurant who has to act on them, and to nobody else, for as long as that
   * screen is open. Anything that turns one into a FILE — an anchor, a
   * right-click "save image as", a long-press "download" — turns a picture the
   * platform is showing into a copy the viewer keeps, and a copy the viewer
   * keeps is outside every rule this system has.
   *
   * So:
   *   • no anchor wrapper, so there is nothing to middle-click or "open in new
   *     tab";
   *   • `onContextMenu` prevented, which removes the browser's own save and
   *     copy entries;
   *   • `draggable={false}`, because dragging an image onto the desktop is a
   *     save with no menu;
   *   • `user-select: none` and `-webkit-touch-callout: none`, which is what
   *     stops iOS Safari's long-press sheet — the one route that is otherwise
   *     open on the device most of these are viewed on.
   *
   * None of this is a security boundary and it is not pretending to be one:
   * anybody determined can screenshot, and the bytes are in the browser because
   * the browser is drawing them. It removes the ACCIDENTAL and the CASUAL copy,
   * which is what actually happens — an operator opening a photo in a tab that
   * then sits in their history, or a long-press that saves a stranger's
   * receipt into a personal camera roll.
   */
  /* eslint-disable-next-line @next/next/no-img-element -- A blob URL cannot go
     through `next/image`, which is the entire point of this component. */
  return (
    <img
      src={current.url}
      alt={alt}
      draggable={false}
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
      {...rest}
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        ...rest.style,
      }}
    />
  );
}
