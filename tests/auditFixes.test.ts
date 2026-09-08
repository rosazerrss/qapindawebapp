/**
 * QAPINDA — The decisions the production audit produced.
 *
 * WHY THESE ARE WORTH A FILE OF THEIR OWN
 * ---------------------------------------
 * Every assertion here corresponds to a hole that was found by reading the
 * code, not by anything failing. That is the dangerous kind: a rule widened by
 * one word, a check that names roles instead of asking the permission table, a
 * counter incremented and never decremented. None of them broke a screen, none
 * of them threw, and none of them would have been noticed until somebody was
 * out of pocket.
 *
 * A test that fails when one is undone is the only thing that keeps them fixed.
 *
 * These read source rather than run it — the same limitation the rest of this
 * suite has, and worth restating: they prove a decision is still WRITTEN, not
 * that Firestore or Cloud Functions honour it. Comments are stripped first, so
 * a match is code and never the paragraph explaining the code.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(file, 'utf8');

const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // `[^:]` so a URL's `//` survives — the mistake this same helper made the
    // first time it was written, in `tests/maps.test.ts`.
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const rules = read('firestore.rules');

/** The body of one `match /collection/{doc}` block, children included. */
function blockFor(collection: string): string {
  const start = rules.indexOf(`match /${collection}/{`);
  expect(start, `no rule for ${collection}`).toBeGreaterThan(-1);

  const open = rules.indexOf('{', rules.indexOf('\n', start));
  let depth = 0;
  for (let at = open; at < rules.length; at += 1) {
    if (rules[at] === '{') depth += 1;
    if (rules[at] === '}') {
      depth -= 1;
      if (depth === 0) return rules.slice(start, at + 1);
    }
  }
  throw new Error(`unbalanced braces in ${collection}`);
}

describe('an address is written by the server, never by the browser', () => {
  /*
   * THE MOST EXPENSIVE LINE IN THE AUDIT.
   *
   * `allow read, write: if signedIn() && uid() == userId` reads like a safe
   * self-service rule, and would be, except that the SERVER reads this document
   * and believes it. `phoneVerified` decides whether a courier may be sent to a
   * number; `lat`/`lng` decide the delivery radius and the fee. Both were
   * writable from a console.
   */
  it('refuses a direct write to a saved address', () => {
    const addresses = rules.slice(rules.indexOf('match /addresses/{addressId}'));
    const block = addresses.slice(0, addresses.indexOf('}', addresses.indexOf('allow write')));

    expect(block).toContain('allow write: if false');
    expect(block, 'a browser can write its own phoneVerified again').not.toMatch(
      /allow read, write:/,
    );
  });

  it('still lets the owner read their own addresses', () => {
    const addresses = rules.slice(rules.indexOf('match /addresses/{addressId}'));
    expect(addresses.slice(0, 200)).toContain('allow read: if signedIn() && uid() == userId');
  });
});

