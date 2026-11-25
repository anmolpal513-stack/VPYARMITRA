import { z } from 'zod';
import {
  rupeesToPaise,
  type LedgerEntryRecord,
  type LedgerEntryType,
  type UncertainField,
} from './finance';
import type { AppLanguage } from './i18n';

export const PHOTO_LOW_CONFIDENCE_THRESHOLD = 0.75;

export const PHOTO_ROW_TYPES = [
  'sale',
  'expense',
  'udhaar_given',
  'udhaar_received',
] as const;

export type PhotoRowType = (typeof PHOTO_ROW_TYPES)[number];

export const PHOTO_UNCERTAIN_FIELDS = [
  'date',
  'customerName',
  'item',
  'amount',
  'type',
] as const;

export type PhotoUncertainField = (typeof PHOTO_UNCERTAIN_FIELDS)[number];

export const PHOTO_IMAGE_QUALITIES = [
  'good',
  'fair',
  'blurry',
  'unreadable',
] as const;

export type PhotoImageQuality = (typeof PHOTO_IMAGE_QUALITIES)[number];

/**
 * Strict Zod schema for a single row extracted from a register/ledger/bill photo.
 */
export const PhotoLedgerRowSchema = z.object({
  date: z.string().trim().max(32).nullable(),
  customerName: z.string().trim().max(60).nullable(),
  item: z.string().trim().max(140).nullable(),
  amount: z.number().finite().positive().max(100_000_000).nullable(),
  type: z.enum(PHOTO_ROW_TYPES).nullable(),
  confidence: z.number().finite().min(0).max(1),
  uncertainFields: z.array(z.enum(PHOTO_UNCERTAIN_FIELDS)).max(5),
});

export type PhotoLedgerRow = z.infer<typeof PhotoLedgerRowSchema>;

/**
 * Strict Zod schema validating Gemini Vision's full Photo-to-Ledger JSON output.
 */
export const PhotoExtractionSchema = z.object({
  rows: z.array(PhotoLedgerRowSchema).max(50),
  imageQuality: z.enum(PHOTO_IMAGE_QUALITIES),
});

export type PhotoExtractionResult = z.infer<typeof PhotoExtractionSchema>;

/**
 * Gemini Vision extraction prompt for Indian Kirana registers, bahi-khata notebooks,
 * and wholesale/retail paper bills.
 */
export const PHOTO_EXTRACTION_PROMPT = `You are a precision OCR and ledger-table extraction assistant for VyaparMitra, an Indian Kirana shopkeeper app.

Inspect the uploaded photo of a handwritten Kirana register (bahi-khata), notebook page, or printed/handwritten bill and extract every valid transaction row into strict JSON matching this exact schema:
{
  "rows": [
    {
      "date": string | null,
      "customerName": string | null,
      "item": string | null,
      "amount": number | null,
      "type": "sale" | "expense" | "udhaar_given" | "udhaar_received" | null,
      "confidence": number,
      "uncertainFields": Array<"date" | "customerName" | "item" | "amount" | "type">
    }
  ],
  "imageQuality": "good" | "fair" | "blurry" | "unreadable"
}

NON-NEGOTIABLE EXTRACTION RULES:
1. OUTPUT JSON ONLY. No markdown fences, no commentary, no extra keys.
2. NEVER GUESS ILLEGIBLE VALUES. If any handwritten word, digit, date, name, or amount is smudged, torn, obscured by ink/stain, cut off, or ambiguous, you MUST return null for that field AND add that field's exact name ("date", "customerName", "item", "amount", or "type") to "uncertainFields".
3. IMAGE QUALITY GATE:
   - "good": Sharp, well-lit, legible register or bill.
   - "fair": Mostly legible with minor smudges, creases, shadows, or a few uncertain cells.
   - "blurry": Out-of-focus or motion-blurred so numbers/names cannot be read reliably. Return "rows": [].
   - "unreadable": Too dark, glare-washed, crumpled, blank, or not a ledger/bill photo. Return "rows": [].
4. INDIAN KIRANA REGISTER CONVENTIONS:
   - Convert Devanagari digits (० १ २ ३ ४ ५ ६ ७ ८ ९) and Indian rupee notation (e.g., "२५०/-", "Rs. 1,250.50", "500=00") into clean numeric INR rupees (positive number, NEVER paise).
   - Format dates as "YYYY-MM-DD" when year is visible, or preserve clear short dates like "24/11" only if unambiguous; if missing or unreadable, return null and add "date" to uncertainFields.
   - Resolve clear ditto marks (" or ,,) from the immediately preceding line only when unmistakably aligned; otherwise mark uncertain.
   - IGNORE fully crossed-out / struck-through entries.
   - Classify "type" carefully:
     * "sale": cash/UPI sales ("बिक्री", "नकद", "cash", "bikri", "sale").
     * "expense": shop purchase/utility/supplier bill ("खर्च", "बिल", "bijli", "kiraya", "supplier", "kharcha").
     * "udhaar_given": credit given ("उधार", "उ.", "बाकी", "dr", "udhaar", "credit").
     * "udhaar_received": credit payment received ("जमा", "ज.", "मिला", "cr", "jama", "wapas").
     * If the register does not clearly indicate transaction type, set "type": null and include "type" in "uncertainFields".
5. CONFIDENCE & UNCERTAINTY:
   - Give each row an honest 0.0–1.0 confidence score.
   - Whenever confidence < 0.75 or any field is partially faded/unclear, include all uncertain field names in "uncertainFields".`;

