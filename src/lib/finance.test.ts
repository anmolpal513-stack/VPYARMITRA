import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rupeesToPaise,
  paiseToRupees,
  formatINR,
  getLocalDateKey,
  selectConfirmedEntries,
  selectPendingEntries,
  selectPendingCount,
  selectExpensesMissingAmount,
  selectTodaySalesPaise,
  selectTodayExpensesPaise,
  selectTodayEstimatedProfitPaise,
  selectTodayDashboardTotals,
  calculateLedgerSummary,
  calculateCustomerBalances,
  calculateProfitPaise,
  calculateMonthlyEmiPaise,
  buildWhatsAppReminderUrl,
  type LedgerEntryRecord,
} from './finance';

test('rupeesToPaise parses valid strings and numbers accurately without floating drift', () => {
  assert.equal(rupeesToPaise('19.99'), 1999);
  assert.equal(rupeesToPaise('250.5'), 25050);
  assert.equal(rupeesToPaise('1,250'), 125000);
  assert.equal(rupeesToPaise(0.1 + 0.2), 30);
  assert.equal(rupeesToPaise('0'), null);
  assert.equal(rupeesToPaise('-50'), null);
  assert.equal(rupeesToPaise('abc'), null);
  assert.equal(rupeesToPaise('12.345'), null);
});

test('paiseToRupees and formatINR format Indian currency cleanly', () => {
  assert.equal(paiseToRupees(125050), 1250.5);
  assert.equal(formatINR(125000), '₹1,250');
  assert.equal(formatINR(125050), '₹1,250.50');
  assert.equal(formatINR(12500000), '₹1,25,000');
  assert.equal(formatINR(-4505), '-₹45.05');
});

test('Home Dashboard totals selectors sum only confirmed today sales & expenses and compute profit', () => {
  const today = '2026-11-24';
  const entries: LedgerEntryRecord[] = [
    // Today confirmed sales: ₹2,450.50 + ₹800 = ₹3,250.50 (325050 paise)
    {
      id: 's1',
      ownerUid: 'u1',
      customerName: 'Counter Sales',
      type: 'sale',
      amountPaise: 245050,
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: '2026-11-24T10:00:00',
    },
    {
      id: 's2',
      ownerUid: 'u1',
      customerName: 'Evening Cash',
      type: 'sale',
      amountPaise: 80000,
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: '2026-11-24T17:30:00',
    },
    // Today PENDING sale (MUST be excluded from totals)
    {
      id: 's-pending',
      ownerUid: 'u1',
      customerName: 'Voice Sale',
      type: 'sale',
      amountPaise: 99900,
      source: 'voice',
      status: 'pending',
      occurredAtIso: '2026-11-24T18:00:00',
    },
    // Yesterday confirmed sale (MUST be excluded from today's totals)
    {
      id: 's-yesterday',
      ownerUid: 'u1',
      customerName: 'Old Sale',
      type: 'sale',
      amountPaise: 500000,
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: '2026-11-23T14:00:00',
    },
    // Today confirmed expense: ₹1,120.25 (112025 paise)
    {
      id: 'e1',
      ownerUid: 'u1',
      customerName: 'Milk & Bread Supplier',
      type: 'expense',
      amountPaise: 112025,
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: '2026-11-24T08:15:00',
    },
    // Today confirmed expense with MISSING amount (null) — triggers warning chip, adds 0
    {
      id: 'e-missing',
      ownerUid: 'u1',
      customerName: 'Wholesale Rice Receipt',
      type: 'expense',
      amountPaise: null,
      source: 'camera',
      status: 'confirmed',
      occurredAtIso: '2026-11-24T11:45:00',
    },
    // Today PENDING expense (MUST be excluded from confirmed totals)
    {
      id: 'e-pending',
      ownerUid: 'u1',
      customerName: 'Electricity Bill',
      type: 'expense',
      amountPaise: 45000,
      source: 'camera',
      status: 'pending',
      occurredAtIso: '2026-11-24T12:00:00',
    },
    // Today confirmed Udhaar (credit ledger entry — does not distort Today's Sales/Expenses)
    {
      id: 'u1',
      ownerUid: 'u1',
      customerName: 'Anita Devi',
      type: 'udhaar',
      amountPaise: 50000,
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: '2026-11-24T15:00:00',
    },
  ];

  assert.equal(getLocalDateKey('2026-11-24T10:00:00'), today);
  assert.equal(selectTodaySalesPaise(entries, today), 325050);
  assert.equal(selectTodayExpensesPaise(entries, today), 112025);
  assert.equal(selectTodayEstimatedProfitPaise(entries, today), 325050 - 112025);
  assert.equal(selectPendingCount(entries), 2);
  assert.equal(selectPendingEntries(entries).length, 2);
  assert.equal(selectConfirmedEntries(entries).length, 6);
  assert.equal(selectExpensesMissingAmount(entries).length, 1);
  assert.equal(selectExpensesMissingAmount(entries)[0].id, 'e-missing');

  const totals = selectTodayDashboardTotals(entries, today);
  assert.equal(totals.todaySalesPaise, 325050);
  assert.equal(totals.todayExpensesPaise, 112025);
  assert.equal(totals.estimatedProfitPaise, 213025);
  assert.equal(totals.confirmedSalesCount, 2);
  assert.equal(totals.confirmedExpensesCount, 2);
  assert.equal(totals.pendingCount, 2);
  assert.equal(totals.missingAmountExpensesCount, 1);
});

