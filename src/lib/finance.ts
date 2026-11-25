/**
 * Deterministic financial computation engine & selectors for VyaparMitra.
 *
 * NON-NEGOTIABLE RULES:
 * 1. All financial calculations (totals, profit, EMI, outstanding, averages)
 *    live exclusively in this deterministic module — never delegated to AI.
 * 2. All monetary amounts are stored and computed in INTEGER PAISE (1 INR = 100 paise).
 * 3. Only entries with status === 'confirmed' are included in confirmed totals.
 * 4. Dates are ISO 8601 strings.
 * 5. WhatsApp links are strictly pre-filled wa.me URLs requiring explicit user tap.
 */

export type LedgerEntryType = 'sale' | 'expense' | 'udhaar' | 'jama';
export type LedgerEntryStatus = 'pending' | 'confirmed';
export type LedgerEntrySource = 'manual' | 'ai' | 'voice' | 'camera';
export type UncertainField = 'customerName' | 'amount' | 'type' | 'note';

export type AuditEditableField = 'customerName' | 'type' | 'amountPaise' | 'note';

export interface OriginalAIValueSnapshot {
  customerName: string;
  type: LedgerEntryType;
  amountPaise: number | null;
  note: string;
}

export interface LedgerEntryRecord {
  id: string;
  ownerUid: string;
  customerName: string;
  customerPhone?: string;
  type: LedgerEntryType;
  /** Integer paise (> 0), or null when an expense has a missing amount */
  amountPaise: number | null;
  note?: string;
  source: LedgerEntrySource;
  status: LedgerEntryStatus;
  occurredAtIso: string;
  /** AI/voice extraction confidence score (0..1) */
  confidence?: number;
  /** Verbatim Hindi/Hinglish spoken transcript */
  transcript?: string;
  /** Fields flagged as low-confidence or uncertain for review before confirmation */
  uncertainFields?: UncertainField[];
  /** Optional HTTPS link to compressed source register/bill photo in Firebase Storage */
  sourceImageUrl?: string;
  /** Audit trail: ISO 8601 timestamp when explicitly confirmed by shopkeeper */
  confirmedAt?: string;
  /** Audit trail: fields edited by shopkeeper prior to confirmation */
  editedFields?: AuditEditableField[];
  /** Audit trail: immutable snapshot of original AI/voice/photo values before edits */
  originalAIValue?: OriginalAIValueSnapshot;
}

export interface LedgerSummary {
  totalUdhaarPaise: number;
  totalJamaPaise: number;
  netOutstandingPaise: number;
  confirmedCount: number;
  pendingCount: number;
  averageConfirmedEntryPaise: number;
}

export interface TodayDashboardTotals {
  todayDateKey: string;
  todaySalesPaise: number;
  todayExpensesPaise: number;
  estimatedProfitPaise: number;
  confirmedSalesCount: number;
  confirmedExpensesCount: number;
  pendingCount: number;
  missingAmountExpensesCount: number;
  missingAmountExpenses: LedgerEntryRecord[];
}

export interface CustomerBalance {
  customerName: string;
  customerPhone?: string;
  udhaarPaise: number;
  jamaPaise: number;
  netDuePaise: number;
  lastActivityIso: string;
}

export interface EmiScheduleSummary {
  monthlyEmiPaise: number;
  totalPayablePaise: number;
  totalInterestPaise: number;
}

/**
 * Safely converts a rupee string or number (e.g., "250.50") into integer paise (25050).
 * Returns null if the input is invalid, negative, or zero.
 */
export function rupeesToPaise(input: string | number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return null;
    const paise = Math.round(input * 100);
    return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
  }

  const trimmed = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }

  const [wholeStr, fracStr = ''] = trimmed.split('.');
  const whole = Number.parseInt(wholeStr, 10);
  const fracPadded = (fracStr + '00').slice(0, 2);
  const frac = Number.parseInt(fracPadded, 10);
  const paise = whole * 100 + frac;

  if (!Number.isSafeInteger(paise) || paise <= 0) {
    return null;
  }
  return paise;
}

