import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateShopName,
  validateOwnerName,
  validateAndNormalizeIndianPhone,
  validateOtpCode,
} from './validation';

test('validateShopName enforces required 2-50 character bounds', () => {
  assert.equal(validateShopName('').valid, false);
  assert.equal(validateShopName('').errorKey, 'errShopNameRequired');
  assert.equal(validateShopName('   ').valid, false);
  assert.equal(validateShopName('A').valid, false);
  assert.equal(validateShopName('A').errorKey, 'errShopNameTooShort');

  assert.equal(validateShopName('OM').valid, true);
  assert.equal(validateShopName('  शर्मा किराना स्टोर  ').sanitized, 'शर्मा किराना स्टोर');

  const fiftyChars = 'A'.repeat(50);
  assert.equal(validateShopName(fiftyChars).valid, true);

  const fiftyOneChars = 'A'.repeat(51);
  assert.equal(validateShopName(fiftyOneChars).valid, false);
  assert.equal(validateShopName(fiftyOneChars).errorKey, 'errShopNameTooLong');
});

test('validateOwnerName allows empty optional string and enforces <= 50 chars', () => {
  assert.equal(validateOwnerName('').valid, true);
  assert.equal(validateOwnerName('Ramesh Sharma').valid, true);
  assert.equal(validateOwnerName('X'.repeat(51)).valid, false);
});

test('validateAndNormalizeIndianPhone normalizes 10-digit Indian numbers to +91', () => {
  assert.equal(validateAndNormalizeIndianPhone('').valid, true);
  assert.equal(validateAndNormalizeIndianPhone('').sanitized, '');

  const valid10 = validateAndNormalizeIndianPhone('98765 43210');
  assert.equal(valid10.valid, true);
  assert.equal(valid10.sanitized, '+919876543210');

  const validPlus = validateAndNormalizeIndianPhone('+919876543210');
  assert.equal(validPlus.valid, true);
  assert.equal(validPlus.sanitized, '+919876543210');

  assert.equal(validateAndNormalizeIndianPhone('12345').valid, false);
  assert.equal(validateAndNormalizeIndianPhone('5123456789').valid, false);
});

test('validateOtpCode requires exactly 6 digits', () => {
  assert.equal(validateOtpCode('123456').valid, true);
  assert.equal(validateOtpCode('12345').valid, false);
  assert.equal(validateOtpCode('1234567').valid, false);
});
