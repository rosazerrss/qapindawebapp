/**
 * Input validation.
 *
 * Every callable runs its payload through here first. Nothing that arrives from
 * a browser is assumed to be the shape it claims — not the types, not the
 * lengths, and certainly not the prices.
 */

import { createHash } from 'node:crypto';

import { fail } from './errors';
import { AppErrorCode } from '../shared/errors';

type Payload = Record<string, unknown>;

export function asObject(data: unknown): Payload {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail(AppErrorCode.VALIDATION_FAILED, 'payload');
  }
  return data as Payload;
}

export function requireString(
  data: Payload,
  field: string,
  { min = 1, max = 500 }: { min?: number; max?: number } = {},
): string {
  const value = data[field];
  if (typeof value !== 'string') fail(AppErrorCode.VALIDATION_FAILED, field);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    fail(AppErrorCode.VALIDATION_FAILED, field);
  }
  return sanitiseText(trimmed);
}

export function optionalString(
  data: Payload,
  field: string,
  { max = 500 }: { max?: number } = {},
): string | null {
  const value = data[field];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') fail(AppErrorCode.VALIDATION_FAILED, field);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) fail(AppErrorCode.VALIDATION_FAILED, field);
  return sanitiseText(trimmed);
}

export function requireInt(
  data: Payload,
  field: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  const value = data[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(AppErrorCode.VALIDATION_FAILED, field);
  }
  return value;
}

export function optionalInt(
  data: Payload,
  field: string,
  options: { min?: number; max?: number } = {},
): number | null {
  if (data[field] === undefined || data[field] === null) return null;
  return requireInt(data, field, options);
}

export function requireBoolean(data: Payload, field: string): boolean {
  const value = data[field];
  if (typeof value !== 'boolean') fail(AppErrorCode.VALIDATION_FAILED, field);
  return value;
}

export function optionalBoolean(data: Payload, field: string, fallback: boolean): boolean {
  if (data[field] === undefined || data[field] === null) return fallback;
  return requireBoolean(data, field);
}

export function requireEnum<T extends string>(
  data: Payload,
  field: string,
  allowed: readonly T[],
): T {
  const value = data[field];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(AppErrorCode.VALIDATION_FAILED, field);
  }
  return value as T;
}

export function requireArray<T>(
  data: Payload,
  field: string,
  { max = 100 }: { max?: number } = {},
): T[] {
  const value = data[field];
  if (!Array.isArray(value) || value.length > max) fail(AppErrorCode.VALIDATION_FAILED, field);
  return value as T[];
}

export function optionalStringArray(
  data: Payload,
  field: string,
  { max = 100, maxLength = 200 }: { max?: number; maxLength?: number } = {},
): string[] {
  const value = data[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) fail(AppErrorCode.VALIDATION_FAILED, field);
  return value.map((entry) => {
    if (typeof entry !== 'string' || entry.length > maxLength) {
      fail(AppErrorCode.VALIDATION_FAILED, field);
    }
    return sanitiseText(entry.trim());
  });
}

/**
 * Strips control characters. Not an HTML sanitiser — React escapes on render —
 * but it stops invisible characters being smuggled into names and notes, where
 * they are used to fake duplicate-looking accounts and to break log parsing.
 */
export function sanitiseText(value: string): string {
  // C0/C1 controls, then the zero-width and BOM characters.
  return value
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Azerbaijani mobile numbers in E.164: +994 followed by 9 digits. */
const AZ_PHONE = /^\+994(10|50|51|55|60|70|77|99)\d{7}$/;

export function requirePhone(data: Payload, field = 'phone'): string {
  const raw = requireString(data, field, { min: 9, max: 20 });
  const compact = raw.replace(/[\s()-]/g, '');
  const e164 = compact.startsWith('+')
    ? compact
    : compact.startsWith('994')
      ? `+${compact}`
      : compact.startsWith('0')
        ? `+994${compact.slice(1)}`
        : `+994${compact}`;

  if (!AZ_PHONE.test(e164)) fail(AppErrorCode.INVALID_PHONE);
  return e164;
}

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function optionalEmail(data: Payload, field = 'email'): string | null {
  const value = optionalString(data, field, { max: 254 });
  if (!value) return null;
  const lower = value.toLowerCase();
  if (!EMAIL.test(lower)) fail(AppErrorCode.INVALID_EMAIL);
  return lower;
}

/**
 * A stable fingerprint of a delivery address.
 *
 * Coupon limits are counted per household, and a household is best identified
 * by where the food goes. The hash means the limit can be enforced without
 * storing a second copy of everyone's address in a queryable index.
 */
export function hashAddress(city: string, line: string): string {
  const normalised = `${city}|${line}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
  return createHash('sha256').update(normalised).digest('hex').slice(0, 32);
}
