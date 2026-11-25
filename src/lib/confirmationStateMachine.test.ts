import test from 'node:test';
import assert from 'node:assert/strict';
import type { LedgerEntryRecord } from './finance';
import {
  buildConfirmationAuditTrail,
  createDraftFromEntry,
  evaluateConfirmEligibility,
  groupPendingEntriesBySource,
  partitionConfirmAllCandidates,
  transitionConfirmationState,
} from './confirmationStateMachine';

const sampleVoiceUncertain: LedgerEntryRecord = {
  id: 'v1',
  ownerUid: 'u1',
  customerName: 'शाम की बिक्री',
  type: 'sale',
  amountPaise: 45000,
  note: 'आवाज़ एंट्री',
  source: 'voice',
  status: 'pending',
  occurredAtIso: '2026-11-24T12:00:00.000Z',
  confidence: 0.64,
  transcript: 'शाम की बिक्री साढ़े चार सौ रुपये शायद',
  uncertainFields: ['amount', 'type'],
};

const samplePhotoMissingAmount: LedgerEntryRecord = {
  id: 'p1',
  ownerUid: 'u1',
  customerName: 'मोहन डेयरी',
  type: 'expense',
  amountPaise: null,
  note: 'दूध क्रेट',
  source: 'camera',
  status: 'pending',
  occurredAtIso: '2026-11-24T11:00:00.000Z',
  confidence: 0.58,
  uncertainFields: ['amount'],
  sourceImageUrl: 'https://firebasestorage.googleapis.com/v0/b/app/o/bill.jpg',
};

const samplePhotoClean: LedgerEntryRecord = {
  id: 'p2',
  ownerUid: 'u1',
  customerName: 'सुरेश गुप्ता',
  type: 'udhaar',
  amountPaise: 34550,
  note: 'आटा 5kg',
  source: 'camera',
  status: 'pending',
  occurredAtIso: '2026-11-24T10:00:00.000Z',
  confidence: 0.94,
};

