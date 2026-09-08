/**
 * The operator's view of the customer behind one order.
 *
 * THE ONE THING THAT MATTERS HERE
 * -------------------------------
 * The request names an ORDER. It must never name a customer.
 *
 * That single property is the difference between a support tool and a directory
 * of every customer on the platform, searchable by anybody who ever held an
 * operator login — and the difference is one line of code that would be easy to
 * "improve" away when somebody wants to look up a customer directly. So the
 * first block below asserts it from several angles.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const server = fs.readFileSync('functions/src/complaints/context.ts', 'utf8');

/**
 * The file with its prose taken out.
 *
 * The comments deliberately NAME what is not returned — "their email, their
 * other accounts' details" — so a plain text search finds those words in the
 * explanation of why they are absent. Asserting against the code alone is what
 * makes the assertion mean what it says.
 */
const code = server.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const client = fs.readFileSync('src/components/panel/CustomerOrderContext.tsx', 'utf8');
const complaints = fs.readFileSync('src/components/panel/ComplaintsQueue.tsx', 'utf8');

describe('the caller cannot name a customer', () => {
  it('reads the customer id from the order document', () => {
    expect(server).toContain('const customerId = subject.customerId;');
  });

  it('never takes a customer id out of the request', () => {
    // `asObject(request.data)` is read once, into `data`. Any `customerId`
    // pulled from it would be the whole vulnerability.
    expect(code).not.toMatch(/data,\s*'customerId'/);
    expect(code).not.toMatch(/data\.customerId/);
  });

  it('refuses an order that does not exist rather than returning an empty page', () => {
    expect(server).toContain('fail(AppErrorCode.ORDER_NOT_FOUND)');
  });

  it('requires the permission that already grants the orders board', () => {
    expect(server).toContain('requirePermission(caller, Permission.PLATFORM_VIEW_ORDERS)');
  });
});

describe('what it does and does not return', () => {
  it('returns nothing about the customer beyond a name and a number', () => {
    // A support tool that returns everything about a person leaks everything
    // about that person the first time an operator account is phished.
    expect(code).not.toContain('SUBCOLLECTIONS.addresses');
    expect(code).not.toContain('paths.user(');
    expect(code).not.toMatch(/\bemail\b/i);
  });

  it('names the customer from the order’s frozen snapshot', () => {
    // So an anonymised customer still reads as the person who placed the
    // order, rather than as a blank row nobody can make sense of.
    expect(server).toContain('name: subject.customerName');
  });

  it('reads refunds from the payment, not from the order', () => {
    // Only an online order has a payment. A cash order's zero is a fact.
    expect(server).toContain('COLLECTIONS.payments');
    expect(server).toContain('refundedAmount');
  });

  it('bounds the window', () => {
    expect(server).toContain('ORDER_WINDOW');
    expect(server).toContain('truncated:');
  });

  it('always includes the order being worked on', () => {
    // A customer who has ordered thirty times since would otherwise open a
    // context screen that does not contain the order in front of them.
    expect(server).toContain('isSubject');
    expect(server).toContain('ordersSnap.docs.some((doc) => doc.id === orderId)');
  });
});

describe('who sees it', () => {
  it('is not shown to a restaurant', () => {
    // `customerContact` is the flag that already separates the desk from the
    // restaurant on this screen. A restaurant has no business seeing what its
    // customer ordered from anybody else.
    expect(complaints).toContain('{customerContact && <CustomerOrderContext');
  });

  it('loads only when somebody opens it', () => {
    // Most complaints do not need it, and fetching twenty-five orders for
    // every drawer would be a round trip nobody asked for.
    expect(client).toContain('if (context || loading) return;');
  });
});
