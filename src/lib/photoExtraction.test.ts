import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHOTO_EXTRACTION_PROMPT,
  PHOTO_MESSY_REGISTER_TEST_CASES,
  PhotoExtractionSchema,
  enforcePhotoRowUncertainty,
  executePhotoExtractionWithSingleRetry,
  isPhotoRetakeRequired,
  isSafeSourceImageUrl,
  mapPhotoRowToPendingEntry,
  parseAndValidatePhotoExtraction,
} from './photoExtraction';

test('PHOTO_EXTRACTION_PROMPT enforces never-guess null + uncertainFields and imageQuality rules', () => {
  assert.match(PHOTO_EXTRACTION_PROMPT, /NEVER GUESS ILLEGIBLE VALUES/i);
  assert.match(PHOTO_EXTRACTION_PROMPT, /uncertainFields/);
  assert.match(PHOTO_EXTRACTION_PROMPT, /imageQuality/);
  assert.match(PHOTO_EXTRACTION_PROMPT, /blurry/);
  assert.match(PHOTO_EXTRACTION_PROMPT, /unreadable/);
});

test('all 5 messy-register test cases validate with Zod, enforce retake rules, and map rows strictly to pending integer paise', () => {
  assert.equal(PHOTO_MESSY_REGISTER_TEST_CASES.length, 5);

  for (const tc of PHOTO_MESSY_REGISTER_TEST_CASES) {
    const validated = PhotoExtractionSchema.safeParse(tc.expected);
    assert.equal(
      validated.success,
      true,
      `Test case #${tc.id} failed Zod validation: ${validated.success ? '' : validated.error.message}`
    );

    const retake = isPhotoRetakeRequired(tc.expected);
    assert.equal(retake, tc.expectRetake, `Test case #${tc.id} retake flag mismatch`);
    assert.equal(tc.expected.rows.length, tc.expectedPendingRowCount);

    for (let i = 0; i < tc.expected.rows.length; i += 1) {
      const row = tc.expected.rows[i];
      const pending = mapPhotoRowToPendingEntry(row, 'shop_owner_1', 'hi', {
        sourceImageUrl: 'https://firebasestorage.googleapis.com/v0/b/test/o/register.jpg',
        rowIndex: i,
      });

      // Rule 2: Always pending, never auto-confirmed
      assert.equal(pending.status, 'pending');
      assert.equal(pending.source, 'camera');
      assert.equal(
        pending.sourceImageUrl,
        'https://firebasestorage.googleapis.com/v0/b/test/o/register.jpg'
      );

      // Rule 4: Integer paise or null
      if (row.amount === null) {
        assert.equal(pending.amountPaise, null);
        assert.ok(pending.uncertainFields?.includes('amount'));
      } else {
        assert.equal(pending.amountPaise, Math.round(row.amount * 100));
      }
    }
  }
});

test('enforcePhotoRowUncertainty automatically marks null values as uncertain even if model omitted them', () => {
  const audited = enforcePhotoRowUncertainty({
    date: null,
    customerName: null,
    item: 'Chini 2kg',
    amount: null,
    type: null,
    confidence: 0.88,
    uncertainFields: [],
  });

  assert.ok(audited.uncertainFields.includes('date'));
  assert.ok(audited.uncertainFields.includes('customerName'));
  assert.ok(audited.uncertainFields.includes('amount'));
  assert.ok(audited.uncertainFields.includes('type'));
  assert.equal(audited.uncertainFields.includes('item'), false);
});

test('parseAndValidatePhotoExtraction rejects invalid quality enum or negative amounts', () => {
  const badQuality = JSON.stringify({ rows: [], imageQuality: 'terrible' });
  assert.equal(parseAndValidatePhotoExtraction(badQuality).ok, false);

  const negativeAmt = JSON.stringify({
    imageQuality: 'good',
    rows: [
      {
        date: '2026-11-24',
        customerName: 'Ramesh',
        item: 'Atta',
        amount: -250,
        type: 'sale',
        confidence: 0.9,
        uncertainFields: [],
      },
    ],
  });
  assert.equal(parseAndValidatePhotoExtraction(negativeAmt).ok, false);
});

test('executePhotoExtractionWithSingleRetry retries once on invalid JSON and succeeds on second attempt', async () => {
  const attempts: number[] = [];
  const outcome = await executePhotoExtractionWithSingleRetry(async (attempt) => {
    attempts.push(attempt);
    if (attempt === 1) return 'not-json';
    return JSON.stringify(PHOTO_MESSY_REGISTER_TEST_CASES[0].expected);
  });

  assert.deepEqual(attempts, [1, 2]);
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.attempts, 2);
    assert.equal(outcome.retakeRequired, false);
    assert.equal(outcome.data.rows.length, 3);
  }
});

test('isSafeSourceImageUrl allows only HTTPS URLs and blocks javascript:/data:/http:', () => {
  assert.equal(
    isSafeSourceImageUrl('https://firebasestorage.googleapis.com/v0/b/app/o/img.jpg'),
    true
  );
  assert.equal(isSafeSourceImageUrl('javascript:alert(1)'), false);
  assert.equal(isSafeSourceImageUrl('data:image/jpeg;base64,abc'), false);
  assert.equal(isSafeSourceImageUrl('http://example.com/img.jpg'), false);
  assert.equal(isSafeSourceImageUrl(''), false);
});
