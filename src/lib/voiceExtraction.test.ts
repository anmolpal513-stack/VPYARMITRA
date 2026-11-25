import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VOICE_EXTRACTION_PROMPT,
  VOICE_TEST_UTTERANCES,
  VoiceExtractionSchema,
  LOW_CONFIDENCE_THRESHOLD,
  detectUncertainFields,
  executeVoiceExtractionWithSingleRetry,
  mapVoiceExtractionToPendingEntry,
  parseAndValidateVoiceExtraction,
} from './voiceExtraction';

test('VOICE_EXTRACTION_PROMPT includes Hindi number word conversion rules', () => {
  assert.match(VOICE_EXTRACTION_PROMPT, /paanch sau/i);
  assert.match(VOICE_EXTRACTION_PROMPT, /dhai hazaar/i);
  assert.match(VOICE_EXTRACTION_PROMPT, /dedh sau/i);
  assert.match(VOICE_EXTRACTION_PROMPT, /sawa sau/i);
  assert.match(VOICE_EXTRACTION_PROMPT, /udhaar_given/);
  assert.match(VOICE_EXTRACTION_PROMPT, /udhaar_received/);
});

test('all 10 Hindi/Hinglish test utterances validate with Zod and map strictly to pending integer paise entries', () => {
  assert.equal(VOICE_TEST_UTTERANCES.length, 10);

  for (const item of VOICE_TEST_UTTERANCES) {
    const parsed = VoiceExtractionSchema.safeParse(item.expected);
    assert.equal(
      parsed.success,
      true,
      `Utterance #${item.id} failed Zod validation: ${parsed.success ? '' : parsed.error.message}`
    );

    const pending = mapVoiceExtractionToPendingEntry(
      item.expected,
      'owner_shop_1',
      'hi',
      '2026-11-24T10:30:00.000Z'
    );

    // Non-negotiable Rule 2: NEVER auto-confirm voice entries
    assert.equal(pending.status, 'pending');
    assert.equal(pending.source, 'voice');
    // Non-negotiable Rule 4: Deterministic integer paise conversion
    assert.equal(pending.type, item.expectedLedgerType);
    assert.equal(pending.amountPaise, item.expectedAmountPaise);
    assert.equal(pending.transcript, item.expected.transcript);

    const hasUncertain = (pending.uncertainFields?.length ?? 0) > 0;
    assert.equal(
      hasUncertain,
      item.expectedUncertain,
      `Utterance #${item.id} uncertain expectation mismatch`
    );
  }
});

test('parseAndValidateVoiceExtraction strips markdown fences and rejects invalid types or negative amounts', () => {
  const validFenced =
    '```json\n{"customerName":"Ramesh","amount":500,"type":"udhaar_given","note":"Atta","confidence":0.9,"transcript":"Ramesh ko paanch sau udhaar"}\n```';
  const ok = parseAndValidateVoiceExtraction(validFenced);
  assert.equal(ok.ok, true);

  const negativeAmount = JSON.stringify({
    customerName: 'Ramesh',
    amount: -500,
    type: 'sale',
    note: '',
    confidence: 0.9,
    transcript: 'test',
  });
  const badAmount = parseAndValidateVoiceExtraction(negativeAmount);
  assert.equal(badAmount.ok, false);

  const badType = JSON.stringify({
    customerName: 'Ramesh',
    amount: 500,
    type: 'loan',
    note: '',
    confidence: 0.9,
    transcript: 'test',
  });
  assert.equal(parseAndValidateVoiceExtraction(badType).ok, false);
});

test('executeVoiceExtractionWithSingleRetry retries once on invalid JSON and succeeds on valid second response', async () => {
  const calls: number[] = [];
  const outcome = await executeVoiceExtractionWithSingleRetry(async (attempt) => {
    calls.push(attempt);
    if (attempt === 1) {
      return '{not valid json';
    }
    return JSON.stringify(VOICE_TEST_UTTERANCES[0].expected);
  });

  assert.deepEqual(calls, [1, 2]);
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.attempts, 2);
    assert.equal(outcome.data.amount, 500);
    assert.equal(outcome.data.type, 'udhaar_given');
  }
});

test('executeVoiceExtractionWithSingleRetry triggers manual-entry fallback after 2 invalid JSON responses', async () => {
  const calls: number[] = [];
  const outcome = await executeVoiceExtractionWithSingleRetry(async (attempt) => {
    calls.push(attempt);
    return attempt === 1 ? 'broken output' : '{"amount":"five hundred"}';
  });

  assert.deepEqual(calls, [1, 2]);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.attempts, 2);
    assert.equal(outcome.fallbackToManual, true);
  }
});

test('detectUncertainFields marks low-confidence and missing fields accurately', () => {
  const lowConf = detectUncertainFields({
    customerName: null,
    amount: 250,
    type: 'udhaar_given',
    note: 'Ration',
    confidence: LOW_CONFIDENCE_THRESHOLD - 0.1,
    transcript: 'dhai sau udhaar',
  });
  assert.ok(lowConf.includes('amount'));
  assert.ok(lowConf.includes('customerName'));
  assert.ok(lowConf.includes('type'));

  const missingAmtHighConf = detectUncertainFields({
    customerName: 'Sabzi Wala',
    amount: null,
    type: 'expense',
    note: 'Sabzi',
    confidence: 0.9,
    transcript: 'sabzi kharida',
  });
  assert.deepEqual(missingAmtHighConf, ['amount']);
});
