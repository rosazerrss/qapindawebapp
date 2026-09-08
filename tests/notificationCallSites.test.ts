import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { NotificationType, UserRole } from '../shared/enums';
import { NOTIFICATION_SPEC, roleMayReceive } from '../shared/notifications';

/**
 * Every place the server writes a notification, checked against the table.
 *
 * WHY THIS IS A SOURCE SCAN AND NOT A UNIT TEST
 * ---------------------------------------------
 * `notify()` and `notifyIn()` both ask `roleMayReceive` before they write, so a
 * call site that addresses a customer with a type no customer can receive does
 * not produce a wrong notification — it produces NO notification, silently, and
 * goes on doing that for as long as nobody opens the file. That is exactly what
 * removing the seven order-status types could have left behind: half a dozen
 * `notify({ role: CUSTOMER, type: ORDER_DELIVERED })` calls that compile, run,
 * cost a user-document read each, and mean nothing.
 *
 * So this reads the functions' own source and refuses that state. It is
 * deliberately crude — it matches the literal `role:` and `type:` inside each
 * `notify*` call — because the alternative is a test that needs the emulator,
 * and a call site written with a computed type is one this cannot see. Every
 * call site in this codebase names both literally today, and the test asserts
 * that it found a realistic number of them, so gutting the scan is not a way to
 * make it pass.
 */

const FUNCTIONS_SRC = 'functions/src';

/** Every .ts under `functions/src`, except the synced copy of `/shared`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === 'shared' ? [] : sourceFiles(path);
    }
    return path.endsWith('.ts') ? [path] : [];
  });
}

interface CallSite {
  file: string;
  fn: string;
  role: string | null;
  type: string;
}

/** The argument list of one `name(...)` call, by counting brackets. */
function callArguments(source: string, openParen: number): string {
  let depth = 0;
  for (let at = openParen; at < source.length; at += 1) {
    const char = source[at];
    if (char === '(' || char === '{' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(openParen + 1, at);
    }
  }
  return '';
}

function callSites(): CallSite[] {
  const found: CallSite[] = [];
  // `notifyPlatform` is `notifyOperators` under the name the admin-only
  // application alert reads better with; both fan out to the same roster.
  const pattern = /\b(notify|notifyIn|notifyOperators|notifyPlatform)\(/g;

  for (const file of sourceFiles(FUNCTIONS_SRC)) {
    const source = readFileSync(file, 'utf8');

    for (const match of source.matchAll(pattern)) {
      // The definitions and the re-exports, not the calls.
      const before = source.slice(Math.max(0, match.index - 20), match.index);
      if (/function\s+$|export\s+$/.test(before)) continue;

      const args = callArguments(source, match.index + match[0].length - 1);
      const type = /\btype:\s*NotificationType\.([A-Z_]+)/.exec(args);
      if (!type) continue;

      const role = /\brole:\s*UserRole\.([A-Z_]+)/.exec(args);
      found.push({ file, fn: match[1], role: role ? role[1] : null, type: type[1] });
    }
  }

  return found;
}

describe('every notification the server writes', () => {
  const sites = callSites();

  it('finds the call sites at all', () => {
    // A scan that quietly matched nothing would pass every assertion below.
    expect(sites.length).toBeGreaterThan(8);
  });

  it('names a type that still exists', () => {
    const unknown = sites
      .filter((site) => !Object.hasOwn(NOTIFICATION_SPEC, site.type))
      .map((site) => `${site.file}: ${site.type}`);
    expect(unknown).toEqual([]);
  });

  it('never addresses a role that can no longer receive that type', () => {
    /*
     * The rule the customer's order-status removal has to keep: a call site
     * addressed to a role outside the type's audience writes nothing, so it is
     * dead code that looks alive. Whichever way round it was introduced — the
     * type narrowed, or the call site widened — this is where it surfaces.
     */
    const wrong = sites
      .filter((site) => site.role !== null)
      .filter((site) => !roleMayReceive(site.role as UserRole, site.type as NotificationType))
      .map((site) => `${site.file}: ${site.fn}(role: ${site.role}, type: ${site.type})`);

    expect(wrong).toEqual([]);
  });

  it('raises no operator alert that reaches neither an operator nor the admin', () => {
    // `notifyOperators` fans out over the platform roster and lets
    // `roleMayReceive` decide who is actually in the audience. An alert nobody
    // on that roster may receive is a phone call nobody is ever going to make.
    const unheard = sites
      .filter((site) => site.fn === 'notifyOperators' || site.fn === 'notifyPlatform')
      .filter(
        (site) =>
          !roleMayReceive(UserRole.OPERATOR, site.type as NotificationType) &&
          !roleMayReceive(UserRole.SUPER_ADMIN, site.type as NotificationType),
      )
      .map((site) => `${site.file}: ${site.type}`);

    expect(unheard).toEqual([]);
  });

  it('sends nothing at all to a customer about the progress of their order', () => {
    // The owner's instruction, read back off the server's own source.
    const toCustomers = sites
      .filter((site) => site.role === 'CUSTOMER')
      .map((site) => site.type);

    for (const type of toCustomers) {
      expect(
        NOTIFICATION_SPEC[type as NotificationType].audience,
        `${type} is sent to a customer`,
      ).toContain('CUSTOMER');
    }

    // And the order-status family is not merely unaddressed, it is gone.
    for (const type of ['ORDER_ACCEPTED', 'ORDER_DELIVERED', 'ORDER_DELAYED', 'ORDER_PLACED']) {
      expect(Object.hasOwn(NOTIFICATION_SPEC, type), `${type} still exists`).toBe(false);
    }
  });
});