export function stripJsonCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Enforces the "never guess" invariant programmatically:
 * any null/empty field or low-confidence row automatically registers its field(s)
 * in `uncertainFields` so the editable table ALWAYS highlights them in yellow.
 */
export function enforcePhotoRowUncertainty(row: PhotoLedgerRow): PhotoLedgerRow {
  const uncertain = new Set<PhotoUncertainField>(row.uncertainFields);

  if (!row.date || row.date.trim().length === 0) {
    uncertain.add('date');
  }
  if (!row.customerName || row.customerName.trim().length === 0) {
    uncertain.add('customerName');
  }
  if (!row.item || row.item.trim().length === 0) {
    uncertain.add('item');
  }
  if (row.amount === null) {
    uncertain.add('amount');
  }
  if (row.type === null) {
    uncertain.add('type');
  }
  if (row.confidence < PHOTO_LOW_CONFIDENCE_THRESHOLD && uncertain.size === 0) {
    uncertain.add('amount');
    uncertain.add('customerName');
  }

  return {
    ...row,
    date: row.date && row.date.trim().length > 0 ? row.date.trim() : null,
    customerName:
      row.customerName && row.customerName.trim().length > 0
        ? row.customerName.trim()
        : null,
    item: row.item && row.item.trim().length > 0 ? row.item.trim() : null,
    uncertainFields: Array.from(uncertain),
  };
}

export type PhotoParseResult =
  | { ok: true; data: PhotoExtractionResult }
  | { ok: false; error: string };

/**
 * Parses raw Gemini Vision JSON text, validates strictly with Zod,
 * and guarantees null/low-confidence cells are present in `uncertainFields`.
 */
