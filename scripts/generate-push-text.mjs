/**
 * QAPINDA — The one thing the server is allowed to know how to say.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * `notify()` stores a translation *key* and its parameters, never a finished
 * sentence, and the comment there explains why at length: the dictionaries ship
 * with the web app, and a second copy living beside the Cloud Functions would
 * drift from the first. That is right, and it stays right.
 *
 * A push notification breaks the arrangement, because the banner is drawn by
 * the operating system from text the *server* sent. There is no page to look a
 * key up in — the phone may not have opened Qapında for a week.
 *
 * So the server does need the sentences. What it must not have is a second copy
 * somebody maintains by hand. This script makes the copy *generated*: it lifts
 * the `notifications.*` subtree out of the three dictionaries into one file the
 * functions import, and it runs as part of the build. `tests/pushText.test.ts`
 * fails if the generated file has fallen behind, so the copy cannot rot in
 * silence — which is the only failure mode that mattered.
 *
 * Only the pushable types are emitted. There is no reason to ship the server
 * sixty-nine sentences it will never send.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LOCALES = ['az', 'ru', 'en'];
const OUT = resolve(root, 'functions/src/generated/pushText.ts');

/** Read `PUSHABLE` out of the shared module rather than restating the list. */
function pushableTypes() {
  const source = readFileSync(resolve(root, 'shared/push.ts'), 'utf8');
  const block = source.slice(
    source.indexOf('export const PUSHABLE'),
    source.indexOf('];', source.indexOf('export const PUSHABLE')),
  );
  return [...block.matchAll(/NotificationType\.([A-Z_]+)/g)].map((match) => match[1]);
}

function build() {
  const types = pushableTypes();
  if (types.length === 0) throw new Error('no pushable types found in shared/push.ts');

  const table = {};

  for (const locale of LOCALES) {
    const dictionary = JSON.parse(
      readFileSync(resolve(root, `src/i18n/translations/${locale}.json`), 'utf8'),
    );
    const notifications = dictionary.notifications ?? {};

    table[locale] = {};

    for (const type of types) {
      const entry = notifications[type];
      if (!entry?.title || !entry?.body) {
        throw new Error(`${locale}.json has no notifications.${type} title/body`);
      }
      table[locale][type] = { title: entry.title, body: entry.body };
    }
  }

  const banner = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Written by \`scripts/generate-push-text.mjs\` from the three dictionaries in
 * \`src/i18n/translations\`, which remain the only place these sentences are
 * written by a person. Run \`npm run generate:push\` — or any build, which does
 * it for you — after changing a notification's wording.
 *
 * It exists because a push banner is drawn by the operating system from text
 * the server sent: there is no page to look a translation key up in when the
 * phone has not opened Qapında for a week. \`tests/pushText.test.ts\` fails if
 * this file has fallen behind the dictionaries.
 */

export interface PushSentence {
  title: string;
  body: string;
}

export const PUSH_TEXT: Record<string, Record<string, PushSentence>> =`;

  const body = `${banner} ${JSON.stringify(table, null, 2)};\n`;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, body);

  return { types: types.length, locales: LOCALES.length };
}

const result = build();
console.log(
  `✅ push mətnləri → functions/src/generated/pushText.ts (${result.types} tip × ${result.locales} dil)`,
);
