import type { TranslationKey } from './i18n';

/**
 * Validation constants synchronized verbatim with firebase-blueprint.json & firestore.rules.
 */
export const SHOP_NAME_MIN_LEN = 2;
export const SHOP_NAME_MAX_LEN = 50;
export const OWNER_NAME_MAX_LEN = 50;
export const PHONE_MAX_LEN = 20;
export const PHONE_REGEX = /^(\+?[0-9]{10,15})?$/;
export const CUSTOMER_NAME_MAX_LEN = 60;
export const NOTE_MAX_LEN = 140;

export interface ValidationResult {
  valid: boolean;
  errorKey?: TranslationKey;
  sanitized: string;
}

export function validateShopName(raw: string): ValidationResult {
  const sanitized = raw.trim().replace(/\s+/g, ' ');
  if (sanitized.length === 0) {
    return { valid: false, errorKey: 'errShopNameRequired', sanitized };
  }
  if (sanitized.length < SHOP_NAME_MIN_LEN) {
    return { valid: false, errorKey: 'errShopNameTooShort', sanitized };
  }
  if (sanitized.length > SHOP_NAME_MAX_LEN) {
    return { valid: false, errorKey: 'errShopNameTooLong', sanitized };
  }
  return { valid: true, sanitized };
}

export function validateOwnerName(raw: string): ValidationResult {
  const sanitized = raw.trim().replace(/\s+/g, ' ');
  if (sanitized.length > OWNER_NAME_MAX_LEN) {
    return { valid: false, errorKey: 'errOwnerNameTooLong', sanitized };
  }
  return { valid: true, sanitized };
}

/**
 * Accepts empty string (optional), 10-digit Indian mobile (9876543210),
 * or +919876543210. Normalizes to E.164 (+91XXXXXXXXXX) when present.
 */
export function validateAndNormalizeIndianPhone(raw: string): ValidationResult {
  const cleaned = raw.trim().replace(/[\s\-()]/g, '');
  if (cleaned.length === 0) {
    return { valid: true, sanitized: '' };
  }

  let normalized = cleaned;
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    normalized = `+91${cleaned}`;
  } else if (/^91[6-9]\d{9}$/.test(cleaned)) {
    normalized = `+${cleaned}`;
  } else if (/^\+91[6-9]\d{9}$/.test(cleaned)) {
    normalized = cleaned;
  } else {
    return { valid: false, errorKey: 'errPhoneInvalid', sanitized: cleaned };
  }

  if (normalized.length > PHONE_MAX_LEN || !PHONE_REGEX.test(normalized)) {
    return { valid: false, errorKey: 'errPhoneInvalid', sanitized: normalized };
  }

  return { valid: true, sanitized: normalized };
}

export function validateOtpCode(raw: string): ValidationResult {
  const sanitized = raw.trim().replace(/\D/g, '');
  if (!/^\d{6}$/.test(sanitized)) {
    return { valid: false, errorKey: 'errOtpInvalid', sanitized };
  }
  return { valid: true, sanitized };
}

export function sanitizeNote(raw: string): string {
  return raw.trim().slice(0, NOTE_MAX_LEN);
}

export function sanitizeCustomerName(raw: string): ValidationResult {
  const sanitized = raw.trim().replace(/\s+/g, ' ').slice(0, CUSTOMER_NAME_MAX_LEN);
  if (sanitized.length === 0) {
    return { valid: false, errorKey: 'errCustomerNameRequired', sanitized };
  }
  return { valid: true, sanitized };
}
