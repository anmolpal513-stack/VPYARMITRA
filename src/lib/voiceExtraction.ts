import { z } from 'zod';
import {
  rupeesToPaise,
  type LedgerEntryRecord,
  type LedgerEntryType,
  type UncertainField,
} from './finance';
import type { AppLanguage } from './i18n';

export const MAX_VOICE_RECORDING_SECONDS = 30;
export const LOW_CONFIDENCE_THRESHOLD = 0.75;

export const VOICE_ENTRY_TYPES = [
  'sale',
  'expense',
  'udhaar_given',
  'udhaar_received',
] as const;

export type VoiceEntryType = (typeof VOICE_ENTRY_TYPES)[number];

/**
 * Strict Zod schema validating Gemini's structured JSON voice extraction output.
 */
export const VoiceExtractionSchema = z.object({
  customerName: z.string().trim().max(60).nullable(),
  amount: z.number().finite().positive().max(100_000_000).nullable(),
  type: z.enum(VOICE_ENTRY_TYPES),
  note: z.string().trim().max(140),
  confidence: z.number().finite().min(0).max(1),
  transcript: z.string().trim().min(1).max(500),
});

export type VoiceExtractionResult = z.infer<typeof VoiceExtractionSchema>;

/**
 * Gemini extraction prompt for Hindi/Hinglish Kirana voice ledger entries.
 * Handles Indian spoken number words (e.g., "paanch sau", "dhai hazaar", "dedh sau",
 * "sawa sau", "paune do sau") and enforces strict JSON structure.
 */
export const VOICE_EXTRACTION_PROMPT = `You are a precision Hindi & Hinglish ledger extraction assistant for VyaparMitra, an Indian Kirana shopkeeper app.

Given a voice transcript from a small shopkeeper, extract ONE structured ledger entry as strict JSON matching this exact schema:
{
  "customerName": string | null,
  "amount": number | null,
  "type": "sale" | "expense" | "udhaar_given" | "udhaar_received",
  "note": string,
  "confidence": number,
  "transcript": string
}

STRICT RULES:
1. OUTPUT JSON ONLY. No markdown fences, no commentary, no extra keys.
2. NEVER guess or invent an amount. If no amount is spoken, set "amount": null.
3. Convert ALL Hindi, Hinglish, and Devanagari spoken number words into exact numeric INR rupees (never paise):
   - "ek sau" / "एक सौ" = 100
   - "paune sau" / "पौने सौ" = 75
   - "sawa sau" / "सवा सौ" = 125
   - "dedh sau" / "डेढ़ सौ" = 150
   - "paune do sau" / "पौने दो सौ" = 175
   - "sawa do sau" / "सवा दो सौ" = 225
   - "dhai sau" / "adhai sau" / "ढाई सौ" = 250
   - "saade teen sau" / "साढ़े तीन सौ" = 350
   - "paanch sau" / "पाँच सौ" = 500
   - "saade paanch sau" / "साढ़े पाँच सौ" = 550
   - "aath sau pachaas" / "आठ सौ पचास" = 850
   - "ek hazaar" / "एक हज़ार" = 1000
   - "gyaarah sau" / "ग्यारह सौ" = 1100
   - "baara sau" / "बारह सौ" = 1200
   - "sawa hazaar" / "सवा हज़ार" = 1250
   - "dedh hazaar" / "pandraah sau" / "डेढ़ हज़ार" = 1500
   - "dhai hazaar" / "pachhis sau" / "ढाई हज़ार" = 2500
   - "paune teen hazaar" / "पौने तीन हज़ार" = 2750
   - "saade teen hazaar" / "साढ़े तीन हज़ार" = 3500
   - Also convert Devanagari numerals (e.g., "५००" -> 500, "२५००" -> 2500) and decimals (e.g., "pachas rupaye pachaas paise" -> 50.5).
4. Classify "type" accurately:
   - "sale": cash/UPI/daily sales ("bikri", "becha", "sale", "galla", "cash mila").
   - "expense": shop costs, bills, stock purchase ("kharcha", "kharch", "bill", "bijli", "kiraya", "doodh wala", "sabzi", "supplier ko diya").
   - "udhaar_given": credit given to a customer ("udhaar diya", "khate mein likho", "baaki likho", "udhaar").
   - "udhaar_received": past credit payment received ("jama kiya", "udhaar wapas mila", "baaki chuka diya", "purana hisaab diya", "wapas de diye").
5. "customerName": customer, supplier, or expense payee name (e.g., "Ramesh", "Meena ji", "Bijli Bill", "Doodh Wala"). Set null if none was mentioned (common for general cash sales).
6. "note": concise item/reason summary (max 140 chars). Empty string "" if no extra detail.
7. "transcript": exact cleaned transcript spoken by the shopkeeper.
8. "confidence": honest 0.0 to 1.0 score:
   - 0.85 to 1.0: clear speech, explicit amount, unambiguous type.
   - 0.60 to 0.74: missing amount, missing customer name on credit, or minor ambiguity.
   - Below 0.60: unclear/garbled speech or uncertain intent.`;

