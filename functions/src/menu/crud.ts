/**
 * QAPINDA — Menu editing.
 *
 * The brief asked for restaurants to be able to change their menus easily. Easy
 * is a UI property, not a permission one: these callables are deliberately
 * forgiving about what a restaurant may change and strict about who may change
 * it, and every price movement lands in the audit log so a dispute about "it
 * said 6 manat when I ordered" has an answer.
 *
 * Toggling a dish as sold-out is separated from editing it, because that is the
 * one action a kitchen does mid-service and it is safe for junior staff.
 */

import { onCall } from 'firebase-functions/v2/https';

import { db, now } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser, requireRestaurantAccess } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import {
  asObject,
  optionalBoolean,
  optionalInt,
  optionalString,
  requireArray,
  requireEnum,
  requireInt,
  requireString,
  sanitiseText,
} from '../lib/validate';
import { buildSearchTokens } from '../shared/search';
import { AppErrorCode } from '../shared/errors';
import { AuditAction, ModifierSelection, ProductAvailability } from '../shared/enums';
import { isDiscounted, refreshDiscountFlag } from './discounts';
import { isRestaurantVisible } from './visibility';
import { COLLECTIONS, paths } from '../shared/collections';
import { Permission } from '../shared/permissions';
import type { MenuCategory, ModifierGroup, Product, Restaurant } from '../shared/models';

const MAX_MODIFIER_GROUPS = 8;
const MAX_OPTIONS_PER_GROUP = 20;
const MAX_PRICE = 100_000; // 1000 ₼ — a sanity ceiling, not a business rule.

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const saveMenuCategory = onCall(
  guard('saveMenuCategory', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });

    requireRestaurantAccess(caller, Permission.MENU_EDIT, restaurantId);

    const categoryId = optionalString(data, 'categoryId', { max: 128 });
    const name = requireString(data, 'name', { min: 1, max: 60 });
    const sortOrder = requireInt(data, 'sortOrder', { min: 0, max: 999 });
    const visible = optionalBoolean(data, 'visible', true);

    const ref = categoryId
      ? db.doc(paths.menuCategory(categoryId))
      : db.collection(COLLECTIONS.menuCategories).doc();

    if (categoryId) {
      const existing = await ref.get();
      if (!existing.exists) fail(AppErrorCode.CATEGORY_NOT_FOUND);
      // The tenant check again, on the stored document — a client could have
      // sent its own restaurantId alongside someone else's categoryId.
      if ((existing.data() as MenuCategory).restaurantId !== restaurantId) {
        fail(AppErrorCode.NOT_YOUR_RESTAURANT);
      }
    }

    const category: Omit<MenuCategory, 'createdAt' | 'updatedAt'> = {
      id: ref.id,
      restaurantId,
      name,
      sortOrder,
      visible,
    };

    await ref.set(
      categoryId
        ? { ...category, updatedAt: now() }
        : { ...category, createdAt: now(), updatedAt: now() },
      { merge: true },
    );

    return { ok: true, categoryId: ref.id };
  }),
);

/** Refuses to delete a category that still has dishes in it. */
export const deleteMenuCategory = onCall(
  guard('deleteMenuCategory', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const categoryId = requireString(data, 'categoryId', { max: 128 });

    requireRestaurantAccess(caller, Permission.MENU_EDIT, restaurantId);

    const ref = db.doc(paths.menuCategory(categoryId));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.CATEGORY_NOT_FOUND);
    if ((snapshot.data() as MenuCategory).restaurantId !== restaurantId) {
      fail(AppErrorCode.NOT_YOUR_RESTAURANT);
    }

    const products = await db
      .collection(COLLECTIONS.products)
      .where('restaurantId', '==', restaurantId)
      .where('categoryId', '==', categoryId)
      .limit(1)
      .get();
    if (!products.empty) fail(AppErrorCode.CATEGORY_NOT_EMPTY);

    await ref.delete();
    return { ok: true };
  }),
);

/** Drag-and-drop reordering, committed in one batch. */
export const reorderMenuCategories = onCall(
  guard('reorderMenuCategories', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });

    requireRestaurantAccess(caller, Permission.MENU_EDIT, restaurantId);

    const order = requireArray<string>(data, 'categoryIds', { max: 100 });
    const snapshots = await db
      .collection(COLLECTIONS.menuCategories)
      .where('restaurantId', '==', restaurantId)
      .get();

    const owned = new Set(snapshots.docs.map((doc) => doc.id));
    const batch = db.batch();
    order.forEach((categoryId, index) => {
      if (typeof categoryId !== 'string' || !owned.has(categoryId)) {
        fail(AppErrorCode.NOT_YOUR_RESTAURANT);
      }
      batch.update(db.doc(paths.menuCategory(categoryId)), {
        sortOrder: index,
        updatedAt: now(),
      });
    });
    await batch.commit();

    return { ok: true, count: order.length };
  }),
);

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/**
 * Validates the modifier configuration a restaurant typed in.
 *
 * A group that says "choose between 3 and 2" or "required, but choose zero"
 * would be a cart the customer can never satisfy — better to refuse it in the
 * editor than to strand an order at checkout.
 */