/**
 * Converts integer paise to numeric rupees (display-only helper).
 */
export function paiseToRupees(paise: number): number {
  const safePaise = Math.trunc(paise);
  return safePaise / 100;
}

/**
 * Formats integer paise in Indian numbering style (e.g., 125050 -> "₹1,250.50", 125000 -> "₹1,250").
 */
export function formatINR(paise: number, options?: { showDecimalsAlways?: boolean }): string {
  const safePaise = Math.trunc(paise);
  const isNegative = safePaise < 0;
  const absPaise = Math.abs(safePaise);
  const wholeRupees = Math.floor(absPaise / 100);
  const remPaise = absPaise % 100;

  const formattedWhole = wholeRupees.toLocaleString('en-IN');
  const shouldShowDecimals = options?.showDecimalsAlways || remPaise !== 0;
  const decimals = shouldShowDecimals ? `.${String(remPaise).padStart(2, '0')}` : '';

  return `${isNegative ? '-' : ''}₹${formattedWhole}${decimals}`;
}

/**
 * Returns local calendar date key in YYYY-MM-DD format for deterministic daily filtering.
 */
export function getLocalDateKey(input: Date | string = new Date()): string {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isEntryOnDate(entry: LedgerEntryRecord, targetDateKey: string): boolean {
  if (!targetDateKey) return false;
  return getLocalDateKey(entry.occurredAtIso) === targetDateKey;
}

export function hasValidPositiveAmount(entry: LedgerEntryRecord): boolean {
  return (
    typeof entry.amountPaise === 'number' &&
    Number.isFinite(entry.amountPaise) &&
    Math.trunc(entry.amountPaise) > 0
  );
}

/**
 * Selector: returns all confirmed entries.
 */
export function selectConfirmedEntries(
  entries: readonly LedgerEntryRecord[]
): LedgerEntryRecord[] {
  return entries.filter((entry) => entry.status === 'confirmed');
}

/**
 * Selector: returns all pending entries awaiting explicit user confirmation.
 */
export function selectPendingEntries(
  entries: readonly LedgerEntryRecord[]
): LedgerEntryRecord[] {
  return entries.filter((entry) => entry.status === 'pending');
}

/**
 * Selector: count of pending entries.
 */
export function selectPendingCount(entries: readonly LedgerEntryRecord[]): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.status === 'pending') count += 1;
  }
  return count;
}

/**
 * Selector: expense entries with a missing (null/0) amount.
 * Optionally scoped to a specific dateKey or confirmed status.
 */
export function selectExpensesMissingAmount(
  entries: readonly LedgerEntryRecord[],
  options?: { dateKey?: string; confirmedOnly?: boolean }
): LedgerEntryRecord[] {
  return entries.filter((entry) => {
    if (entry.type !== 'expense') return false;
    if (options?.confirmedOnly && entry.status !== 'confirmed') return false;
    if (options?.dateKey && !isEntryOnDate(entry, options.dateKey)) return false;
    return !hasValidPositiveAmount(entry);
  });
}

/**
 * Selector: Today's Confirmed Sales in integer paise.
 * Pending entries and entries from other dates are strictly excluded.
 */
export function selectTodaySalesPaise(
  entries: readonly LedgerEntryRecord[],
  todayDateKey: string = getLocalDateKey()
): number {
  let total = 0;
  for (const entry of entries) {
    if (
      entry.status === 'confirmed' &&
      entry.type === 'sale' &&
      isEntryOnDate(entry, todayDateKey) &&
      hasValidPositiveAmount(entry)
    ) {
      total += Math.trunc(entry.amountPaise as number);
    }
  }
  return total;
}

/**
 * Selector: Today's Confirmed Expenses in integer paise.
 * Pending entries, other dates, and expenses with missing amounts are excluded from sum.
 */