describe('bank details and campaigns are the admin\'s, not support\'s', () => {
  it('closes the private restaurant document to an operator', () => {
    // Holds the commission rate, the legal name, the tax id and the payout
    // IBAN. `PLATFORM_VIEW_LEDGER` was taken from OPERATOR for exactly this
    // reason and the rule was not updated with the callables.
    const at = rules.indexOf('match /private/{document}');
    expect(at, 'no private restaurant rule').toBeGreaterThan(-1);
    const priv = rules.slice(at, rules.indexOf('}', rules.indexOf('allow write', at)));

    expect(priv).toContain('allow read: if isSuperAdmin()');
    expect(priv).not.toContain('isPlatform()');
  });

  it('closes coupon redemptions too', () => {
    // They carry `phone`, `deviceId` and `addressHash` — the anti-fraud
    // fingerprints — and belong with the money.
    expect(blockFor('couponRedemptions')).toContain('allow read: if isSuperAdmin()');
  });

  it('masks the IBAN before it reaches the audit log', () => {
    /*
     * The audit log is readable by every operator. Writing the full IBAN into
     * it handed back, through a collection nobody thinks of as financial,
     * exactly what the ledger rules were narrowed to protect.
     */
    const source = code('functions/src/admin/finance.ts');
    expect(source).toContain('maskIban(');
    expect(source, 'the raw IBAN is written to the audit trail again').not.toMatch(
      /newValue: \{ iban, /,
    );
  });

  it('asks the permission table for the settlement, rather than naming roles', () => {
    const source = code('functions/src/admin/finance.ts');
    expect(source).toContain('Permission.PLATFORM_VIEW_LEDGER');
    expect(source, 'getSettlement names roles again').not.toMatch(
      /\['OPERATOR', 'SUPER_ADMIN'\]\.includes/,
    );
  });
});

describe('a review is not a public index of who eats where', () => {
  it('is unreadable from a client', () => {
    // Every review carries `customerId`. `listReviews` strips it; the rule was
    // handing it out beside the callable that was carefully removing it.
    expect(blockFor('reviews')).toContain('allow read, write: if false');
  });
});

describe('a courier is not restaurant staff', () => {
  it('cannot list the restaurant\'s complaints', () => {
    /*
     * The old test was "do you have a restaurantId", and a courier does. The
     * rows carry the customer's telephone number, the complaint text and the
     * photographs — for orders the driver never delivered.
     */
    const source = code('functions/src/complaints/crud.ts');
    expect(source).toContain('RESTAURANT_ROLES');
    expect(source).toMatch(/includes\(caller\.role\)\)\s*\{\s*fail\(AppErrorCode\.FORBIDDEN\)/);
  });
});

describe('the handover code cannot be stepped around', () => {
  it('refuses a restaurant marking DELIVERED when a code is required', () => {
    /*
     * `courierConfirmDelivery` checked the code and `updateOrderStatus` did
     * not — and both write DELIVERED. The code exists for the dispute where the
     * restaurant says delivered and the customer says nobody came, which is
     * precisely the case where it was skippable.
     */
    const source = code('functions/src/orders/status.ts');
    expect(source).toContain('deliveryCodeRequired(');
    expect(source).toContain('AppErrorCode.DELIVERY_CODE_MISSING');
  });

  it('requires ORDER_CANCEL to cancel an accepted order', () => {
    expect(code('functions/src/orders/status.ts')).toContain('Permission.ORDER_CANCEL');
  });

  it('requires RESTAURANT_TOGGLE_SERVICE to close the shop', () => {
    expect(code('functions/src/orders/status.ts')).toContain(
      'Permission.RESTAURANT_TOGGLE_SERVICE',
    );
  });
});

describe('the month-to-date money is not shown to everyone who can see orders', () => {
  it('gates it on a finance permission', () => {
    const source = code('functions/src/orders/status.ts');
    expect(source).toContain('Permission.RESTAURANT_VIEW_FINANCE');
    // Null rather than zero: a panel reading zero would draw "0,00 ₼ this
    // month" at a restaurant that took two hundred orders.
    expect(source).toContain('maySeeMoney');
  });
});

describe('every status change is audited', () => {
  it('no longer audits only the platform', () => {
    /*
     * `if (actor === OrderActor.PLATFORM)` meant a restaurant accepting,
     * rejecting or marking an order delivered — and a customer cancelling one —
     * left no entry anywhere. Those are the events a dispute is about.
     */
    const source = code('functions/src/orders/status.ts');
    expect(source).not.toMatch(/if \(actor === OrderActor\.PLATFORM\) \{\s*auditIn/);
    expect(source).toContain('auditIn(tx, {');
  });

  it('audits a payment reaching PAID', () => {
    const source = code('functions/src/payments/flow.ts');
    expect(source).toContain('AuditAction.PAYMENT_STATUS_CHANGED');
  });
});

describe('a coupon comes back when the order it paid for dies', () => {
  it('has a release path at all', () => {
    // `usedCount` was incremented on creation and decremented nowhere, so an
    // unpaid order could burn a campaign's whole budget for free.
    const source = code('functions/src/lib/coupon.ts');
    expect(source).toMatch(/increment\(-1\)/);
  });

  it('is called from the cancellation path and both expiry sweeps', () => {
    expect(code('functions/src/orders/status.ts')).toContain('releaseCouponIn(');
    expect(code('functions/src/payments/flow.ts')).toContain('releaseCouponIn(');
    expect(code('functions/src/orders/jobs.ts')).toContain('releaseCouponInBatch(');
  });
});

describe('the refund ledger cannot invent a debt', () => {
  it('refuses to post a reversal with no counterpart', () => {
    /*
     * The positive `ONLINE_COLLECTED` entry reverses the negative one written
     * when an order COMPLETES. A refunded order is usually a cancelled one,
     * which never completes — so the reversal was posted alone and the
     * restaurant appeared to owe the platform the full value of an order it
     * never cooked.
     */
    const source = code('functions/src/payments/flow.ts');
    expect(source).toContain('onlineCollectedIdempotencyKey(input.orderId)');
    expect(source).toMatch(/if \(!collected\.exists\) return;/);
  });
});

describe('a waived commission does not also waive the restaurant\'s takings', () => {
  it('still posts the online-collected entry', () => {
    /*
     * Waiving used to `continue` past the whole settlement. For a cash order
     * that is right; for an online one it meant the platform kept the
     * customer's money and never booked the debt — so a restaurant apologised
     * to with a waiver was then never paid for the meal.
     */
    const source = code('functions/src/orders/jobs.ts');
    expect(source).toContain('commissionWaived');
    expect(source).toMatch(/!commissionWaived && !commissionExists\.exists/);
  });
});

describe('unpaid orders and repeat cancellations are bounded', () => {
  it('caps orders sitting at the bank page', () => {
    // `PENDING_PAYMENT` is not an ACTIVE status, so the one-live-order rule did
    // not see it and a script could open them without limit.
    expect(code('functions/src/orders/create.ts')).toContain('MAX_UNPAID_ORDERS');
  });

  it('counts cancellations by telephone number, not only by account', () => {
    // Deleting the account freed the phone immediately, so the seven-day brake
    // was one re-registration away from being reset.
    expect(code('functions/src/orders/create.ts')).toContain("'customerPhone', '=='");
  });
});

describe('the things that fan out are rate limited', () => {
  it('caps open support tickets and message rate', () => {
    // One new ticket notifies every operator and admin, and each notification
    // wakes up to twenty devices.
    const source = code('functions/src/support/chat.ts');
    expect(source).toContain('MAX_OPEN_TICKETS');
    expect(source).toContain('MAX_MESSAGES_PER_MINUTE');
  });

  it('caps verification emails per day', () => {
    // The address comes from the request, so a cooldown alone made this a mail
    // cannon pointed at any inbox, from the platform's own sender domain.
    expect(code('functions/src/users/email.ts')).toContain('EMAIL_CODE_DAILY_LIMIT');
  });
});

describe('a removed staff member loses their token, not just their claim', () => {
  it('revokes refresh tokens when staff change', () => {
    /*
     * The security rules read only the token, and `setCustomUserClaims` does
     * not invalidate one already in a browser — so somebody removed at six
     * o'clock kept reading the restaurant's live orders for up to an hour.
     */
    expect(code('functions/src/restaurants/onboarding.ts')).toContain('revokeRefreshTokens');
  });
});

describe('the provider is read carefully', () => {
  it('normalises the status before comparing it', () => {
    // `"SUCCESS"` compared to `'success'` would mark a captured payment FAILED,
    // and FAILED is terminal.
    expect(code('functions/src/payments/epoint.ts')).toMatch(/trim\(\)\.toLowerCase\(\)/);
  });

  it('does not treat an unrecognised status as a failure', () => {
    const source = code('functions/src/payments/flow.ts');
    expect(source).toContain('SUCCESS_STATUSES');
    expect(source).toContain("'unknown-status'");
  });

  it('flags money taken for an order that already died', () => {
    expect(code('functions/src/payments/flow.ts')).toContain('PAID_AFTER_CANCEL');
  });
});

describe('the customer can always reach the legal texts and read the errors', () => {
  it('does not hide the footer on a telephone', () => {
    const source = code('src/components/layout/SiteFooter.tsx');
    expect(source, 'the footer hides on mobile again').not.toMatch(/hidden[^"']*sm:block/);
    expect(source).toContain('/legal/terms');
    expect(source).toContain('/legal/privacy');
  });

  it('carries a copyright line', () => {
    expect(code('src/components/layout/SiteFooter.tsx')).toContain('footer.rights');
  });

  it('substitutes the placeholders in the legal texts', () => {
    // A customer used to read, literally, `Telefon: {{SUPPORT_PHONE}}`.
    expect(code('src/app/legal/[document]/page.tsx')).toContain('fillLegalText(');
  });

  it('never shows a raw Firebase message at sign-in', () => {
    const source = code('src/app/login/page.tsx');
    expect(source).toContain('authErrorText(');
    expect(source, 'the raw vendor message is shown again').not.toMatch(
      /setError\(\(caught as Error\)\.message/,
    );
  });
});

describe('search engines can see the shopfront', () => {
  it('has a robots file and a sitemap', () => {
    expect(read('src/app/robots.ts')).toContain('sitemap');
    expect(read('src/app/sitemap.ts')).toContain('publicRestaurants');
  });

  it('renders the restaurant page on the server', () => {
    const source = code('src/app/restaurant/[handle]/page.tsx');
    expect(source).toContain('generateMetadata');
    expect(source).toContain('application/ld+json');
    // The client view is seeded with what the server found, so the menu is in
    // the HTML rather than fetched afterwards.
    expect(source).toContain('initialSections');
  });

  it('keeps the panels out of the index', () => {
    // `robots.txt` asks a crawler not to CRAWL; only the meta tag stops a
    // linked-to URL being INDEXED.
    // Named individually rather than globbed: the point of the test is that a
    // NEW private area gets the tag, and a glob over what exists can only ever
    // confirm what exists. These are the roots that must never be indexable.
    for (const area of [
      'account',
      'panel',
      'courier',
      'operator',
      'login',
      'cart',
      'checkout',
      'orders',
      'qapinda-idare-merkezi-7xk4m2',
    ]) {
      expect(read(`src/app/${area}/layout.tsx`), `${area} may be indexed`).toContain(
        'index: false',
      );
    }
  });
});

describe('a cancelled order says WHY, in every panel', () => {
  /*
   * "RESTORAN HERHANSINA SEBEBE GÖRE LEĞV EDİLENDE SEBEBİ HER PANELİNDE
   * YAZILMALIDIR MÜTLƏQ ŞƏKİLDƏ."
   *
   * Before this, five of the six lists showed a status badge and stopped: the
   * customer's order list, the restaurant's live board, both of the courier's
   * lists, the operator's queue and the admin's table. Only the DETAIL screens
   * carried the reason, so finding out why an order died meant opening it.
   *
   * One component in two shapes — a block for a detail screen, a line for a
   * list — so no two panels can word the same cancellation differently.
   */
  it('offers both shapes from one file', () => {
    const source = code('src/components/panel/CancellationNote.tsx');
    expect(source).toContain('export function CancellationNote');
    expect(source).toContain('export function CancellationLine');
    // The note matters most here: a platform cancellation used to store OTHER
    // and put the real explanation in the note, so a line without it says
    // "Digər" and nothing else.
    expect(source).toContain('cancellation.note');
  });

  it.each([
    ['customer list', 'src/app/orders/page.tsx'],
    ['customer detail', 'src/app/orders/[orderId]/page.tsx'],
    ['restaurant board', 'src/app/panel/page.tsx'],
    ['courier cards', 'src/components/courier/OrderCards.tsx'],
    ['operator queue', 'src/app/operator/LiveOrders.tsx'],
    ['admin table', 'src/app/qapinda-idare-merkezi-7xk4m2/orders/page.tsx'],
    ['support context', 'src/components/panel/CustomerOrderContext.tsx'],
  ])('%s shows the reason', (_name, file) => {
    expect(code(file)).toMatch(/Cancellation(Line|Note)/);
  });

  it('ends the timeline of an order that ended badly', () => {
    // The step list is the happy path only, so a cancelled order's timeline
    // used to stop halfway down in grey dots and never say what happened.
    const source = code('src/components/panel/OrderTimeline.tsx');
    expect(source).toContain('ENDINGS');
    expect(source).toContain('OrderStatus.DELIVERY_FAILED');
  });

  it('lets an operator record a real reason, not always OTHER', () => {
    const source = code('src/components/panel/ForceCancelDialog.tsx');
    expect(source).toContain('PLATFORM_REASONS');
    expect(source, 'every platform cancellation is OTHER again').not.toMatch(
      /reason: CancellationReason\.OTHER,\s*\n\s*note: reason/,
    );
  });

  it('translates the enums inside a notification body', () => {
    // The server has no dictionary, so it passes `reason: 'ITEM_UNAVAILABLE'`.
    // An operator was reading that verbatim, in capitals, in English.
    expect(code('src/components/notifications/NotificationList.tsx')).toContain('readable(t,');
  });

  it('looks cancellation reasons up in the namespace that exists', () => {
    // `cancellationReason.*` is in no dictionary; `order.reason.*` is.
    const source = code('src/app/qapinda-idare-merkezi-7xk4m2/audit/page.tsx');
    expect(source).toContain("'order.reason'");
    expect(source).not.toContain("'cancellationReason'");
  });
});

describe('evidence photographs cannot be taken out of the screen', () => {
  /*
   * "FOTOLARI GÖTÜRMEK OLMASIN YENİ TABDA AÇMAQ QETİYYEN MÜMKÜN OLMASIN."
   *
   * These are other people's complaints: receipts, wrong dishes, sometimes
   * documents. Not a security boundary — the bytes are in the browser because
   * the browser is drawing them — but it removes the accidental copy, which is
   * the one that actually happens.
   */
  it('never wraps a private picture in a link', () => {
    const source = code('src/components/ui/Img.tsx');
    expect(source, 'the openable anchor is back').not.toContain('target="_blank"');
    expect(source).toContain('onContextMenu');
    expect(source).toContain('draggable={false}');
    expect(source).toContain('WebkitTouchCallout');
  });

  it('has no caller still asking for an openable photo', () => {
    for (const file of [
      'src/components/panel/ComplaintsQueue.tsx',
      'src/components/panel/Chat.tsx',
      'src/app/panel/complaints/page.tsx',
    ]) {
      expect(code(file)).not.toMatch(/^\s*openable\s*$/m);
    }
  });
});

describe('a work account can reach its own panel from Hesabım', () => {
  it('draws the link from accountHome, so a customer never sees one', () => {
    /*
     * The old comment said "no panel links here, by design" — sound as far as
     * it went, but the door is only public if the link is drawn for everybody.
     * `accountHome` returns `/` for a customer, so the block does not render
     * for them and the panel's address appears nowhere they can see.
     */
    const source = code('src/app/account/page.tsx');
    expect(source).toContain('accountHome(profile.role)');
    expect(source).toContain('panelHref');
  });
});

describe('the address form asks only what the address needs', () => {
  it('hides the company field on a home address', () => {
    expect(code('src/components/customer/AddressForm.tsx')).toContain('showCompany');
  });

  it('offers the account\'s own number as a one-tap fix', () => {
    const source = code('src/components/customer/AddressForm.tsx');
    expect(source).toContain('switchToOwnNumber');
    expect(source).toContain('ownPhone');
  });
});

describe('a signed-in person is never told they have not registered', () => {
  /*
   * REPORTED, IN THESE WORDS: "elə bil ki giriş edirəm, qeydiyyatı tamamlanan
   * hesabı qeydiyyatı tamamla hissəsinə yönləndirir" — and, separately, "hesaba
   * daxil olduqdan sonra restoranlara baxıram, təkrar hesabıma keçdikdə 1-2
   * saniyəlik giriş ekranı görsənir hesabda ola-ola".
   *
   * Both came from the same place. `profile === null` was made to carry two
   * different facts at once — "not read yet" and "read, and there is nothing" —
   * and a third, "the read failed", was folded into it as well. Every screen
   * that acted on a null profile therefore acted on a guess, and the guess was
   * always the alarming one: your account does not exist.
   */
  const auth = code('src/contexts/AuthContext.tsx');

  it('keeps a failed profile read apart from an empty one', () => {
    // A refused or dropped read must not read as "this account has no profile".
    expect(auth).toContain("status: 'error'");
    expect(auth).toContain("status: 'missing'");
    expect(auth, 'needsRegistration must fire only on a confirmed empty read').toContain(
      "profileState?.status === 'missing'",
    );
  });

  it('re-opens the listener that Firestore tore down on error', () => {
    // `onSnapshot` does not retry: an errored listener is a dead listener, and
    // before this the wrong answer stood until the page was reloaded.
    expect(auth).toContain('PROFILE_RETRY_MS');
    expect(auth, 'a refusal usually means a stale token — get a fresh one').toContain(
      'getIdToken(true)',
    );
  });

  it('offers a retry instead of a registration form', () => {
    for (const screen of ['src/app/account/page.tsx', 'src/app/login/page.tsx']) {
      expect(code(screen), `${screen} still treats an unreadable profile as unregistered`)
        .toContain('profileUnavailable');
    }
  });

  it('waits for the identity on every screen that reads the role', () => {
    /*
     * `loading` goes false a round trip before `role` and `profile` arrive. In
     * that gap every account looks like a signed-out customer, which is what
     * put a "finish signing up" card in front of a customer and bounced a
     * restaurant owner off their own panel.
     */
    for (const screen of [
      'src/app/account/page.tsx',
      'src/app/login/page.tsx',
      'src/app/operator/page.tsx',
      'src/app/admin-login/page.tsx',
      'src/app/partner/page.tsx',
      'src/components/layout/PanelShell.tsx',
      'src/components/panel/OperatorShell.tsx',
      'src/components/courier/CourierShell.tsx',
    ]) {
      expect(code(screen), `${screen} decides who you are before it knows`).toContain(
        'identityLoading',
      );
    }
  });
});

describe('the Azerbaijani routes still resolve after the rename', () => {
  /*
   * "birde men o domainler vare onları deyişib ingilis dilinde ede bilerik".
   *
   * They can — but a renamed URL is not a private change. Delivered push
   * notifications carry `/sifarislerim/<id>`; a kitchen tablet has the panel as
   * its home page; Google was handed a sitemap naming `/restoran/<slug>`. Each
   * old path therefore has to keep working, permanently, and this is the test
   * that says so.
   */
  const config = read('next.config.ts');

  it('redirects every root that moved', () => {
    for (const [old, moved] of [
      ['/hesabim', '/account'],
      ['/giris', '/login'],
      ['/sebet', '/cart'],
      ['/odenis', '/checkout'],
      ['/sifarislerim', '/orders'],
      ['/kuryer', '/courier'],
      ['/restoran-paneli', '/panel'],
      ['/restoran-qosul', '/partner'],
      ['/restoran', '/restaurant'],
      ['/axtar', '/search'],
      ['/huquqi', '/legal'],
      ['/admin-giris', '/admin-login'],
    ]) {
      expect(config, `${old} leads nowhere`).toContain(
        `{ source: '${old}', destination: '${moved}', permanent: true }`,
      );
    }
  });

  it('carries the children along, because they were renamed too', () => {
    // `/hesabim/unvanlar` is not reachable by rewriting only its first segment.
    expect(config).toContain(
      "{ source: '/hesabim/unvanlar', destination: '/account/addresses', permanent: true }",
    );
    expect(config).toContain(
      "{ source: '/restoran-paneli/menyu', destination: '/panel/menu', permanent: true }",
    );
  });

  it('answers the legal slugs, which are a dynamic route and not in the sweep', () => {
    expect(config).toContain("source: '/huquqi/istifade-sertleri', destination: '/legal/terms'");
    expect(config).toContain("source: '/huquqi/mexfilik', destination: '/legal/privacy'");
    expect(config).toContain("source: '/huquqi/kuki', destination: '/legal/cookies'");
  });

  it('leaves no Azerbaijani path behind in the code', () => {
    const stale =
      /['"`]\/(giris|hesabim|sebet|odenis|sifarislerim|kuryer|restoran-paneli|restoran-qosul|axtar|huquqi|admin-giris)(?![A-Za-z0-9_-])/;
    for (const file of [
      'shared/permissions.ts',
      'src/app/sitemap.ts',
      'src/components/layout/SiteFooter.tsx',
      'src/components/layout/AppShell.tsx',
      'src/contexts/AuthContext.tsx',
    ]) {
      expect(read(file), `${file} still points at a route that moved`).not.toMatch(stale);
    }
  });

  it('names the panel once, not twice', () => {
    /*
     * The sidebar used to hold a shorthand root that `PanelShell` rewrote on
     * its way to the screen. The rename walked straight into that: the rewrite
     * produced `/panel/menyu`, a path that resolves to nothing. Two spellings
     * of one route is the trap; there is one now.
     */
    expect(code('shared/permissions.ts')).toContain("href: '/panel/menu'");
    expect(code('src/components/layout/PanelShell.tsx')).not.toContain("replace('/restaurant'");
  });
});

describe('a customer may fix their own name, and only their own', () => {
  /*
   * `fullName` was in the security rule's list of self-writable fields, next to
   * `locale`. For a language that is right — a nonsense value inconveniences
   * only the person who wrote it. A name is different: it is printed on the
   * kitchen's ticket and shown to the courier, so it leaves the account. From
   * the browser it had no length bound, no moderation and no audit row — and no
   * screen used it either, so it was a hole with no feature behind it.
   */
  it('no longer lets the browser write the name', () => {
    const rules = read('firestore.rules');
    expect(rules).toContain("onlyChanges(['locale', 'defaultAddressId', 'updatedAt'])");
    expect(rules, 'fullName is writable from the client again').not.toContain(
      "onlyChanges(['fullName'",
    );
  });

  it('bounds it, filters it and writes down what it was', () => {
    const source = code('functions/src/users/profile.ts');
    expect(source).toContain('NAME_MIN');
    expect(source).toContain('clean(raw)');
    expect(source).toContain('USER_PROFILE_CHANGED');
    expect(source).toContain("oldValue: { fullName: user.fullName }");
  });

  it('leaves past orders alone', () => {
    // An order froze the customer's name when it was placed. That is the name
    // the kitchen packed for. A receipt that changes afterwards is not a receipt.
    const source = code('functions/src/users/profile.ts');
    expect(source).not.toContain('customerName');
  });
});

describe('an admin can move a telephone number, and nobody else can', () => {
  const source = code('functions/src/users/profile.ts');

  it('is super admin only', () => {
    // Sign-in is a code to that number and nothing else, so this decides who an
    // account belongs to. An operator handles support; this is not support.
    expect(source).toContain('caller.role !== UserRole.SUPER_ADMIN');
  });

  it('refuses a number that is already somebody else\'s', () => {
    // Moving a live lock would sign a stranger out of their own account without
    // telling them. A genuinely stale lock is released by its own tool first.
    expect(source).toContain('PHONE_ALREADY_REGISTERED');
  });

  it('moves both locks and the document together', () => {
    expect(source).toContain('db.runTransaction');
    expect(source).toContain('tx.delete(db.doc(paths.phoneLock(oldPhone)))');
    expect(source).toContain('tx.set(newLockRef');
  });

  it('signs the old sessions out and records the old number', () => {
    expect(source).toContain('revokeRefreshTokens');
    expect(source).toContain('USER_PHONE_CHANGED');
    expect(source).toContain('oldValue: { phone: outcome.oldPhone }');
  });

  it('tells the admin when only half of it landed', () => {
    // Firestore is what the platform believes; Auth is what actually lets a
    // person sign in. An admin who thinks they fixed an account and did not is
    // worse off than one who is told to try again.
    expect(source).toContain('authUpdated');
    expect(code('src/app/qapinda-idare-merkezi-7xk4m2/users/page.tsx')).toContain(
      'admin.phoneMovedPartly',
    );
  });
});

describe('the admin roster can be sorted by what a customer is worth', () => {
  it('counts orders where the order already completes', () => {
    // Written in the same transaction that sets `hasCompletedOrder`, in BOTH
    // completion paths — an order an operator closed by hand counts as much as
    // one the scheduler closed.
    for (const file of ['functions/src/orders/jobs.ts', 'functions/src/orders/status.ts']) {
      const source = code(file);
      expect(source, `${file} does not count the order`).toContain(
        'completedOrderCount: FieldValue.increment(1)',
      );
      expect(source).toContain('totalSpent: FieldValue.increment(order.pricing.total)');
    }
  });

  it('has a backfill for the accounts that came before it', () => {
    const source = code('functions/src/users/profile.ts');
    expect(source).toContain('backfillCustomerCounters');
    // Absolute values, not increments: run it twice and the answer is the same.
    expect(source).toContain('completedOrderCount: orders.size');
  });

  it('reads a missing counter as zero rather than as an error', () => {
    const source = code('src/app/qapinda-idare-merkezi-7xk4m2/users/page.tsx');
    expect(source).toContain('user.completedOrderCount ?? 0');
    expect(source).toContain('user.totalSpent ?? 0');
  });

  it('admits that it sorts one page, not the platform', () => {
    expect(code('src/app/qapinda-idare-merkezi-7xk4m2/users/page.tsx')).toContain(
      'admin.sortScopeHint',
    );
  });
});

describe('no screen can wait for the identity forever', () => {
  /*
   * REPORTED: "telefonda sayta girərkən bəzən yüklənir yazılır, ekranda açılmır."
   *
   * Self-inflicted, and by the change that made those screens wait for the
   * identity in the first place. `getIdTokenResult` goes to the network when the
   * cached token has expired; on a phone that request can simply never come
   * back. The promise rejected, `setClaims` never ran, `identityLoading` stayed
   * true, and the spinner had no way to end.
   */
  const auth = code('src/contexts/AuthContext.tsx');

  it('settles the claims even when the token read fails', () => {
    expect(auth).toContain('setClaims({ uid: next.uid, role: UserRole.CUSTOMER');
  });

  it('stops waiting after a deadline whatever else breaks', () => {
    expect(auth).toContain('IDENTITY_DEADLINE_MS');
    expect(auth).toContain('identityTimedOut');
  });

  it('says which happened, so a stall is not read as a missing account', () => {
    // The deadline expiring must never put a "finish signing up" card in front
    // of a customer whose phone was in a lift.
    expect(auth).toContain('identityStalled: identityUnresolved');
    expect(code('src/app/account/page.tsx')).toContain('if (identityStalled)');
  });

  it('arms the clock per account, not once', () => {
    // Signing out and back in as somebody else must start a fresh clock, or the
    // second person is rendered with no identity at all, instantly.
    expect(auth).toContain('setIdentityTimedOut(uid)');
  });
});

describe('the footer is on the pages people browse and nowhere else', () => {
  /*
   * REPORTED: "ünvanlara, kuponlara, hesabım hissəsinə girərkən footer görsənir
   * və pis görsənir… həmçinin səbət, sifarişlərim, axtarma hissələrində."
   *
   * It is there to make the terms and the privacy policy reachable from the
   * public app. Under a list of saved addresses on a phone, four columns of
   * links look like the page broke.
   */
  const shell = code('src/components/layout/AppShell.tsx');

  it('is an allow-list, so a new page gets no footer by accident', () => {
    expect(shell).toContain('showFooter');
    expect(shell).toContain("pathname === '/'");
    expect(shell).toContain("pathname.startsWith('/restaurant/')");
    expect(shell).toContain("pathname.startsWith('/legal')");
  });

  it('keeps it off the account, the basket, the orders and search', () => {
    for (const route of ['/account', '/cart', '/orders', '/search', '/checkout']) {
      expect(shell, `${route} still gets a footer`).not.toContain(`pathname === '${route}'`);
    }
  });

  it('still reaches the legal documents from the public pages', () => {
    // The obligation this footer exists for. Losing it would trade one problem
    // for a worse one.
    expect(code('src/components/layout/SiteFooter.tsx')).toContain('/legal/terms');
  });
});

describe('signing out is visible', () => {
  it('is red rather than white on a white card', () => {
    // It was the plain `secondary` button — the one control on the screen a
    // person actively looks for, and the hardest one to see.
    const source = code('src/app/account/page.tsx');
    expect(source).toContain('text-danger');
  });
});

describe('the printed slip does not repeat itself', () => {
  it('prints the door contact only when it is somebody else', () => {
    /*
     * On most orders the door contact IS the account holder, so the block
     * reprinted the name and the telephone number already two lines above it.
     * Repetition on a receipt is worse than absence: it makes the reader check
     * whether the two differ, on every order, when they almost never do.
     */
    const source = code('src/components/restaurant/Receipt.tsx');
    expect(source).toContain('doorDiffers');
    // Compared on digits: `+994 55 222 22 22` and `+994552222222` are one number.
    expect(source).toContain("replace(/\\D/g, '')");
  });

  it('says "call the restaurant", not the restaurant\'s name twice', () => {
    const source = code('src/app/orders/page.tsx');
    expect(source).toContain("{t('order.callRestaurant')}");
    // The accessible name keeps it — a screen reader has no card heading above.
    expect(source).toContain("aria-label={t('order.callNamed'");
  });
});

describe('a discount is visible without being explained', () => {
  it('stores the comparison, because Firestore cannot make it', () => {
    // `compareAtPrice > price` compares two fields; every Firestore `where`
    // compares a field to a value. So the answer is computed at write time.
    // The rule itself lives in `shared/pricing.ts` so that the menu screen and
    // the write-time flag answer the same question — see the next test.
    const rule = code('shared/pricing.ts');
    expect(rule).toContain('export function isDiscountedProduct');
    expect(rule).toContain('ProductAvailability.HIDDEN');

    const source = code('functions/src/menu/discounts.ts');
    expect(source).toContain('isDiscountedProduct');
    expect(source).toContain('export const isDiscounted');
  });

  it('says "Endirim" once per dish, not twice', () => {
    // Both the name row and the price row carried the word, two words apart on
    // the same line. The price row keeps the struck-through figure and drops
    // the badge; the name row keeps the badge.
    const price = code('src/components/customer/ProductSheet.tsx');
    expect(price).not.toContain("t('restaurant.discount')");

    const menu = code('src/app/restaurant/[handle]/RestaurantView.tsx');
    expect(menu.match(/badge\.DISCOUNT/g)?.length ?? 0).toBe(1);
  });

  it('draws the menu mark from the dish, not from the backfilled flag', () => {
    // `discounted` is written for a cross-restaurant query and is only right
    // once the backfill has run. The menu has the dish in hand, so it asks the
    // shared rule directly and is correct before any backfill.
    const menu = code('src/app/restaurant/[handle]/RestaurantView.tsx');
    expect(menu).toContain('isDiscountedProduct(product)');
    expect(menu).not.toContain('product.discounted === true');
  });

  it('refreshes the restaurant flag after every menu change', () => {
    const menu = code('functions/src/menu/crud.ts');
    // Save, delete, availability and bulk price — all four can flip it.
    expect(menu.match(/refreshDiscountFlag\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    // A bulk price rise can cancel a discount without anybody saying so.
    expect(menu).toContain('discounted: isDiscounted({');
  });

  it('shows the word and nothing else', () => {
    const view = code('src/app/restaurant/[handle]/RestaurantView.tsx');
    expect(view).toContain("t('badge.DISCOUNT')");
    // No percentage, no code, no conditions beside it.
    expect(view).not.toMatch(/badge\.DISCOUNT'\)\}\s*[^<]*%/);
  });
});

describe('a paid slot is labelled as one', () => {
  const badges = code('shared/badges.ts');

  it('is a different badge from the editorial pick', () => {
    expect(badges).toContain('SPONSORED');
    expect(badges).toContain('FEATURED');
    expect(badges).toContain("featuredKind === 'SPONSORED'");
  });

  it('reads "Reklam" to the customer', () => {
    const az = JSON.parse(read('src/i18n/translations/az.json'));
    expect(az.badge.SPONSORED).toBe('Reklam');
    // And never the word used for the free, editorial pick.
    expect(az.badge.SPONSORED).not.toBe(az.badge.FEATURED);
  });

  it('ends by itself, checked on render as well as swept', () => {
    // The sweep can stop running; the render check cannot be forgotten.
    expect(badges).toContain('featuredUntil');
    expect(badges).toContain('promotionLive');
    expect(code('functions/src/orders/jobs.ts')).toContain('expirePromotions');
  });

  it('refuses to sell an undated slot', () => {
    const source = code('functions/src/restaurants/onboarding.ts');
    expect(source).toContain("fail(AppErrorCode.VALIDATION_FAILED, 'untilMs')");
  });

  it('collects the fee through the ledger that already exists', () => {
    // No new money machinery: the monthly settlement folds in every entry, so
    // an advert is invoiced beside the commission.
    const source = code('functions/src/restaurants/onboarding.ts');
    expect(source).toContain('sponsorship:${restaurantId}:${period}');
    expect(source).toContain('LedgerEntryType.ADJUSTMENT');
    // `create`, so a second advert in one month is a visible conflict.
    expect(source).toContain('.create({');
  });
});

describe('the customer gets a receipt they can keep', () => {
  const mail = code('functions/src/orders/receiptEmail.ts');

  it('goes only to a verified address', () => {
    // An unverified address is a string somebody typed, and a typo belongs to a
    // stranger who would receive a name, a street and a telephone number.
    expect(mail).toContain("user.emailVerified !== true");
  });

  it('sends once, and remembers only after it worked', () => {
    expect(mail).toContain('order.receiptEmailedAt');
    expect(mail.indexOf('response.ok')).toBeLessThan(mail.indexOf('receiptEmailedAt: now()'));
  });

  it('never throws, whatever the mail provider does', () => {
    // Called after the money is already accounted for. A bad minute at the
    // provider must not turn a finished order into a failing job.
    expect(mail).toContain('catch (error)');
  });

  it('carries nothing about the platform\'s own cut', () => {
    for (const word of ['commission', 'Komissiya', 'settlement', 'netDue']) {
      expect(mail, `the customer receipt mentions ${word}`).not.toContain(word);
    }
  });

  it('is sent from both paths an order can complete by', () => {
    expect(code('functions/src/orders/jobs.ts')).toContain('sendOrderReceipt(');
    expect(code('functions/src/orders/status.ts')).toContain('sendOrderReceipt(');
  });
});

describe('the search screen helps before it lists', () => {
  /*
   * It used to open on the whole catalogue: every restaurant on the platform,
   * in a grid, under an empty box. That is the home page with a text field
   * bolted on — and the person who tapped "Axtar" did so precisely because the
   * list of everything was not helping them.
   */
  const page = code('src/app/search/page.tsx');

  it('shows the catalogue only once something is narrowed', () => {
    expect(page).toContain('const narrowed =');
    expect(page).toContain("!narrowed && 'hidden'");
  });

  it('offers the four things that actually shorten a search', () => {
    for (const key of [
      'search.cuisines',
      'search.recent',
      'search.sponsoredTitle',
      'search.popular',
    ]) {
      expect(page, `the idle screen is missing ${key}`).toContain(key);
    }
  });

  it('keeps the history on the device and nowhere else', () => {
    /*
     * A search history is the most revealing list a food app holds. On the
     * server it would be readable by anyone who reaches the account, syncable
     * to a phone the person no longer owns, and one more thing to hand over
     * when somebody asks to be forgotten.
     */
    const store = code('src/lib/recentSearches.ts');
    expect(store).toContain('localStorage');
    expect(store, 'the history reaches Firestore').not.toContain('firestore');
  });

  it('reads that history the way React reads an external store', () => {
    // Not `useState` plus an effect — that is a cascading render, and the
    // project's lint rule refuses it. This also gets SSR right.
    expect(page).toContain('useSyncExternalStore');
    const store = code('src/lib/recentSearches.ts');
    // The two traps: a fresh array per call loops for ever, in both halves.
    expect(store).toContain('snapshot ??= read()');
    expect(store).toContain('SERVER_SNAPSHOT');
  });
});

describe('popular searches are the ones that worked', () => {
  const fn = code('functions/src/menu/popular.ts');

  it('counts an opened result, not a keystroke', () => {
    /*
     * Search runs on a debounce, so one person looking for "dönər" types four
     * prefixes — four writes for one intention. Worse, a term typed and
     * abandoned is a search that FAILED, and offering it back to the next
     * customer recommends the query that did not work.
     */
    expect(code('src/app/search/page.tsx')).toContain('onClickCapture={openedResult}');
    expect(code('src/app/search/page.tsx')).toContain('recordSearchHit(typed)');
  });

  it('filters the words before they reach every customer', () => {
    // These render as public chips: a stranger's typing in front of everyone.
    expect(fn).toContain('clean(raw)');
  });

  it('folds the key so one word is one row', () => {
    expect(fn).toContain('fold(term)');
    // And keeps the typed spelling for display — `doner` under a `Dönər` menu
    // looks like a mistake.
    expect(fn).toContain('display');
  });

  it('is readable by anyone and writable by nobody', () => {
    const rules = read('firestore.rules');
    expect(rules).toMatch(
      /match \/searchTerms\/\{term\} \{\s*allow read: if true;\s*allow write: if false;/,
    );
  });

  it('never shows an empty row on a new platform', () => {
    // An empty section on the first screen does not read as "no data yet".
    const service = code('src/services/popularSearches.ts');
    expect(service).toContain('FALLBACK');
    expect(service).toContain('MIN_COUNT');
  });
});

describe('changing a user status', () => {
  it('does not report failure for a change that landed', () => {
    // The Firestore write is the decision and commits first. Disabling the Auth
    // user is enforcement and can fail on its own — an account whose document
    // has no matching Auth record. It used to throw out of the callable, so the
    // admin was told it had failed while the table in front of them updated.
    const source = code('functions/src/users/admin.ts');
    expect(source).toContain('let authUpdated = true');
    expect(source).toContain('return { ok: true, authUpdated }');
    // And the log says which half landed.
    expect(source).toContain('newValue: { accountStatus, authUpdated }');
  });

  it('tells the admin when only half of it applied', () => {
    const page = code('src/app/qapinda-idare-merkezi-7xk4m2/users/page.tsx');
    expect(page).toContain("t('admin.statusChangedPartly')");
  });
});

describe('attaching a person to a restaurant', () => {
  it('offers the restaurants instead of asking for an id', () => {
    // A document id is not something a person knows, and one wrong character
    // attaches a manager to somebody else's restaurant with no error at all.
    const page = code('src/app/qapinda-idare-merkezi-7xk4m2/users/page.tsx');
    expect(page).toContain('watchRestaurantDirectory');
    expect(page).not.toContain("t('admin.roleRestaurantId')");
  });

  it('lists restaurants that are not open yet, unlike the shopfront', () => {
    // The one being attached to is very often the one approved an hour ago.
    const service = code('src/services/catalog.ts');
    const directory = service.slice(service.indexOf('export function watchRestaurantDirectory'));
    expect(directory).toContain("orderBy('name')");
    expect(directory.slice(0, directory.indexOf('export function watchOrder'))).not.toContain(
      'RestaurantStatus.ACTIVE',
    );
  });
});

describe('joining a restaurant is an offer, not an assignment', () => {
  it('does not change a role from the staff screen', () => {
    // Typing somebody's telephone number used to turn their account into a
    // restaurant panel, with no message and no way back. The account then
    // carried a `restaurantId` claim, which is the tenant boundary.
    const source = code('functions/src/restaurants/onboarding.ts');
    expect(source).toContain('writeRestaurantInvite({');
    expect(source).toContain('return { ok: true, uid: targetDoc.id, invited: true }');
  });

  it('still removes somebody immediately', () => {
    // Consent protects a person from being enrolled. It is not a veto over
    // being dismissed, and a restaurant must not wait for the agreement of
    // somebody it has just let go before their access to the customer list ends.
    const source = code('functions/src/restaurants/onboarding.ts');
    expect(source).toMatch(/if \(role !== UserRole\.CUSTOMER && !alreadyOnThisTeam\) \{/);
    expect(source).toContain('await setUserClaims(targetDoc.id, role, newRestaurantId)');
  });

  it('lets only the invited person accept', () => {
    const source = code('functions/src/restaurants/invites.ts');
    // Addressed by the caller's own uid, and re-checked against the document.
    expect(source).toContain('paths.restaurantInvite(restaurantId, caller.uid)');
    expect(source).toContain('if (invite.uid !== caller.uid)');
    // The stale token is what the security rules read, so it has to die.
    expect(source).toContain('revokeRefreshTokens(caller.uid)');
  });

  it('re-reads the person rather than trusting a fortnight-old offer', () => {
    const source = code('functions/src/restaurants/invites.ts');
    expect(source).toContain("fail(AppErrorCode.CONFLICT, 'role-changed')");
    expect(source).toContain("fail(AppErrorCode.CONFLICT, 'other-restaurant')");
  });

  it('keeps the invitation readable by exactly two parties', () => {
    const block = blockFor('restaurantInvites');
    expect(block).toContain('uid() == resource.data.uid');
    expect(block).toContain('ownsRestaurant(resource.data.restaurantId)');
    // Accepting assigns a role claim. No browser writes that.
    expect(block).toContain('allow write: if false');
  });
});

describe('a suspended restaurant takes its menu with it', () => {
  it('mirrors the shop\'s visibility onto its dishes', () => {
    const source = code('functions/src/restaurants/onboarding.ts');
    expect(source).toContain('mirrorRestaurantVisibility(restaurantId,');
  });

  it('reads the mirrored flag in the rule, and treats absent as visible', () => {
    // `== true` would take every existing menu dark the moment this deployed.
    const block = blockFor('products');
    expect(block).toContain('resource.data.restaurantVisible != false');
    expect(block).not.toContain('restaurantVisible == true');
  });
});

describe('one push per notification', () => {
  it('claims the notification before sending', () => {
    // A Firestore trigger is at-least-once: a retry after a timeout used to
    // send the same banner again.
    const source = code('functions/src/notifications/push.ts');
    expect(source).toContain('runTransaction');
    expect(source).toContain('pushClaimedAt');
    // And the claim expires, or a run that died before sending would block
    // every retry for ever — silence being the worse failure of the two.
    expect(source).toContain('CLAIM_STALE_MS');
  });
});

describe('staff sessions are recorded, customers are not', () => {
  it('audits only work accounts', () => {
    const source = code('functions/src/users/account.ts');
    expect(source).toContain('isWorkAccount(user.role)');
    expect(source).toContain('AuditAction.STAFF_SESSION_STARTED');
  });

  it('throttles by time AND by address', () => {
    // The same account appearing from a different network is the entry worth
    // having; one person reloading all morning is not forty entries.
    const source = code('functions/src/users/account.ts');
    expect(source).toContain('SESSION_AUDIT_GAP_MS');
    expect(source).toContain('user.sessionAuditedIp === ip');
  });
});

describe('the search backfill reaches the end of the catalogue', () => {
  it('pages with a cursor instead of stopping at one page', () => {
    const source = code('functions/src/menu/search.ts');
    expect(source).toContain("orderBy('__name__')");
    expect(source).toContain('startAfter(after)');
    expect(source).toContain('last: snapshot.docs[snapshot.docs.length - 1]?.id ?? null');
    // The old shape reported `more` with no way to act on it.
    expect(source).not.toContain('more: snapshot.size === 2000');
  });

  it('walks every page from the button', () => {
    const page = code('src/components/panel/SearchBackfill.tsx');
    expect(page).toContain('if (!result.data.more) break;');
    expect(page).toContain('after = result.data.last;');
  });
});

describe('pictures are not somebody else\'s to embed', () => {
  it('refuses a cross-site request and a direct navigation', () => {
    const route = code('src/app/m/[...path]/route.ts');
    expect(route).toContain("dest === 'document'");
    expect(route).toContain("site === 'cross-site'");
    // The browser's own half, so a response that slips through is still refused.
    expect(route).toContain("'Cross-Origin-Resource-Policy': 'same-origin'");
  });

  it('does not vary the cache on the referring page', () => {
    // That would key the CDN by referrer and never hit.
    const route = code('src/app/m/[...path]/route.ts');
    expect(route).toContain("Vary: 'Sec-Fetch-Dest, Sec-Fetch-Site'");
  });
});

describe('the printed slip fits on a roll', () => {
  it('tells the printer the page is a roll, not A4', () => {
    // Without a page size the browser assumes A4, so a thermal printer feeds a
    // whole page of paper for a slip with eight lines on it.
    const source = code('src/components/restaurant/Receipt.tsx');
    expect(source).toContain('@page { size: 80mm auto;');
  });

  it('does not ask for money that has already been paid', () => {
    // It printed the total whatever the payment method, so an order paid online
    // handed the courier a slip saying "Ödəniləcək: 25 ₼".
    const source = code('src/components/restaurant/Receipt.tsx');
    expect(source).toContain('order.paymentStatus === PaymentStatus.PAID');
    expect(source).toContain("t('receipt.paidOnline')");
  });
});

describe('being removed from a team does not delete you', () => {
  it('never reads a cached emptiness as "this account has no profile"', () => {
    /*
     * Removing somebody from a restaurant revokes their refresh token — it has
     * to, because the rules read the token. The Firestore SDK in their browser
     * then clears its local cache (the authenticated user changed) and emits an
     * empty snapshot from it. `exists()` is false on that snapshot and
     * `fromCache` is true: the first says "no profile", the second says "I have
     * not asked anybody". Reading only the first sent a year-old customer to
     * the registration form at the exact moment their role changed.
     */
    const source = code('src/contexts/AuthContext.tsx');
    expect(source).toContain('snapshot.metadata.fromCache');
    // And the six-second deadline is what stops that becoming a hang: an
    // unanswered question ends as "could not load", never as "register again".
    expect(source).toContain('IDENTITY_DEADLINE_MS');
  });
});

describe('deleting an account leaves nothing live behind', () => {
  it('closes every device the account registered', () => {
    // A push token is a permanent address for a phone. Left behind, a later
    // notification for this uid still lands on a real handset belonging to
    // somebody who was told their data was gone.
    const source = code('functions/src/users/anonymise.ts');
    expect(source).toContain('COLLECTIONS.pushTokens');
    expect(source).toContain("where('userId', '==', input.uid)");
  });

  it('takes the addresses and the favourites with it', () => {
    const source = code('functions/src/users/anonymise.ts');
    expect(source).toContain('paths.userAddresses(input.uid)');
    expect(source).toContain('paths.userFavourites(input.uid)');
  });

  it('still releases both identity locks', () => {
    // Leaving them means the person can never register with their own number
    // again — and cannot be told why.
    const source = code('functions/src/users/anonymise.ts');
    expect(source).toContain('paths.phoneLock(input.target.phone)');
    expect(source).toContain('paths.emailLock(input.target.email)');
  });
});

describe('the platform reset button', () => {
  it('is refused at the button, not inside a dialog nobody can use', () => {
    const source = code('src/components/panel/PlatformReset.tsx');
    expect(source).toContain('disabled={!enabled}');
    expect(source).toContain("t('admin.resetLockedHint')");
  });
});

describe('couriers can actually be created', () => {
  it('is a role an admin may assign, on both sides', () => {
    // It was missing from both lists, so only a restaurant owner could make a
    // courier — and every restaurant here is set up by an admin first. The
    // result was a platform with a courier panel and no couriers.
    expect(code('functions/src/users/admin.ts')).toContain('UserRole.RESTAURANT_COURIER');
    expect(code('src/app/qapinda-idare-merkezi-7xk4m2/users/page.tsx')).toContain(
      'UserRole.RESTAURANT_COURIER',
    );
  });

  it('asks a courier which restaurant it drives for', () => {
    /*
     * `RESTAURANT_ROLES` answers "may this account act for the shop" and
     * deliberately excludes couriers. Whether an account HAS a restaurantId is
     * a different question, and using one list for both refused a courier with
     * a restaurant and accepted one without.
     */
    expect(code('shared/enums.ts')).toContain('export const RESTAURANT_SCOPED_ROLES');
    expect(code('functions/src/users/admin.ts')).toContain(
      'RESTAURANT_SCOPED_ROLES.includes(role)',
    );
    expect(code('src/app/qapinda-idare-merkezi-7xk4m2/users/page.tsx')).toContain(
      'RESTAURANT_SCOPED_ROLES.includes(role as UserRole)',
    );
  });
});

describe('changing the job of somebody already on the team', () => {
  it('does not send them an invitation they cannot accept', () => {
    // Staff → courier went out as an invitation, and accepting it was refused
    // because by then the person was not a plain CUSTOMER. A 400, with nothing
    // on screen to explain it.
    const source = code('functions/src/restaurants/onboarding.ts');
    expect(source).toContain('const alreadyOnThisTeam = target.restaurantId === restaurantId');
    expect(source).toContain('if (role !== UserRole.CUSTOMER && !alreadyOnThisTeam)');
  });

  it('and an old invitation still answers instead of throwing', () => {
    const source = code('functions/src/restaurants/invites.ts');
    expect(source).toContain('PLATFORM_ROLES.includes(user.role)');
    expect(source).not.toContain('user.role !== UserRole.CUSTOMER');
  });
});

describe('what the restaurant is told', () => {
  it('says the amount as money, not as qəpik', () => {
    // The banner read "2500 qəpik" for a 25 manat order: the raw integer was
    // passed and the sentence appended the unit.
    expect(code('functions/src/orders/create.ts')).toContain(
      'params: { code, total: formatMoney(pricing.total) }',
    );
  });

  it('says which way the invitation was answered', () => {
    // One "answered" type hid the yes-or-no in a parameter the text never
    // printed, so the reader had to open the staff screen to find out.
    const source = code('functions/src/restaurants/invites.ts');
    expect(source).toContain('NotificationType.RESTAURANT_INVITE_ACCEPTED');
    expect(source).toContain('NotificationType.RESTAURANT_INVITE_DECLINED');
  });
});

describe('near first, and only this city', () => {
  it('search obeys the region picker', () => {
    /*
     * The home page always filtered on the chosen region; search loaded the
     * whole catalogue. A customer in Gəncə typing "dönər" was shown Baku
     * restaurants that cannot deliver to them, with nothing on screen to read
     * as "not for you".
     */
    const page = code('src/app/search/page.tsx');
    expect(page).toContain('const { regionId, region } = useRegion()');
    expect(page).toContain('watchRestaurants(allRegions ? undefined : regionId,');
    // The dish half of the same result list, scoped to the same city.
    expect(page).toContain('useMenuSearch(term, allRegions ? undefined : regionId)');
  });

  it('offers the whole country when the chosen city is empty', () => {
    /*
     * Scoping search to the city created a dead end the shopfront never had: a
     * city with no restaurants answered every search with nothing and no way
     * forward. The same escape hatch, and the city on every card while it is
     * open so nobody has to guess where a result is.
     */
    const page = code('src/app/search/page.tsx');
    expect(page).toContain("t('home.showAllRegions')");
    expect(page).toContain('regionLabel={allRegions ? regionName(restaurant.regionId) : null}');
    // And the reason, above the results rather than after the basket.
    expect(page).toContain("t('home.allRegionsNotice'");
  });

  it('names the city on the shopfront cards too, and only then', () => {
    const home = code('src/app/page.tsx');
    expect(home).toContain('regionLabel={showRegion ? regionName(restaurant.regionId) : null}');
    expect(home).toContain('showRegion={allRegions}');
  });

  it('orders open first, then nearest, then rating — from one comparator', () => {
    // Two screens with two copies of this rule is how a grid changes order when
    // somebody taps the search icon.
    const rule = code('shared/nearby.ts');
    expect(rule).toContain('export function compareByProximity');
    expect(code('src/app/search/page.tsx')).toContain('compareByProximity(');
    expect(code('src/components/customer/RestaurantFilters.tsx')).toContain('compareByProximity(');
  });

  it('treats an unknown distance as unknown, never as zero', () => {
    // A restaurant whose owner never dropped a pin would otherwise sort above
    // the one across the street.
    const rule = code('shared/nearby.ts');
    expect(rule).toContain('if (a.distance === null) return 1');
    expect(rule).toContain('if (b.distance === null) return -1');
  });

  it('guesses nothing when there is no address', () => {
    // No IP lookup and no geolocation prompt: the answer that buys is a
    // city-level guess the region picker already gives, and the prompt is how
    // an app gets refused permission for good.
    const hook = code('src/hooks/useCustomerPoint.ts');
    expect(hook).not.toContain('geolocation');
    expect(hook).toContain('watchAddresses(uid');
  });

  it('shows the distance on the card only when it is real', () => {
    const card = code('src/components/customer/RestaurantCard.tsx');
    expect(card).toContain("typeof distance === 'number'");
    expect(card).toContain('formatDistance(distance)');
  });
});