function parseModifierGroups(input: unknown): ModifierGroup[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > MAX_MODIFIER_GROUPS) {
    fail(AppErrorCode.VALIDATION_FAILED, 'modifierGroups');
  }

  return input.map((raw, groupIndex) => {
    const group = raw as Record<string, unknown>;

    const id =
      typeof group.id === 'string' && group.id.trim()
        ? sanitiseText(group.id.trim()).slice(0, 64)
        : `g${groupIndex}-${Math.random().toString(36).slice(2, 8)}`;
    const name = typeof group.name === 'string' ? sanitiseText(group.name.trim()) : '';
    if (!name || name.length > 60) fail(AppErrorCode.VALIDATION_FAILED, 'modifierGroups.name');

    const selection =
      group.selection === ModifierSelection.MULTIPLE
        ? ModifierSelection.MULTIPLE
        : ModifierSelection.SINGLE;
    const required = group.required === true;

    const rawOptions = group.options;
    if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
      fail(AppErrorCode.VALIDATION_FAILED, 'modifierGroups.options');
    }
    if (rawOptions.length > MAX_OPTIONS_PER_GROUP) {
      fail(AppErrorCode.VALIDATION_FAILED, 'modifierGroups.options');
    }

    const seen = new Set<string>();
    const options = rawOptions.map((rawOption, optionIndex) => {
      const option = rawOption as Record<string, unknown>;

      const optionId =
        typeof option.id === 'string' && option.id.trim()
          ? sanitiseText(option.id.trim()).slice(0, 64)
          : `${id}-o${optionIndex}`;
      if (seen.has(optionId)) fail(AppErrorCode.VALIDATION_FAILED, 'modifierGroups.duplicate');
      seen.add(optionId);

      const optionName = typeof option.name === 'string' ? sanitiseText(option.name.trim()) : '';
      if (!optionName || optionName.length > 60) {
        fail(AppErrorCode.VALIDATION_FAILED, 'modifierGroups.option.name');
      }

      const priceDelta = option.priceDelta;
      if (
        typeof priceDelta !== 'number' ||
        !Number.isInteger(priceDelta) ||
        priceDelta < 0 ||
        priceDelta > MAX_PRICE
      ) {
        // A negative delta would be a discount hidden inside the menu, outside
        // the coupon system and therefore outside commission accounting.
        fail(AppErrorCode.VALIDATION_FAILED, 'modifierGroups.option.priceDelta');
      }

      return {
        id: optionId,
        name: optionName,
        priceDelta,
        available: option.available !== false,
      };
    });

    const maxCeiling = selection === ModifierSelection.SINGLE ? 1 : options.length;
    const minSelect =
      typeof group.minSelect === 'number' && Number.isInteger(group.minSelect)
        ? Math.max(0, Math.min(group.minSelect, maxCeiling))
        : required
          ? 1
          : 0;
    const maxSelect =
      typeof group.maxSelect === 'number' && Number.isInteger(group.maxSelect) && group.maxSelect > 0
        ? Math.min(group.maxSelect, maxCeiling)
        : maxCeiling;

    if (minSelect > maxSelect) fail(AppErrorCode.VALIDATION_FAILED, 'modifierGroups.range');
    if (required && minSelect < 1) fail(AppErrorCode.VALIDATION_FAILED, 'modifierGroups.required');

    // A required group whose every option is switched off cannot be satisfied.
    if (required && !options.some((option) => option.available)) {
      fail(AppErrorCode.VALIDATION_FAILED, 'modifierGroups.allUnavailable');
    }

    return { id, name, selection, required, minSelect, maxSelect, options };
  });
}