test('state machine allows pending -> confirm_undo_window -> undo -> pending -> confirmed (terminal)', () => {
  const blocked = transitionConfirmationState('pending', {
    type: 'REQUEST_CONFIRM',
    canConfirm: false,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.nextState, 'pending');

  const staged = transitionConfirmationState('pending', {
    type: 'REQUEST_CONFIRM',
    canConfirm: true,
  });
  assert.equal(staged.allowed, true);
  assert.equal(staged.nextState, 'confirm_undo_window');

  // Undo within 10s returns to pending
  const undone = transitionConfirmationState('confirm_undo_window', { type: 'UNDO' });
  assert.equal(undone.allowed, true);
  assert.equal(undone.nextState, 'pending');

  // Finalize makes entry permanently confirmed
  const finalized = transitionConfirmationState('confirm_undo_window', { type: 'FINALIZE' });
  assert.equal(finalized.allowed, true);
  assert.equal(finalized.nextState, 'confirmed');

  // Terminal invariant: confirmed CANNOT revert via UNDO or DELETE
  assert.equal(transitionConfirmationState('confirmed', { type: 'UNDO' }).allowed, false);
  assert.equal(transitionConfirmationState('confirmed', { type: 'REQUEST_DELETE' }).allowed, false);
});

test('state machine supports pending -> delete_undo_window -> undo or finalize -> deleted (terminal)', () => {
  const stagedDel = transitionConfirmationState('pending', { type: 'REQUEST_DELETE' });
  assert.equal(stagedDel.allowed, true);
  assert.equal(stagedDel.nextState, 'delete_undo_window');

  const undone = transitionConfirmationState('delete_undo_window', { type: 'UNDO' });
  assert.equal(undone.allowed, true);
  assert.equal(undone.nextState, 'pending');

  const finalized = transitionConfirmationState('delete_undo_window', { type: 'FINALIZE' });
  assert.equal(finalized.allowed, true);
  assert.equal(finalized.nextState, 'deleted');

  assert.equal(transitionConfirmationState('deleted', { type: 'UNDO' }).allowed, false);
});

test('evaluateConfirmEligibility strictly blocks missing, zero, or negative amounts and unreviewed uncertain fields', () => {
  // Missing amount blocked even if reviewed=true
  const missingCheck = evaluateConfirmEligibility(
    samplePhotoMissingAmount,
    createDraftFromEntry(samplePhotoMissingAmount),
    true
  );
  assert.equal(missingCheck.eligible, false);
  if (!missingCheck.eligible) {
    assert.equal(missingCheck.reason, 'MISSING_OR_INVALID_AMOUNT');
  }

  // Zero amount blocked
  const zeroCheck = evaluateConfirmEligibility(
    samplePhotoClean,
    { ...createDraftFromEntry(samplePhotoClean), amountRupees: '0' },
    true
  );
  assert.equal(zeroCheck.eligible, false);
  if (!zeroCheck.eligible) {
    assert.equal(zeroCheck.reason, 'MISSING_OR_INVALID_AMOUNT');
  }

  // Negative amount blocked
  const negCheck = evaluateConfirmEligibility(
    samplePhotoClean,
    { ...createDraftFromEntry(samplePhotoClean), amountRupees: '-150' },
    true
  );
  assert.equal(negCheck.eligible, false);
  if (!negCheck.eligible) {
    assert.equal(negCheck.reason, 'MISSING_OR_INVALID_AMOUNT');
  }

  // Unreviewed uncertain entry blocked until explicitly reviewed
  const unreviewed = evaluateConfirmEligibility(
    sampleVoiceUncertain,
    createDraftFromEntry(sampleVoiceUncertain),
    false
  );
  assert.equal(unreviewed.eligible, false);
  if (!unreviewed.eligible) {
    assert.equal(unreviewed.reason, 'UNCERTAIN_FIELDS_UNREVIEWED');
  }

  // Once reviewed with valid positive amount, confirmation is allowed
  const reviewed = evaluateConfirmEligibility(
    sampleVoiceUncertain,
    createDraftFromEntry(sampleVoiceUncertain),
    true
  );
  assert.equal(reviewed.eligible, true);
  if (reviewed.eligible) {
    assert.equal(reviewed.sanitized.amountPaise, 45000);
  }
});

test('buildConfirmationAuditTrail records confirmedAt, editedFields, and immutable originalAIValue', () => {
  const audit = buildConfirmationAuditTrail(
    sampleVoiceUncertain,
    {
      customerName: 'शाम की नकद बिक्री',
      type: 'sale',
      amountPaise: 50000,
      note: 'आवाज़ एंट्री',
    },
    '2026-11-24T16:45:00.000Z'
  );

  assert.equal(audit.confirmedAt, '2026-11-24T16:45:00.000Z');
  assert.deepEqual(audit.editedFields, ['customerName', 'amountPaise']);
  assert.deepEqual(audit.originalAIValue, {
    customerName: 'शाम की बिक्री',
    type: 'sale',
    amountPaise: 45000,
    note: 'आवाज़ एंट्री',
  });
});

test('groupPendingEntriesBySource groups voice and photo entries cleanly and ignores confirmed entries', () => {
  const confirmedEntry: LedgerEntryRecord = {
    ...samplePhotoClean,
    id: 'c1',
    status: 'confirmed',
  };

  const groups = groupPendingEntriesBySource([
    sampleVoiceUncertain,
    samplePhotoMissingAmount,
    samplePhotoClean,
    confirmedEntry,
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].key, 'voice');
  assert.equal(groups[0].entries.length, 1);
  assert.equal(groups[0].uncertainCount, 1);
  assert.equal(groups[1].key, 'camera');
  assert.equal(groups[1].entries.length, 2);
  assert.equal(groups[1].uncertainCount, 1);
});

test('partitionConfirmAllCandidates separates eligible entries from blocked missing-amount and unreviewed uncertain entries', () => {
  const partition = partitionConfirmAllCandidates(
    [sampleVoiceUncertain, samplePhotoMissingAmount, samplePhotoClean],
    {},
    {}
  );

  assert.equal(partition.eligible.length, 1);
  assert.equal(partition.eligible[0].entry.id, 'p2');
  assert.equal(partition.blockedMissingAmount.length, 1);
  assert.equal(partition.blockedMissingAmount[0].id, 'p1');
  assert.equal(partition.blockedUncertain.length, 1);
  assert.equal(partition.blockedUncertain[0].id, 'v1');
});
