/**
 * Pictures, and the address they are served from.
 *
 * THE TEST THAT MATTERS MOST IS THE SECOND BLOCK.
 *
 * `/m/` reads objects with the SERVER'S credentials, so anything it agrees to
 * serve is served to the entire internet regardless of what `storage.rules`
 * says. `isProxyablePath` is the only thing between that route and a stranger
 * downloading a restaurant's tax documents. Everything else in this file is
 * about a hostname; that one is about a security hole.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import { isPrivateMedia, isProxyablePath, mediaSrc, storageObjectPath } from '../shared/media';

const BUCKET = 'qapindanew.firebasestorage.app';
const download = (objectPath: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=abc-123`;

describe('reading the object path out of a storage URL', () => {
  it('decodes the percent-encoded path', () => {
    expect(storageObjectPath(download('restaurants/abc/logo.jpg'))).toBe(
      'restaurants/abc/logo.jpg',
    );
  });

  it('leaves everything that is not a storage URL alone', () => {
    for (const value of [
      null,
      undefined,
      '',
      '/m/restaurants/abc/logo.jpg',
      'data:image/png;base64,iVBORw0KGgo=',
      'https://example.com/photo.jpg',
    ]) {
      expect(storageObjectPath(value)).toBeNull();
    }
  });

  it('survives a malformed escape rather than throwing', () => {
    expect(
      storageObjectPath(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/%E0%A4%A`),
    ).toBeNull();
  });
});

describe('what the proxy may serve', () => {
  it('serves the three things storage.rules already makes public', () => {
    expect(isProxyablePath('restaurants/abc/logo.jpg')).toBe(true);
    expect(isProxyablePath('restaurants/abc/products/xyz.jpg')).toBe(true);
    expect(isProxyablePath('users/uid123/avatar/me.jpg')).toBe(true);
  });

  it('REFUSES everything the rules restrict', () => {
    // Each of these is a real file with a real rule behind it. Serving any one
    // of them here would publish it to anyone who can guess a path — and the
    // last is a business's licence and tax papers.
    expect(isProxyablePath('complaints/uid123/photo.jpg')).toBe(false);
    expect(isProxyablePath('support/uid123/receipt.jpg')).toBe(false);
    expect(isProxyablePath('applications/uid123/licence.pdf')).toBe(false);
  });

  it('refuses the rest of a user’s folder, not only the prefix', () => {
    // `users/` is public ONLY at `users/{uid}/avatar/{file}`. Matching the bare
    // prefix would hand out anything else ever written under a user's folder.
    expect(isProxyablePath('users/uid123/avatar/me.jpg')).toBe(true);
    expect(isProxyablePath('users/uid123/documents/passport.jpg')).toBe(false);
    expect(isProxyablePath('users/uid123/avatar/nested/deep.jpg')).toBe(false);
    expect(isProxyablePath('users/uid123')).toBe(false);
  });

  it('refuses traversal, absolute paths and absurd lengths', () => {
    expect(isProxyablePath('restaurants/../applications/uid/licence.pdf')).toBe(false);
    expect(isProxyablePath('restaurants\\abc\\logo.jpg')).toBe(false);
    expect(isProxyablePath('/restaurants/abc/logo.jpg')).toBe(false);
    expect(isProxyablePath('')).toBe(false);
    expect(isProxyablePath(`restaurants/${'a'.repeat(600)}.jpg`)).toBe(false);
  });
});

describe('what an <img> ends up pointing at', () => {
  it('rewrites a public picture onto our own domain', () => {
    expect(mediaSrc(download('restaurants/abc/logo.jpg'))).toBe('/m/restaurants/abc/logo.jpg');
  });

  it('carries no bucket, no host and no token', () => {
    const result = mediaSrc(download('restaurants/abc/logo.jpg'))!;
    expect(result).not.toContain('firebasestorage');
    expect(result).not.toContain(BUCKET);
    expect(result).not.toContain('token');
  });

  it('encodes each segment separately so the path survives', () => {
    // A whole-string encode would turn the separators into %2F and produce one
    // segment that no route matches.
    const result = mediaSrc(download('restaurants/abc/böyük şəkil.jpg'))!;
    expect(result.startsWith('/m/restaurants/abc/')).toBe(true);
    expect(result.split('/').length).toBe(5);
  });

  it('leaves a private picture untouched', () => {
    // The proxy would refuse it, and a broken thumbnail in an operator's panel
    // is worse than a visible hostname. `SecureImage` is what hides these.
    const url = download('complaints/uid123/photo.jpg');
    expect(mediaSrc(url)).toBe(url);
    expect(isPrivateMedia(url)).toBe(true);
  });

  it('passes through anything it does not recognise', () => {
    // This is what makes it safe to apply everywhere rather than only where a
    // storage URL is expected.
    expect(mediaSrc('data:image/png;base64,iVBORw0KGgo=')).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    );
    expect(mediaSrc('https://lh3.googleusercontent.com/a/photo')).toBe(
      'https://lh3.googleusercontent.com/a/photo',
    );
    expect(mediaSrc(null)).toBeNull();
  });
});

describe('the route itself', () => {
  const route = fs.readFileSync('src/app/m/[...path]/route.ts', 'utf8');

  /**
   * The route with its prose removed.
   *
   * Its comments deliberately NAME what it does not use — "no key file, no
   * `firebase-admin`, nothing added to the bundle" — so a plain search finds
   * those words in the explanation of their absence.
   */
  const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('checks the allowlist before anything else', () => {
    expect(route).toContain('isProxyablePath(objectPath)');
    expect(route).toContain("return new Response('Not found', { status: 404 })");
  });

  it('never reports the difference between missing and forbidden', () => {
    // Passing that difference on would let anyone map the bucket by watching
    // which paths answer 403 and which answer 404.
    expect(code).not.toContain('status: 403');
  });

  it('runs on Node, where the metadata server is reachable', () => {
    expect(route).toContain("export const runtime = 'nodejs'");
  });

  it('adds no SDK to the bundle', () => {
    expect(code).not.toContain('firebase-admin');
    expect(code).not.toContain('@google-cloud/storage');
  });

  it('lets the browser and the CDN cache the bytes', () => {
    // Sixty photographs on a menu page, re-fetched on every visit, is the
    // failure this header prevents.
    expect(route).toContain('immutable');
    expect(route).toContain('ETag');
  });
});

describe('no screen renders a raw storage URL any more', () => {
  const shopfront = [
    'src/app/restaurant/[handle]/RestaurantView.tsx',
    'src/components/customer/RestaurantCard.tsx',
    'src/components/customer/CartUpsell.tsx',
    'src/app/account/favourites/page.tsx',
  ];
  const panels = [
    'src/components/panel/Chat.tsx',
    'src/components/panel/ComplaintsQueue.tsx',
    'src/app/panel/complaints/page.tsx',
  ];

  it('uses the proxy for every public picture', () => {
    for (const file of shopfront) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source, file).toContain('<Img');
      expect(source, file).not.toMatch(/<img\s/);
    }
  });

  it('uses blob URLs for every picture behind a login', () => {
    for (const file of panels) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source, file).toContain('<SecureImage');
      expect(source, file).not.toMatch(/<img\s/);
    }
  });

  it('never links a thumbnail straight at the original', () => {
    // The exact case that started this: opening the evidence in a new tab put
    // Google's hostname and a permanent public token in the address bar.
    for (const file of panels) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source, file).not.toContain('href={url} target="_blank"');
    }
  });
});