export const saveProduct = onCall(
  guard('saveProduct', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });

    requireRestaurantAccess(caller, Permission.MENU_EDIT, restaurantId);

    const productId = optionalString(data, 'productId', { max: 128 });
    const categoryId = requireString(data, 'categoryId', { max: 128 });
    const name = requireString(data, 'name', { min: 1, max: 80 });
    const description = optionalString(data, 'description', { max: 400 }) ?? '';
    const price = requireInt(data, 'price', { min: 0, max: MAX_PRICE });
    const compareAtPrice = optionalInt(data, 'compareAtPrice', { min: 0, max: MAX_PRICE });

    // A struck-through price that is not higher than the real one is either a
    // mistake or a trick. Refuse both here rather than debating it later.
    if (compareAtPrice !== null && compareAtPrice <= price) {
      fail(AppErrorCode.VALIDATION_FAILED, 'compareAtPrice');
    }
    const sortOrder = requireInt(data, 'sortOrder', { min: 0, max: 9999 });
    const popular = optionalBoolean(data, 'popular', false);
    const imageUrl = optionalString(data, 'imageUrl', { max: 500 });
    const availability = requireEnum<ProductAvailability>(data, 'availability', [
      ProductAvailability.AVAILABLE,
      ProductAvailability.OUT_OF_STOCK_TODAY,
      ProductAvailability.HIDDEN,
    ]);
    const modifierGroups = parseModifierGroups(data.modifierGroups);

    const category = await db.doc(paths.menuCategory(categoryId)).get();
    if (!category.exists) fail(AppErrorCode.CATEGORY_NOT_FOUND);
    if ((category.data() as MenuCategory).restaurantId !== restaurantId) {
      fail(AppErrorCode.NOT_YOUR_RESTAURANT);
    }

    const ref = productId
      ? db.doc(paths.product(productId))
      : db.collection(COLLECTIONS.products).doc();

    /*
     * The restaurant's name goes into the dish's tokens.
     *
     * Somebody searching "Dönərçi" is looking for the shop, and until now no
     * dish carried the name on its sign — so the one search a customer is most
     * likely to type found nothing at all. Read once per save, which is a
     * write-time cost paid so that read time stays one query.
     */
    const restaurantSnapshot = await db.doc(paths.restaurant(restaurantId)).get();
    const stored = restaurantSnapshot.data() as Restaurant | undefined;
    const restaurantName = stored?.name ?? null;

    let previousPrice: number | null = null;

    if (productId) {
      const existing = await ref.get();
      if (!existing.exists) fail(AppErrorCode.PRODUCT_NOT_FOUND);
      const stored = existing.data() as Product;
      if (stored.restaurantId !== restaurantId) fail(AppErrorCode.NOT_YOUR_RESTAURANT);
      previousPrice = stored.price;
    }

    const product: Omit<Product, 'createdAt' | 'updatedAt'> = {
      id: ref.id,
      restaurantId,
      categoryId,
      name,
      description,
      price,
      compareAtPrice,
      imageUrl,
      availability,
      popular,
      sortOrder,
      modifierGroups,
      // Rebuilt on every save, so a renamed dish is findable under its new
      // name immediately and not under the old one.
      searchTokens: buildSearchTokens({ name, description, restaurantName }),
      // Computed here, once, because the query that needs it cannot compute it
      // — Firestore compares a field to a value, never to another field.
      discounted: isDiscounted({ price, compareAtPrice, availability }),
      // Whether this dish's SHOP is public, mirrored onto the dish so the
      // security rule can answer without reading the restaurant document for
      // every product in a four-hundred-item menu. See menu/visibility.ts.
      restaurantVisible: isRestaurantVisible(stored?.status),
    };

    await ref.set(
      productId
        ? { ...product, updatedAt: now() }
        : { ...product, createdAt: now(), updatedAt: now() },
      { merge: true },
    );

    // Price history matters: it is the evidence in a "you charged me more than
    // the menu said" dispute.
    if (previousPrice !== null && previousPrice !== price) {
      await writeAudit({
        actorId: caller.uid,
        actorRole: user.role,
        action: AuditAction.MENU_PRICE_CHANGED,
        targetType: 'product',
        targetId: ref.id,
        restaurantId,
        oldValue: { price: previousPrice },
        newValue: { price },
      });
    }

    // The card's badge, refreshed from one query. After the write, never inside
    // it: a stale badge is a smaller problem than a menu save that failed.
    await refreshDiscountFlag(restaurantId);

    return { ok: true, productId: ref.id };
  }),
);

export const deleteProduct = onCall(
  guard('deleteProduct', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const productId = requireString(data, 'productId', { max: 128 });

    requireRestaurantAccess(caller, Permission.MENU_EDIT, restaurantId);

    const ref = db.doc(paths.product(productId));
    const snapshot = await ref.get();
    if (!snapshot.exists) return { ok: true };
    if ((snapshot.data() as Product).restaurantId !== restaurantId) {
      fail(AppErrorCode.NOT_YOUR_RESTAURANT);
    }

    // Deleting is safe: past orders carry their own frozen copy of the item.
    await ref.delete();

    // The deleted dish may have been the only one on offer.
    await refreshDiscountFlag(restaurantId);

    return { ok: true };
  }),
);

/**
 * The mid-service switch: sold out, back on, hidden.
 *
 * Kitchen staff may use this without holding MENU_EDIT, because running out of
 * chicken at eight in the evening should not need the owner's phone.
 */
