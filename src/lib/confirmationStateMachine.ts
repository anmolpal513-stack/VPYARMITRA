/**
 * Pure Confirmation Module State Machine & Audit Trail Builder for VyaparMitra.
 *
 * Lifecycle State Machine:
 *   pending
 *     ├── REQUEST_CONFIRM (only if amountPaise > 0 & uncertain fields reviewed)
 *     │     └──> confirm_undo_window (10s grace timer)
 *     │            ├── UNDO (within 10s) ──> pending
 *     │            └── FINALIZE (timer ends / flush) ──> confirmed [TERMINAL]
 *     └── REQUEST_DELETE
 *           └──> delete_undo_window (10s grace timer)
 *                  ├── UNDO (within 10s) ──> pending
 *                  └── FINALIZE (timer ends / flush) ──> deleted [TERMINAL]
 *
 * Terminal Guarantee:
 *   Once an entry reaches `confirmed` or `deleted`, NO transition back to `pending`
 *   is permitted — enforced both here and in Firestore Security Rules.
 */

import {
  paiseToRupees,
  rupeesToPaise,
  type AuditEditableField,
  type LedgerEntryRecord,
  type LedgerEntryType,
  type OriginalAIValueSnapshot,
} from './finance';
import { LOW_CONFIDENCE_THRESHOLD } from './voiceExtraction';
import { sanitizeCustomerName, sanitizeNote } from './validation';

export const UNDO_WINDOW_MS = 10_000;

export type ConfirmationLifecycleState =
  | 'pending'
  | 'confirm_undo_window'
  | 'delete_undo_window'
  | 'confirmed'
  | 'deleted';

export type ConfirmationTransitionEvent =
  | { type: 'REQUEST_CONFIRM'; canConfirm: boolean }
  | { type: 'REQUEST_DELETE' }
  | { type: 'UNDO' }
  | { type: 'FINALIZE' };

export interface TransitionResult {
  allowed: boolean;
  nextState: ConfirmationLifecycleState;
  reason?: string;
}

/**
 * Pure finite state machine transition function for pending -> confirmed/deleted.
 */
export function transitionConfirmationState(
  current: ConfirmationLifecycleState,
  event: ConfirmationTransitionEvent
): TransitionResult {
  if (current === 'confirmed' || current === 'deleted') {
    return {
      allowed: false,
      nextState: current,
      reason: `State "${current}" is terminal and cannot transition on "${event.type}".`,
    };
  }

  switch (current) {
    case 'pending': {
      if (event.type === 'REQUEST_CONFIRM') {
        if (!event.canConfirm) {
          return {
            allowed: false,
            nextState: 'pending',
            reason: 'Confirmation blocked: amount missing/invalid or uncertain fields unreviewed.',
          };
        }
        return { allowed: true, nextState: 'confirm_undo_window' };
      }
      if (event.type === 'REQUEST_DELETE') {
        return { allowed: true, nextState: 'delete_undo_window' };
      }
      return {
        allowed: false,
        nextState: 'pending',
        reason: `Event "${event.type}" is not valid from "pending".`,
      };
    }

    case 'confirm_undo_window': {
      if (event.type === 'UNDO') {
        return { allowed: true, nextState: 'pending' };
      }
      if (event.type === 'FINALIZE') {
        return { allowed: true, nextState: 'confirmed' };
      }
      return {
        allowed: false,
        nextState: current,
        reason: `Event "${event.type}" is not valid during confirm undo window.`,
      };
    }

    case 'delete_undo_window': {
      if (event.type === 'UNDO') {
        return { allowed: true, nextState: 'pending' };
      }
      if (event.type === 'FINALIZE') {
        return { allowed: true, nextState: 'deleted' };
      }
      return {
        allowed: false,
        nextState: current,
        reason: `Event "${event.type}" is not valid during delete undo window.`,
      };
    }
  }
}

export interface PendingEntryDraft {
  customerName: string;
  type: LedgerEntryType;
  amountRupees: string;
  note: string;
}

export function createDraftFromEntry(entry: LedgerEntryRecord): PendingEntryDraft {
  return {
    customerName: entry.customerName,
    type: entry.type,
    amountRupees:
      entry.amountPaise !== null && entry.amountPaise > 0
        ? String(paiseToRupees(entry.amountPaise))
        : '',
    note: entry.note ?? '',
  };
}

export function entryHasUncertainFields(entry: LedgerEntryRecord): boolean {
  const hasExplicitUncertain = (entry.uncertainFields?.length ?? 0) > 0;
  const isLowConfidence =
    typeof entry.confidence === 'number' && entry.confidence < LOW_CONFIDENCE_THRESHOLD;
  const isMissingAmount = entry.amountPaise === null || entry.amountPaise <= 0;
  return hasExplicitUncertain || isLowConfidence || isMissingAmount;
}

export type ConfirmBlockReason =
  | 'MISSING_OR_INVALID_AMOUNT'
  | 'INVALID_CUSTOMER_NAME'
  | 'UNCERTAIN_FIELDS_UNREVIEWED';

export type ConfirmEligibilityResult =
  | {
      eligible: true;
      sanitized: {
        customerName: string;
        type: LedgerEntryType;
        amountPaise: number;
        note: string;
      };
    }
  | {
      eligible: false;
      reason: ConfirmBlockReason;
    };

/**
 * Deterministic validation gate before allowing confirmation.
 * STRICTLY BLOCKS confirmation whenever amount is missing or <= 0,
 * customer name is invalid, or uncertain fields have not been reviewed.
 */