export function parseAndValidatePhotoExtraction(rawText: string): PhotoParseResult {
  const cleaned = stripJsonCodeFences(rawText);
  if (!cleaned) {
    return { ok: false, error: 'Empty vision response' };
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

  const validated = PhotoExtractionSchema.safeParse(parsedJson);
  if (!validated.success) {
    const issueSummary = validated.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    return { ok: false, error: `Schema validation failed: ${issueSummary}` };
  }

  return {
    ok: true,
    data: {
      imageQuality: validated.data.imageQuality,
      rows: validated.data.rows.map(enforcePhotoRowUncertainty),
    },
  };
}

/**
 * Returns true when the photo is blurry or unreadable and the shopkeeper
 * must be prompted to retake the picture.
 */
export function isPhotoRetakeRequired(result: PhotoExtractionResult): boolean {
  if (result.imageQuality === 'blurry' || result.imageQuality === 'unreadable') {
    return true;
  }
  return false;
}

export type PhotoRetryOutcome =
  | {
      ok: true;
      data: PhotoExtractionResult;
      attempts: 1 | 2;
      retakeRequired: boolean;
    }
  | {
      ok: false;
      attempts: 2;
      error: string;
    };

/**
 * Validates Gemini Vision extraction output with ONE automatic retry on malformed JSON/schema.
 */
export async function executePhotoExtractionWithSingleRetry(
  runAttempt: (attempt: 1 | 2, previousError?: string) => Promise<string>
): Promise<PhotoRetryOutcome> {
  let firstError = 'Unknown photo extraction error';

  try {
    const rawFirst = await runAttempt(1);
    const firstCheck = parseAndValidatePhotoExtraction(rawFirst);
    if (firstCheck.ok) {
      return {
        ok: true,
        data: firstCheck.data,
        attempts: 1,
        retakeRequired: isPhotoRetakeRequired(firstCheck.data),
      };
    }
    firstError = firstCheck.error;
  } catch (err) {
    firstError = err instanceof Error ? err.message : String(err);
  }

  try {
    const rawSecond = await runAttempt(2, firstError);
    const secondCheck = parseAndValidatePhotoExtraction(rawSecond);
    if (secondCheck.ok) {
      return {
        ok: true,
        data: secondCheck.data,
        attempts: 2,
        retakeRequired: isPhotoRetakeRequired(secondCheck.data),
      };
    }
    return {
      ok: false,
      attempts: 2,
      error: secondCheck.error,
    };
  } catch (err) {
    return {
      ok: false,
      attempts: 2,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Validates that a source image URL is a safe HTTPS URL (blocks javascript:, data:, etc.)
 * before persisting to Firestore or rendering as an external link.
 */
export function isSafeSourceImageUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.length === 0 || trimmed.length > 1024) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function mapPhotoRowTypeToLedgerType(
  rowType: PhotoRowType | null
): LedgerEntryType {
  switch (rowType) {
    case 'sale':
      return 'sale';
    case 'expense':
      return 'expense';
    case 'udhaar_received':
      return 'jama';
    case 'udhaar_given':
    default:
      return 'udhaar';
  }
}

/**
 * Converts a YYYY-MM-DD or valid date string to an ISO 8601 timestamp string.
 * Falls back cleanly to fallbackIso when null or unparseable.
 */
export function resolveRowDateToIso(
  dateStr: string | null | undefined,
  fallbackIso: string = new Date().toISOString()
): string {
  if (!dateStr || !dateStr.trim()) return fallbackIso;
  const trimmed = dateStr.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T12:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() >= 2000 && parsed.getFullYear() <= 2100) {
    return parsed.toISOString();
  }

  return fallbackIso;
}

function defaultCustomerForPhotoRow(
  ledgerType: LedgerEntryType,
  language: AppLanguage
): string {
  if (language === 'hi') {
    if (ledgerType === 'sale') return 'नकद बिक्री (बिल फोटो)';
    if (ledgerType === 'expense') return 'दुकान खर्च (बिल फोटो)';
    return 'अज्ञात ग्राहक (रजिस्टर)';
  }
  if (ledgerType === 'sale') return 'Cash Sale (Photo)';
  if (ledgerType === 'expense') return 'Shop Expense (Photo)';
  return 'Unknown Customer (Register)';
}

/**
 * Deterministically maps an edited/extracted PhotoLedgerRow to a PENDING LedgerEntryRecord.
 *
 * NON-NEGOTIABLE RULES ENFORCED:
 * - Rule 1 & 4: Rupee amount converted to integer paise via `rupeesToPaise`.
 * - Rule 2: Status is ALWAYS hardcoded to `'pending'` and `source` to `'camera'`.
 */
export function mapPhotoRowToPendingEntry(
  row: PhotoLedgerRow,
  ownerUid: string,
  language: AppLanguage,
  options?: {
    sourceImageUrl?: string;
    fallbackOccurredAtIso?: string;
    rowIndex?: number;
  }
): LedgerEntryRecord {
  const audited = enforcePhotoRowUncertainty(row);
  const ledgerType = mapPhotoRowTypeToLedgerType(audited.type);
  const amountPaise =
    audited.amount === null ? null : rupeesToPaise(audited.amount);

  const customerName =
    audited.customerName && audited.customerName.length > 0
      ? audited.customerName.slice(0, 60)
      : defaultCustomerForPhotoRow(ledgerType, language);

  const mappedUncertain = new Set<UncertainField>();
  for (const field of audited.uncertainFields) {
    if (field === 'customerName') mappedUncertain.add('customerName');
    if (field === 'amount') mappedUncertain.add('amount');
    if (field === 'type') mappedUncertain.add('type');
    if (field === 'item' || field === 'date') mappedUncertain.add('note');
  }
  if (amountPaise === null) {
    mappedUncertain.add('amount');
  }

  const safeImageUrl = isSafeSourceImageUrl(options?.sourceImageUrl)
    ? options?.sourceImageUrl?.trim()
    : undefined;

  const idxSuffix = options?.rowIndex !== undefined ? `_r${options.rowIndex}` : '';

  return {
    id: `entry_photo_${Date.now()}${idxSuffix}_${Math.random().toString(36).slice(2, 6)}`,
    ownerUid,
    customerName,
    type: ledgerType,
    amountPaise,
    note: (audited.item ?? '').trim().slice(0, 140),
    source: 'camera',
    status: 'pending',
    occurredAtIso: resolveRowDateToIso(audited.date, options?.fallbackOccurredAtIso),
    confidence: Number(audited.confidence.toFixed(2)),
    uncertainFields: Array.from(mappedUncertain).slice(0, 4),
    sourceImageUrl: safeImageUrl,
  };
}

export interface MessyRegisterTestCase {
  id: number;
  title: string;
  scenario: string;
  expected: PhotoExtractionResult;
  expectRetake: boolean;
  expectedPendingRowCount: number;
}

/**
 * 5 messy-register test cases covering handwritten Hindi/Hinglish Kirana notebooks,
 * smudged/torn cells (null + uncertainFields), crossed-out lines, blurry photos,
 * and glare-washed unreadable receipts.
 */
export const PHOTO_MESSY_REGISTER_TEST_CASES: readonly MessyRegisterTestCase[] = [
  {
    id: 1,
    title: 'Mixed Hindi/Hinglish Bahi-Khata with Devanagari Digits & Ditto Marks',
    scenario:
      'Ruled notebook page dated 24/11/2026 with handwritten Devanagari amounts (५००/-, २५०/-, ३००/-) and ditto marks for the date column.',
    expected: {
      imageQuality: 'good',
      rows: [
        {
          date: '2026-11-24',
          customerName: 'Ramesh Sharma',
          item: 'Aata 5kg, Chini 2kg',
          amount: 500,
          type: 'udhaar_given',
          confidence: 0.94,
          uncertainFields: [],
        },
        {
          date: '2026-11-24',
          customerName: 'Sunita Devi',
          item: 'Sarso Tel 1L',
          amount: 250,
          type: 'udhaar_given',
          confidence: 0.91,
          uncertainFields: [],
        },
        {
          date: '2026-11-24',
          customerName: 'Ramu',
          item: 'Purana hisaab jama',
          amount: 300,
          type: 'udhaar_received',
          confidence: 0.93,
          uncertainFields: [],
        },
      ],
    },
    expectRetake: false,
    expectedPendingRowCount: 3,
  },
  {
    id: 2,
    title: 'Tea-Stained Page with Smudged Amount & Torn Customer Name',
    scenario:
      'Kirana register with a tea stain obscuring row 1 amount and a torn left corner cutting off row 2 customer name. Never guesses illegible values.',
    expected: {
      imageQuality: 'fair',
      rows: [
        {
          date: '2026-11-23',
          customerName: 'Mohan Dairy',
          item: 'Doodh crate 2x',
          amount: null,
          type: 'expense',
          confidence: 0.58,
          uncertainFields: ['amount'],
        },
        {
          date: '2026-11-23',
          customerName: null,
          item: 'Chawal 10kg',
          amount: 680,
          type: 'udhaar_given',
          confidence: 0.61,
          uncertainFields: ['customerName'],
        },
        {
          date: '2026-11-23',
          customerName: 'Galla Bikri',
          item: 'Sham ki cash sale',
          amount: 1420,
          type: 'sale',
          confidence: 0.89,
          uncertainFields: [],
        },
      ],
    },
    expectRetake: false,
    expectedPendingRowCount: 3,
  },
  {
    id: 3,
    title: 'Crossed-Out Entry & Faint Pencil Wholesale Bill',
    scenario:
      'Wholesale supplier kachcha parchi where one line is scribbled out (must be ignored) and another line is written in faint pencil with unclear type/item.',
    expected: {
      imageQuality: 'fair',
      rows: [
        {
          date: null,
          customerName: 'Gupta Thok Bhandar',
          item: 'Toor dal 20kg',
          amount: 2650,
          type: 'expense',
          confidence: 0.86,
          uncertainFields: ['date'],
        },
        {
          date: null,
          customerName: 'Vikram',
          item: null,
          amount: 175,
          type: null,
          confidence: 0.52,
          uncertainFields: ['date', 'item', 'type'],
        },
      ],
    },
    expectRetake: false,
    expectedPendingRowCount: 2,
  },
  {
    id: 4,
    title: 'Motion-Blurred Low-Light Phone Camera Photo',
    scenario:
      'Shopkeeper snapped the register in dim evening light while moving hand; digits and names are smeared beyond reliable reading.',
    expected: {
      imageQuality: 'blurry',
      rows: [],
    },
    expectRetake: true,
    expectedPendingRowCount: 0,
  },
  {
    id: 5,
    title: 'Glare-Washed Crumpled Thermal Receipt (Unreadable)',
    scenario:
      'Faded thermal paper receipt photographed under direct tubelight glare with crumpled folds; completely unreadable.',
    expected: {
      imageQuality: 'unreadable',
      rows: [],
    },
    expectRetake: true,
    expectedPendingRowCount: 0,
  },
];
