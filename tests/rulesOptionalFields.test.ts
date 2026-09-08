/**
 * QAPINDA — a rule may not read a field that might not be there.
 *
 * THE BUG THIS EXISTS FOR, AND IT REACHED PRODUCTION
 * --------------------------------------------------
 * The products rule was written as:
 *
 *     resource.data.restaurantVisible != false
 *
 * The intention was "absent means visible" — the field is optional, so a dish
 * saved before it existed should read as `true`. That is not what Firestore
 * does. Reading a key that is not present on the document is not `null` and not
 * `undefined`: it is an ERROR, and an error inside a rule DENIES the request.
 *
 * So every dish written before the field existed — which was all of them —
 * failed the rule, the whole menu query was refused, and every restaurant page
 * on the platform said "Burada hələ heç nə yoxdur". The rules deployed cleanly,
 * the code was correct, and 1199 tests passed.
 *
 * `resource.data.get('field', default)` is the form that tolerates an absent
 * key. This test is what makes forgetting it fail here instead of on the
 * shopfront.
 *
 * HOW IT DECIDES WHAT IS OPTIONAL
 * -------------------------------
 * From the models themselves: any `field?:` in `shared/models.ts` is a field
 * some document somewhere does not carry. If a field is optional in ANY model
 * it is treated as optional everywhere, which is deliberately over-strict —
 * `get()` with a sensible default is never wrong, and the cost of a false
 * positive is one safer line.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync('firestore.rules', 'utf8')
  // Comments first: the paragraph above this very rule names the broken form,
  // and a test that matched its own explanation would never pass.
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const models = readFileSync('shared/models.ts', 'utf8');

/** Every `name?:` declared on any interface in the models file. */
const optionalFields = new Set(
  [...models.matchAll(/^\s{2}(\w+)\?:/gm)].map((match) => match[1]),
);

describe('security rules and optional fields', () => {
  it('finds the optional fields at all', () => {
    // Guards against the extraction silently matching nothing and this whole
    // file passing for the wrong reason.
    expect(optionalFields.size).toBeGreaterThan(3);
    expect(optionalFields.has('restaurantVisible')).toBe(true);
  });

  it('never reads an optional field directly', () => {
    const offenders: string[] = [];

    for (const match of rules.matchAll(/resource\.data\.(\w+)/g)) {
      const field = match[1];
      // `get`, `diff`, `keys` and friends are methods on the map, not fields.
      if (['get', 'diff', 'keys', 'values', 'size'].includes(field)) continue;
      if (!optionalFields.has(field)) continue;

      offenders.push(
        `resource.data.${field} — use resource.data.get('${field}', <default>)`,
      );
    }

    expect([...new Set(offenders)]).toEqual([]);
  });
});