export function evaluateConfirmEligibility(
  entry: LedgerEntryRecord,
  draft: PendingEntryDraft,
  uncertainReviewed: boolean
): ConfirmEligibilityResult {
  const nameCheck = sanitizeCustomerName(draft.customerName);
  if (!nameCheck.valid) {
    return { eligible: false, reason: 'INVALID_CUSTOMER_NAME' };
  }

  const parsedPaise = rupeesToPaise(draft.amountRupees.trim());
  if (parsedPaise === null || parsedPaise <= 0) {
    return { eligible: false, reason: 'MISSING_OR_INVALID_AMOUNT' };
  }

  if (entryHasUncertainFields(entry) && !uncertainReviewed) {
    return { eligible: false, reason: 'UNCERTAIN_FIELDS_UNREVIEWED' };
  }

  return {
    eligible: true,
    sanitized: {
      customerName: nameCheck.sanitized,
      type: draft.type,
      amountPaise: parsedPaise,
      note: sanitizeNote(draft.note),
    },
  };
}

export interface ConfirmationAuditTrail {
  confirmedAt: string;
  editedFields: AuditEditableField[];
  originalAIValue: OriginalAIValueSnapshot;
}

/**
 * Builds the immutable audit trail persisted on confirmation:
 * - confirmedAt: ISO 8601 timestamp
 * - originalAIValue: original values before shopkeeper edits
 * - editedFields: list of fields modified by the shopkeeper
 */
export function buildConfirmationAuditTrail(
  originalEntry: LedgerEntryRecord,
  finalValues: {
    customerName: string;
    type: LedgerEntryType;
    amountPaise: number;
    note: string;
  },
  confirmedAtIso: string = new Date().toISOString()
): ConfirmationAuditTrail {
  const originalSnapshot: OriginalAIValueSnapshot = originalEntry.originalAIValue ?? {
    customerName: originalEntry.customerName.trim().slice(0, 60),
    type: originalEntry.type,
    amountPaise: originalEntry.amountPaise,
    note: (originalEntry.note ?? '').trim().slice(0, 140),
  };

  const editedFields: AuditEditableField[] = [];
  if (finalValues.customerName.trim() !== originalSnapshot.customerName.trim()) {
    editedFields.push('customerName');
  }
  if (finalValues.type !== originalSnapshot.type) {
    editedFields.push('type');
  }
  if (finalValues.amountPaise !== originalSnapshot.amountPaise) {
    editedFields.push('amountPaise');
  }
  if (finalValues.note.trim() !== originalSnapshot.note.trim()) {
    editedFields.push('note');
  }

  return {
    confirmedAt: confirmedAtIso,
    editedFields,
    originalAIValue: originalSnapshot,
  };
}

export type PendingSourceGroupKey = 'voice' | 'camera' | 'other';

export interface PendingSourceGroup {
  key: PendingSourceGroupKey;
  entries: LedgerEntryRecord[];
  uncertainCount: number;
}

/**
 * Groups pending entries deterministically by source: Voice, Photo/Camera, and Other AI.
 */
export function groupPendingEntriesBySource(
  entries: readonly LedgerEntryRecord[]
): PendingSourceGroup[] {
  const voice: LedgerEntryRecord[] = [];
  const camera: LedgerEntryRecord[] = [];
  const other: LedgerEntryRecord[] = [];

  for (const entry of entries) {
    if (entry.status !== 'pending') continue;
    if (entry.source === 'voice') {
      voice.push(entry);
    } else if (entry.source === 'camera') {
      camera.push(entry);
    } else {
      other.push(entry);
    }
  }

  const groups: PendingSourceGroup[] = [];
  if (voice.length > 0) {
    groups.push({
      key: 'voice',
      entries: voice,
      uncertainCount: voice.filter(entryHasUncertainFields).length,
    });
  }
  if (camera.length > 0) {
    groups.push({
      key: 'camera',
      entries: camera,
      uncertainCount: camera.filter(entryHasUncertainFields).length,
    });
  }
  if (other.length > 0) {
    groups.push({
      key: 'other',
      entries: other,
      uncertainCount: other.filter(entryHasUncertainFields).length,
    });
  }

  return groups;
}

export interface ConfirmAllPartition {
  eligible: Array<{
    entry: LedgerEntryRecord;
    sanitized: {
      customerName: string;
      type: LedgerEntryType;
      amountPaise: number;
      note: string;
    };
  }>;
  blockedMissingAmount: LedgerEntryRecord[];
  blockedUncertain: LedgerEntryRecord[];
  blockedInvalidName: LedgerEntryRecord[];
}

/**
 * Partitions all visible pending entries for the "Confirm all" warning dialog.
 * Entries with missing/<=0 amounts or unreviewed uncertain fields are strictly blocked.
 */
export function partitionConfirmAllCandidates(
  entries: readonly LedgerEntryRecord[],
  drafts: Record<string, PendingEntryDraft>,
  reviewedMap: Record<string, boolean>
): ConfirmAllPartition {
  const result: ConfirmAllPartition = {
    eligible: [],
    blockedMissingAmount: [],
    blockedUncertain: [],
    blockedInvalidName: [],
  };

  for (const entry of entries) {
    if (entry.status !== 'pending') continue;
    const draft = drafts[entry.id] ?? createDraftFromEntry(entry);
    const check = evaluateConfirmEligibility(entry, draft, Boolean(reviewedMap[entry.id]));

    if (check.eligible) {
      result.eligible.push({ entry, sanitized: check.sanitized });
    } else if (check.reason === 'MISSING_OR_INVALID_AMOUNT') {
      result.blockedMissingAmount.push(entry);
    } else if (check.reason === 'UNCERTAIN_FIELDS_UNREVIEWED') {
      result.blockedUncertain.push(entry);
    } else {
      result.blockedInvalidName.push(entry);
    }
  }

  return result;
}