test('Estimated profit handles negative days (expenses > sales) and empty ledgers cleanly', () => {
  const today = '2026-11-24';
  const emptyTotals = selectTodayDashboardTotals([], today);
  assert.equal(emptyTotals.todaySalesPaise, 0);
  assert.equal(emptyTotals.todayExpensesPaise, 0);
  assert.equal(emptyTotals.estimatedProfitPaise, 0);
  assert.equal(emptyTotals.pendingCount, 0);
  assert.equal(emptyTotals.missingAmountExpensesCount, 0);

  const lossEntries: LedgerEntryRecord[] = [
    {
      id: 's1',
      ownerUid: 'u1',
      customerName: 'Sales',
      type: 'sale',
      amountPaise: 50000,
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: '2026-11-24T09:00:00',
    },
    {
      id: 'e1',
      ownerUid: 'u1',
      customerName: 'Stock Restock',
      type: 'expense',
      amountPaise: 120000,
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: '2026-11-24T10:00:00',
    },
  ];

  assert.equal(selectTodayEstimatedProfitPaise(lossEntries, today), -70000);
});

test('calculateLedgerSummary excludes pending AI entries from financial totals', () => {
  const entries: LedgerEntryRecord[] = [
    {
      id: '1',
      ownerUid: 'u1',
      customerName: 'Asha',
      type: 'udhaar',
      amountPaise: 50000,
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: '2026-11-20T10:00:00.000Z',
    },
    {
      id: '2',
      ownerUid: 'u1',
      customerName: 'Asha',
      type: 'jama',
      amountPaise: 20000,
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: '2026-11-21T10:00:00.000Z',
    },
    {
      id: '3',
      ownerUid: 'u1',
      customerName: 'Ravi',
      type: 'udhaar',
      amountPaise: 99900,
      source: 'ai',
      status: 'pending',
      occurredAtIso: '2026-11-22T10:00:00.000Z',
    },
  ];

  const summary = calculateLedgerSummary(entries);
  assert.equal(summary.totalUdhaarPaise, 50000);
  assert.equal(summary.totalJamaPaise, 20000);
  assert.equal(summary.netOutstandingPaise, 30000);
  assert.equal(summary.confirmedCount, 2);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.averageConfirmedEntryPaise, 35000);
});

test('calculateCustomerBalances computes net per-customer due sorted descending', () => {
  const entries: LedgerEntryRecord[] = [
    {
      id: '1',
      ownerUid: 'u1',
      customerName: 'Suresh',
      customerPhone: '+919876543210',
      type: 'udhaar',
      amountPaise: 100000,
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: '2026-11-20T10:00:00.000Z',
    },
    {
      id: '2',
      ownerUid: 'u1',
      customerName: 'Suresh',
      type: 'jama',
      amountPaise: 40000,
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: '2026-11-22T10:00:00.000Z',
    },
    {
      id: '3',
      ownerUid: 'u1',
      customerName: 'Anita',
      type: 'udhaar',
      amountPaise: 85000,
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: '2026-11-21T10:00:00.000Z',
    },
  ];

  const balances = calculateCustomerBalances(entries);
  assert.equal(balances.length, 2);
  assert.equal(balances[0].customerName, 'Anita');
  assert.equal(balances[0].netDuePaise, 85000);
  assert.equal(balances[1].customerName, 'Suresh');
  assert.equal(balances[1].netDuePaise, 60000);
});

test('calculateProfitPaise and calculateMonthlyEmiPaise produce deterministic integers', () => {
  const profit = calculateProfitPaise(100000, 75000);
  assert.equal(profit.profitPaise, 25000);
  assert.equal(profit.marginBasisPoints, 2500);

  const emiZero = calculateMonthlyEmiPaise(120000, 0, 12);
  assert.equal(emiZero.monthlyEmiPaise, 10000);
  assert.equal(emiZero.totalInterestPaise, 0);

  const emiWithRate = calculateMonthlyEmiPaise(1000000, 12, 12);
  assert.equal(Number.isInteger(emiWithRate.monthlyEmiPaise), true);
  assert.ok(emiWithRate.monthlyEmiPaise > 88000 && emiWithRate.monthlyEmiPaise < 89000);
});

test('buildWhatsAppReminderUrl generates safe pre-filled wa.me link', () => {
  const urlWith10Digit = buildWhatsAppReminderUrl('9876543210', 'Namaste ₹500 due');
  assert.equal(urlWith10Digit, 'https://wa.me/919876543210?text=Namaste%20%E2%82%B9500%20due');

  const urlWithoutPhone = buildWhatsAppReminderUrl(undefined, 'Reminder');
  assert.equal(urlWithoutPhone, 'https://wa.me/?text=Reminder');
});