export const setProductAvailability = onCall(
  guard('setProductAvailability', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const productId = requireString(data, 'productId', { max: 128 });
    const availability = requireEnum<ProductAvailability>(data, 'availability', [
      ProductAvailability.AVAILABLE,
      ProductAvailability.OUT_OF_STOCK_TODAY,
      ProductAvailability.HIDDEN,
    ]);

    requireRestaurantAccess(caller, Permission.MENU_TOGGLE_AVAILABILITY, restaurantId);

    const ref = db.doc(paths.product(productId));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.PRODUCT_NOT_FOUND);
    const stored = snapshot.data() as Product;
    if (stored.restaurantId !== restaurantId) {
      fail(AppErrorCode.NOT_YOUR_RESTAURANT);
    }

    /*
     * `discounted` moves with availability.
     *
     * A dish marked sold out for the day is still on the menu and its offer
     * still stands; a HIDDEN one is not on the menu at all, so its discount is
     * not an offer to anybody. Writing the derived value here keeps the two in
     * step without a second place deciding what "on offer" means.
     */
    await ref.update({
      availability,
      discounted: isDiscounted({ price: stored.price, compareAtPrice: stored.compareAtPrice, availability }),
      updatedAt: now(),
    });

    await refreshDiscountFlag(restaurantId);

    return { ok: true };
  }),
);

export const reorderProducts = onCall(
  guard('reorderProducts', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });

    requireRestaurantAccess(caller, Permission.MENU_EDIT, restaurantId);

    const order = requireArray<string>(data, 'productIds', { max: 300 });
    const snapshots = await db
      .collection(COLLECTIONS.products)
      .where('restaurantId', '==', restaurantId)
      .get();
    const owned = new Set(snapshots.docs.map((doc) => doc.id));

    // Firestore caps a batch at 500 writes.
    const chunks: string[][] = [];
    for (let index = 0; index < order.length; index += 400) {
      chunks.push(order.slice(index, index + 400));
    }

    let position = 0;
    for (const chunk of chunks) {
      const batch = db.batch();
      for (const productId of chunk) {
        if (typeof productId !== 'string' || !owned.has(productId)) {
          fail(AppErrorCode.NOT_YOUR_RESTAURANT);
        }
        batch.update(db.doc(paths.product(productId)), {
          sortOrder: position,
          updatedAt: now(),
        });
        position += 1;
      }
      await batch.commit();
    }

    return { ok: true, count: order.length };
  }),
);

/**
 * Bulk price update — "everything up 10%".
 *
 * Capped and audited as a single event, because the alternative is a restaurant
 * clicking through forty dishes and mistyping one of them.
 */
export const bulkAdjustPrices = onCall(
  guard('bulkAdjustPrices', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });

    requireRestaurantAccess(caller, Permission.MENU_EDIT, restaurantId);

    // Basis points, −5000 … +5000: half off to half again, no more.
    const deltaBps = requireInt(data, 'deltaBps', { min: -5000, max: 5000 });
    const categoryId = optionalString(data, 'categoryId', { max: 128 });
    if (deltaBps === 0) return { ok: true, updated: 0 };

    let query = db
      .collection(COLLECTIONS.products)
      .where('restaurantId', '==', restaurantId) as FirebaseFirestore.Query;
    if (categoryId) query = query.where('categoryId', '==', categoryId);

    const snapshots = await query.get();
    const batch = db.batch();
    let updated = 0;

    for (const doc of snapshots.docs) {
      const product = doc.data() as Product;
      const next = Math.max(0, Math.min(MAX_PRICE, Math.round((product.price * (10000 + deltaBps)) / 10000)));
      if (next === product.price) continue;
      batch.update(doc.ref, {
        price: next,
        /*
         * A price rise can cancel a discount without anybody saying so.
         *
         * This changes `price` and leaves `compareAtPrice` where it was, so a
         * ten per cent rise can lift the price above the "before" figure — and
         * then the menu is advertising a saving that has become a markup.
         * Recomputing here keeps the badge honest; the struck-through figure
         * itself is the restaurant's to fix, and the panel shows it plainly.
         */
        discounted: isDiscounted({
          price: next,
          compareAtPrice: product.compareAtPrice,
          availability: product.availability,
        }),
        updatedAt: now(),
      });
      updated += 1;
    }

    if (updated > 0) await batch.commit();

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.MENU_PRICE_CHANGED,
      targetType: 'restaurant',
      targetId: restaurantId,
      restaurantId,
      newValue: { deltaBps, categoryId, updated },
      reason: 'bulk price adjustment',
    });

    if (updated > 0) await refreshDiscountFlag(restaurantId);

    return { ok: true, updated };
  }),
);