export function selectTodayExpensesPaise(
  entries: readonly LedgerEntryRecord[],
  todayDateKey: string = getLocalDateKey()
): number {
  let total = 0;
  for (const entry of entries) {
    if (
      entry.status === 'confirmed' &&
      entry.type === 'expense' &&
      isEntryOnDate(entry, todayDateKey) &&
      hasValidPositiveAmount(entry)
    ) {
      total += Math.trunc(entry.amountPaise as number);
    }
  }
  return total;
}

/**
 * Selector: Today's Estimated Profit (= Today's Confirmed Sales - Today's Confirmed Expenses).
 */
export function selectTodayEstimatedProfitPaise(
  entries: readonly LedgerEntryRecord[],
  todayDateKey: string = getLocalDateKey()
): number {
  return (
    selectTodaySalesPaise(entries, todayDateKey) -
    selectTodayExpensesPaise(entries, todayDateKey)
  );
}

/**
 * Combined deterministic Home Dashboard totals selector.
 */
export function selectTodayDashboardTotals(
  entries: readonly LedgerEntryRecord[],
  todayDateKey: string = getLocalDateKey()
): TodayDashboardTotals {
  let todaySalesPaise = 0;
  let todayExpensesPaise = 0;
  let confirmedSalesCount = 0;
  let confirmedExpensesCount = 0;
  let pendingCount = 0;
  const missingAmountExpenses: LedgerEntryRecord[] = [];

  for (const entry of entries) {
    if (entry.status === 'pending') {
      pendingCount += 1;
    }

    const isToday = isEntryOnDate(entry, todayDateKey);
    const hasAmount = hasValidPositiveAmount(entry);

    if (entry.type === 'expense' && !hasAmount) {
      missingAmountExpenses.push(entry);
    }

    if (entry.status !== 'confirmed' || !isToday) {
      continue;
    }

    if (entry.type === 'sale' && hasAmount) {
      todaySalesPaise += Math.trunc(entry.amountPaise as number);
      confirmedSalesCount += 1;
    } else if (entry.type === 'expense') {
      confirmedExpensesCount += 1;
      if (hasAmount) {
        todayExpensesPaise += Math.trunc(entry.amountPaise as number);
      }
    }
  }

  return {
    todayDateKey,
    todaySalesPaise,
    todayExpensesPaise,
    estimatedProfitPaise: todaySalesPaise - todayExpensesPaise,
    confirmedSalesCount,
    confirmedExpensesCount,
    pendingCount,
    missingAmountExpensesCount: missingAmountExpenses.length,
    missingAmountExpenses,
  };
}

/**
 * Deterministically aggregates confirmed credit/payment entries.
 * Pending entries are counted separately and excluded from financial totals.
 */
export function calculateLedgerSummary(entries: readonly LedgerEntryRecord[]): LedgerSummary {
  let totalUdhaarPaise = 0;
  let totalJamaPaise = 0;
  let confirmedCount = 0;
  let pendingCount = 0;
  let confirmedVolumePaise = 0;

  for (const entry of entries) {
    if (entry.status !== 'confirmed') {
      pendingCount += 1;
      continue;
    }

    if (!hasValidPositiveAmount(entry)) continue;
    const amount = Math.trunc(entry.amountPaise as number);

    if (entry.type === 'udhaar' || entry.type === 'jama') {
      confirmedCount += 1;
      confirmedVolumePaise += amount;
      if (entry.type === 'udhaar') {
        totalUdhaarPaise += amount;
      } else {
        totalJamaPaise += amount;
      }
    }
  }

  const netOutstandingPaise = totalUdhaarPaise - totalJamaPaise;
  const averageConfirmedEntryPaise =
    confirmedCount > 0 ? Math.round(confirmedVolumePaise / confirmedCount) : 0;

  return {
    totalUdhaarPaise,
    totalJamaPaise,
    netOutstandingPaise,
    confirmedCount,
    pendingCount,
    averageConfirmedEntryPaise,
  };
}