export function stripJsonCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export type VoiceParseResult =
  | { ok: true; data: VoiceExtractionResult }
  | { ok: false; error: string };

/**
 * Parses raw LLM text as JSON and validates strictly against VoiceExtractionSchema.
 */
export function parseAndValidateVoiceExtraction(rawText: string): VoiceParseResult {
  const cleaned = stripJsonCodeFences(rawText);
  if (!cleaned) {
    return { ok: false, error: 'Empty model response' };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result = VoiceExtractionSchema.safeParse(parsedJson);
  if (!result.success) {
    const issueSummary = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    return { ok: false, error: `Schema validation failed: ${issueSummary}` };
  }

  return { ok: true, data: result.data };
}

export type RetryExtractionOutcome =
  | {
      ok: true;
      data: VoiceExtractionResult;
      attempts: 1 | 2;
      uncertainFields: UncertainField[];
    }
  | {
      ok: false;
      attempts: 2;
      fallbackToManual: true;
      error: string;
    };

/**
 * Runs structured voice JSON extraction with exactly ONE automatic retry on invalid JSON
 * or Zod validation failure. After the second failure, signals manual-entry fallback.
 */
export async function executeVoiceExtractionWithSingleRetry(
  runAttempt: (attempt: 1 | 2, previousError?: string) => Promise<string>
): Promise<RetryExtractionOutcome> {
  let firstError = 'Unknown extraction error';

  try {
    const rawFirst = await runAttempt(1);
    const firstCheck = parseAndValidateVoiceExtraction(rawFirst);
    if (firstCheck.ok) {
      return {
        ok: true,
        data: firstCheck.data,
        attempts: 1,
        uncertainFields: detectUncertainFields(firstCheck.data),
      };
    }
    firstError = firstCheck.error;
  } catch (err) {
    firstError = err instanceof Error ? err.message : String(err);
  }

  // Retry ONCE with repair feedback
  try {
    const rawSecond = await runAttempt(2, firstError);
    const secondCheck = parseAndValidateVoiceExtraction(rawSecond);
    if (secondCheck.ok) {
      return {
        ok: true,
        data: secondCheck.data,
        attempts: 2,
        uncertainFields: detectUncertainFields(secondCheck.data),
      };
    }
    return {
      ok: false,
      attempts: 2,
      fallbackToManual: true,
      error: secondCheck.error,
    };
  } catch (err) {
    return {
      ok: false,
      attempts: 2,
      fallbackToManual: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Identifies fields that should be visually flagged as uncertain in the Confirmation Module.
 * Never auto-confirms; low-confidence (< 0.75) or missing critical fields are marked clearly.
 */
export function detectUncertainFields(
  extracted: VoiceExtractionResult
): UncertainField[] {
  const uncertain = new Set<UncertainField>();
  const isLowConfidence = extracted.confidence < LOW_CONFIDENCE_THRESHOLD;

  if (extracted.amount === null || isLowConfidence) {
    uncertain.add('amount');
  }

  const trimmedName = (extracted.customerName ?? '').trim();
  const needsNamedParty =
    extracted.type === 'udhaar_given' || extracted.type === 'udhaar_received';
  if (
    (needsNamedParty && trimmedName.length < 2) ||
    (isLowConfidence && trimmedName.length === 0)
  ) {
    uncertain.add('customerName');
  }

  if (isLowConfidence) {
    uncertain.add('type');
  }

  if (extracted.confidence < 0.6) {
    uncertain.add('note');
  }

  return Array.from(uncertain);
}

/**
 * Deterministic mapping from Voice schema transaction type to LedgerEntryType.
 */
export function mapVoiceTypeToLedgerType(type: VoiceEntryType): LedgerEntryType {
  switch (type) {
    case 'sale':
      return 'sale';
    case 'expense':
      return 'expense';
    case 'udhaar_given':
      return 'udhaar';
    case 'udhaar_received':
      return 'jama';
  }
}

function getDefaultCustomerName(type: VoiceEntryType, language: AppLanguage): string {
  if (language === 'hi') {
    if (type === 'sale') return 'नकद बिक्री';
    if (type === 'expense') return 'दुकान खर्च';
    return 'अज्ञात ग्राहक';
  }
  if (type === 'sale') return 'Cash Sale';
  if (type === 'expense') return 'Shop Expense';
  return 'Unknown Customer';
}

/**
 * Deterministically converts a Zod-validated voice extraction into a PENDING LedgerEntryRecord.
 *
 * NON-NEGOTIABLE RULES ENFORCED:
 * - Rule 1 & 4: Rupee-to-paise integer conversion via deterministic `rupeesToPaise`.
 * - Rule 2: Status is ALWAYS hardcoded to `'pending'`, never auto-confirmed.
 */
export function mapVoiceExtractionToPendingEntry(
  extracted: VoiceExtractionResult,
  ownerUid: string,
  language: AppLanguage,
  occurredAtIso: string = new Date().toISOString()
): LedgerEntryRecord {
  const ledgerType = mapVoiceTypeToLedgerType(extracted.type);
  const amountPaise =
    extracted.amount === null ? null : rupeesToPaise(extracted.amount);
  const uncertainFields = detectUncertainFields(extracted);

  const trimmedName = (extracted.customerName ?? '').trim();
  const customerName =
    trimmedName.length > 0
      ? trimmedName.slice(0, 60)
      : getDefaultCustomerName(extracted.type, language);

  if (
    amountPaise === null &&
    !uncertainFields.includes('amount')
  ) {
    uncertainFields.push('amount');
  }

  return {
    id: `entry_voice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ownerUid,
    customerName,
    type: ledgerType,
    amountPaise,
    note: extracted.note.trim().slice(0, 140),
    source: 'voice',
    status: 'pending',
    occurredAtIso,
    confidence: Number(extracted.confidence.toFixed(2)),
    transcript: extracted.transcript.trim().slice(0, 500),
    uncertainFields,
  };
}

export interface VoiceTestUtterance {
  id: number;
  utterance: string;
  description: string;
  expected: VoiceExtractionResult;
  expectedLedgerType: LedgerEntryType;
  expectedAmountPaise: number | null;
  expectedUncertain: boolean;
}

/**
 * 10 realistic Hindi/Hinglish Kirana voice test utterances with expected structured JSON.
 */
export const VOICE_TEST_UTTERANCES: readonly VoiceTestUtterance[] = [
  {
    id: 1,
    utterance: 'Ramesh ko paanch sau rupaye ka aata aur chini udhaar diya',
    description: 'Hindi number word "paanch sau" (500) with udhaar_given',
    expected: {
      customerName: 'Ramesh',
      amount: 500,
      type: 'udhaar_given',
      note: 'Aata aur chini',
      confidence: 0.94,
      transcript: 'Ramesh ko paanch sau rupaye ka aata aur chini udhaar diya',
    },
    expectedLedgerType: 'udhaar',
    expectedAmountPaise: 50000,
    expectedUncertain: false,
  },
  {
    id: 2,
    utterance: 'Aaj sham ki bikri dhai hazaar rupaye hui',
    description: 'Hindi number word "dhai hazaar" (2500) for daily sale',
    expected: {
      customerName: null,
      amount: 2500,
      type: 'sale',
      note: 'Sham ki bikri',
      confidence: 0.95,
      transcript: 'Aaj sham ki bikri dhai hazaar rupaye hui',
    },
    expectedLedgerType: 'sale',
    expectedAmountPaise: 250000,
    expectedUncertain: false,
  },
  {
    id: 3,
    utterance: 'Suresh Gupta ne purana udhaar dedh hazaar rupaye jama kar diya',
    description: 'Hindi number word "dedh hazaar" (1500) for udhaar_received',
    expected: {
      customerName: 'Suresh Gupta',
      amount: 1500,
      type: 'udhaar_received',
      note: 'Purana udhaar jama',
      confidence: 0.93,
      transcript: 'Suresh Gupta ne purana udhaar dedh hazaar rupaye jama kar diya',
    },
    expectedLedgerType: 'jama',
    expectedAmountPaise: 150000,
    expectedUncertain: false,
  },
  {
    id: 4,
    utterance: 'Doodh wale ko sawa sau rupaye kharcha diya',
    description: 'Hindi fraction word "sawa sau" (125) for shop expense',
    expected: {
      customerName: 'Doodh Wala',
      amount: 125,
      type: 'expense',
      note: 'Doodh kharcha',
      confidence: 0.91,
      transcript: 'Doodh wale ko sawa sau rupaye kharcha diya',
    },
    expectedLedgerType: 'expense',
    expectedAmountPaise: 12500,
    expectedUncertain: false,
  },
  {
    id: 5,
    utterance: 'Meena ji ke khate mein paune do sau rupaye tel ka udhaar likho',
    description: 'Hindi fraction word "paune do sau" (175) for udhaar_given',
    expected: {
      customerName: 'Meena ji',
      amount: 175,
      type: 'udhaar_given',
      note: 'Tel',
      confidence: 0.92,
      transcript: 'Meena ji ke khate mein paune do sau rupaye tel ka udhaar likho',
    },
    expectedLedgerType: 'udhaar',
    expectedAmountPaise: 17500,
    expectedUncertain: false,
  },
  {
    id: 6,
    utterance: 'Bijli ka bill aath sau pachaas rupaye bhara',
    description: 'Compound Hindi number "aath sau pachaas" (850) for utility expense',
    expected: {
      customerName: 'Bijli Bill',
      amount: 850,
      type: 'expense',
      note: 'Electricity bill',
      confidence: 0.94,
      transcript: 'Bijli ka bill aath sau pachaas rupaye bhara',
    },
    expectedLedgerType: 'expense',
    expectedAmountPaise: 85000,
    expectedUncertain: false,
  },
  {
    id: 7,
    utterance: 'Subah ki cash sale saade teen sau rupaye',
    description: 'Hindi fraction word "saade teen sau" (350) for cash sale',
    expected: {
      customerName: null,
      amount: 350,
      type: 'sale',
      note: 'Subah ki cash sale',
      confidence: 0.92,
      transcript: 'Subah ki cash sale saade teen sau rupaye',
    },
    expectedLedgerType: 'sale',
    expectedAmountPaise: 35000,
    expectedUncertain: false,
  },
  {
    id: 8,
    utterance: 'Anil ne gyaarah sau rupaye wapas de diye',
    description: 'Hindi number word "gyaarah sau" (1100) for udhaar_received',
    expected: {
      customerName: 'Anil',
      amount: 1100,
      type: 'udhaar_received',
      note: 'Udhaar wapas',
      confidence: 0.9,
      transcript: 'Anil ne gyaarah sau rupaye wapas de diye',
    },
    expectedLedgerType: 'jama',
    expectedAmountPaise: 110000,
    expectedUncertain: false,
  },
  {
    id: 9,
    utterance: 'Aaj sabzi aur dhaniya kharida par bill abhi aaya nahi',
    description: 'Expense with unspoken/missing amount flagged as uncertain',
    expected: {
      customerName: 'Sabzi',
      amount: null,
      type: 'expense',
      note: 'Sabzi aur dhaniya, bill pending',
      confidence: 0.68,
      transcript: 'Aaj sabzi aur dhaniya kharida par bill abhi aaya nahi',
    },
    expectedLedgerType: 'expense',
    expectedAmountPaise: null,
    expectedUncertain: true,
  },
  {
    id: 10,
    utterance: 'Kisi ne dedh sau diye the shaayad chawal ke liye',
    description: 'Low-confidence ambiguous utterance flagged for review',
    expected: {
      customerName: null,
      amount: 150,
      type: 'sale',
      note: 'Chawal (uncertain customer/type)',
      confidence: 0.54,
      transcript: 'Kisi ne dedh sau diye the shaayad chawal ke liye',
    },
    expectedLedgerType: 'sale',
    expectedAmountPaise: 15000,
    expectedUncertain: true,
  },
];