/**
 * Computes per-customer net outstanding balance across confirmed udhaar/jama entries.
 */
export function calculateCustomerBalances(entries: readonly LedgerEntryRecord[]): CustomerBalance[] {
  const map = new Map<string, CustomerBalance>();

  for (const entry of entries) {
    if (entry.status !== 'confirmed') continue;
    if (entry.type !== 'udhaar' && entry.type !== 'jama') continue;
    if (!hasValidPositiveAmount(entry)) continue;

    const key = entry.customerName.trim().toLowerCase();
    if (!key) continue;

    const amount = Math.trunc(entry.amountPaise as number);
    const current = map.get(key) ?? {
      customerName: entry.customerName.trim(),
      customerPhone: entry.customerPhone,
      udhaarPaise: 0,
      jamaPaise: 0,
      netDuePaise: 0,
      lastActivityIso: entry.occurredAtIso,
    };

    if (!current.customerPhone && entry.customerPhone) {
      current.customerPhone = entry.customerPhone;
    }
    if (entry.type === 'udhaar') {
      current.udhaarPaise += amount;
    } else {
      current.jamaPaise += amount;
    }
    current.netDuePaise = current.udhaarPaise - current.jamaPaise;
    if (entry.occurredAtIso > current.lastActivityIso) {
      current.lastActivityIso = entry.occurredAtIso;
    }
    map.set(key, current);
  }

  return Array.from(map.values()).sort((a, b) => b.netDuePaise - a.netDuePaise);
}

/**
 * Deterministic profit & margin calculation in integer paise.
 */
export function calculateProfitPaise(
  revenuePaise: number,
  costPaise: number
): { profitPaise: number; marginBasisPoints: number } {
  const rev = Math.trunc(revenuePaise);
  const cost = Math.trunc(costPaise);
  const profitPaise = rev - cost;
  const marginBasisPoints = rev > 0 ? Math.round((profitPaise * 10000) / rev) : 0;
  return { profitPaise, marginBasisPoints };
}

/**
 * Deterministic reducing-balance EMI calculation in integer paise.
 */
export function calculateMonthlyEmiPaise(
  principalPaise: number,
  annualRatePercent: number,
  tenureMonths: number
): EmiScheduleSummary {
  const P = Math.max(0, Math.trunc(principalPaise));
  const n = Math.max(1, Math.trunc(tenureMonths));
  if (P === 0) {
    return { monthlyEmiPaise: 0, totalPayablePaise: 0, totalInterestPaise: 0 };
  }
  if (annualRatePercent <= 0) {
    const monthlyEmiPaise = Math.round(P / n);
    return {
      monthlyEmiPaise,
      totalPayablePaise: monthlyEmiPaise * n,
      totalInterestPaise: Math.max(0, monthlyEmiPaise * n - P),
    };
  }

  const r = annualRatePercent / 12 / 100;
  const factor = Math.pow(1 + r, n);
  const monthlyEmiPaise = Math.round((P * r * factor) / (factor - 1));
  const totalPayablePaise = monthlyEmiPaise * n;
  const totalInterestPaise = Math.max(0, totalPayablePaise - P);

  return { monthlyEmiPaise, totalPayablePaise, totalInterestPaise };
}

/**
 * Builds a pre-filled WhatsApp wa.me link. Never sends messages automatically.
 */
export function buildWhatsAppReminderUrl(phone: string | undefined, message: string): string {
  const encodedText = encodeURIComponent(message);
  if (!phone) {
    return `https://wa.me/?text=${encodedText}`;
  }
  const digits = phone.replace(/\D/g, '');
  let normalized = digits;
  if (digits.length === 10) {
    normalized = `91${digits}`;
  }
  return `https://wa.me/${normalized}?text=${encodedText}`;
}
