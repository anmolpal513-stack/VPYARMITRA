import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  Mic,
  PencilLine,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import { t, type AppLanguage } from '../../lib/i18n';
import {
  formatINR,
  rupeesToPaise,
  type LedgerEntryRecord,
  type LedgerEntryType,
  type UncertainField,
} from '../../lib/finance';
import { LOW_CONFIDENCE_THRESHOLD } from '../../lib/voiceExtraction';
import { isSafeSourceImageUrl } from '../../lib/photoExtraction';
import type { ConfirmEntryOverrides } from '../../lib/firebase';
import {
  UNDO_WINDOW_MS,
  buildConfirmationAuditTrail,
  createDraftFromEntry,
  entryHasUncertainFields,
  evaluateConfirmEligibility,
  groupPendingEntriesBySource,
  partitionConfirmAllCandidates,
  transitionConfirmationState,
  type ConfirmationLifecycleState,
  type PendingEntryDraft,
  type PendingSourceGroupKey,
} from '../../lib/confirmationStateMachine';

interface StagedConfirmItem {
  entry: LedgerEntryRecord;
  sanitized: {
    customerName: string;
    type: LedgerEntryType;
    amountPaise: number;
    note: string;
  };
}

interface ActiveUndoBatch {
  id: string;
  kind: 'confirm' | 'delete';
  lifecycleState: ConfirmationLifecycleState;
  items: StagedConfirmItem[];
  deleteEntries: LedgerEntryRecord[];
  label: string;
  expiresAtMs: number;
}

interface ConfirmationModuleProps {
  language: AppLanguage;
  isOffline?: boolean;
  pendingEntries: LedgerEntryRecord[];
  onConfirmEntry: (entryId: string, overrides: ConfirmEntryOverrides) => Promise<void>;
  onDiscardEntry: (entryId: string) => Promise<void>;
  onClose: () => void;
}

export function ConfirmationModule({
  language,
  isOffline = false,
  pendingEntries,
  onConfirmEntry,
  onDiscardEntry,
  onClose,
}: ConfirmationModuleProps) {
  const [drafts, setDrafts] = useState<Record<string, PendingEntryDraft>>({});
  const [expandedEditIds, setExpandedEditIds] = useState<Record<string, boolean>>({});
  const [reviewedUncertainMap, setReviewedUncertainMap] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, { customerName?: string; amount?: string; uncertain?: string }>
  >({});
  const [showConfirmAllDialog, setShowConfirmAllDialog] = useState(false);
  const [activeUndo, setActiveUndo] = useState<ActiveUndoBatch | null>(null);
  const [remainingMs, setRemainingMs] = useState<number>(UNDO_WINDOW_MS);
  const [finalizing, setFinalizing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeUndoRef = useRef<ActiveUndoBatch | null>(null);
  const finalizeTimerRef = useRef<number | null>(null);
  const onConfirmRef = useRef(onConfirmEntry);
  const onDiscardRef = useRef(onDiscardEntry);

  useEffect(() => {
    onConfirmRef.current = onConfirmEntry;
    onDiscardRef.current = onDiscardEntry;
  }, [onConfirmEntry, onDiscardEntry]);

  useEffect(() => {
    activeUndoRef.current = activeUndo;
  }, [activeUndo]);

  const clearTimer = useCallback(() => {
    if (finalizeTimerRef.current !== null) {
      window.clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
  }, []);

  /**
   * Executes the terminal Firestore/local commit once the 10-second Undo window ends
   * (or when flushed on navigation/unmount).
   */
  const commitUndoBatch = useCallback(async (batch: ActiveUndoBatch) => {
    const transition = transitionConfirmationState(batch.lifecycleState, { type: 'FINALIZE' });
    if (!transition.allowed) return;

    setFinalizing(true);
    try {
      if (batch.kind === 'confirm') {
        for (const item of batch.items) {
          const auditTrail = buildConfirmationAuditTrail(item.entry, item.sanitized);
          await onConfirmRef.current(item.entry.id, {
            customerName: item.sanitized.customerName,
            type: item.sanitized.type,
            amountPaise: item.sanitized.amountPaise,
            note: item.sanitized.note,
            confirmedAt: auditTrail.confirmedAt,
            editedFields: auditTrail.editedFields,
            originalAIValue: auditTrail.originalAIValue,
          });
        }
      } else {
        for (const entry of batch.deleteEntries) {
          await onDiscardRef.current(entry.id);
        }
      }
      setActionError(null);
    } catch {
      setActionError(t(language, 'confirmActionError'));
    } finally {
      setFinalizing(false);
    }
  }, [language]);

  const flushActiveUndoNow = useCallback(async () => {
    const current = activeUndoRef.current;
    if (!current) return;
    clearTimer();
    activeUndoRef.current = null;
    setActiveUndo(null);
    await commitUndoBatch(current);
  }, [clearTimer, commitUndoBatch]);

  // Countdown tick for the 10-second Undo snackbar
  useEffect(() => {
    if (!activeUndo) {
      setRemainingMs(UNDO_WINDOW_MS);
      return;
    }
    const tick = () => {
      const left = Math.max(0, activeUndo.expiresAtMs - Date.now());
      setRemainingMs(left);
    };
    tick();
    const intervalId = window.setInterval(tick, 150);
    return () => window.clearInterval(intervalId);
  }, [activeUndo]);

  // Flush any pending un-undone staged action if the component unmounts
  useEffect(() => {
    return () => {
      clearTimer();
      const pendingBatch = activeUndoRef.current;
      if (pendingBatch) {
        activeUndoRef.current = null;
        void commitUndoBatch(pendingBatch);
      }
    };
  }, [clearTimer, commitUndoBatch]);

  const scheduleUndoBatch = useCallback(
    async (nextBatch: Omit<ActiveUndoBatch, 'expiresAtMs'>) => {
      // Finalize any earlier staged action immediately so nothing is lost
      if (activeUndoRef.current) {
        await flushActiveUndoNow();
      }

      const fullBatch: ActiveUndoBatch = {
        ...nextBatch,
        expiresAtMs: Date.now() + UNDO_WINDOW_MS,
      };
      activeUndoRef.current = fullBatch;
      setActiveUndo(fullBatch);
      setRemainingMs(UNDO_WINDOW_MS);
      setActionError(null);

      clearTimer();
      finalizeTimerRef.current = window.setTimeout(() => {
        const latest = activeUndoRef.current;
        if (!latest || latest.id !== fullBatch.id) return;
        activeUndoRef.current = null;
        setActiveUndo(null);
        void commitUndoBatch(latest);
      }, UNDO_WINDOW_MS);
    },
    [clearTimer, commitUndoBatch, flushActiveUndoNow]
  );

  const handleUndoClick = () => {
    const current = activeUndoRef.current;
    if (!current) return;
    const transition = transitionConfirmationState(current.lifecycleState, { type: 'UNDO' });
    if (!transition.allowed) return;
    clearTimer();
    activeUndoRef.current = null;
    setActiveUndo(null);
    setActionError(null);
  };

  const handleBackToHome = async () => {
    await flushActiveUndoNow();
    onClose();
  };

  const stagedIds = useMemo(() => {
    const ids = new Set<string>();
    if (!activeUndo) return ids;
    for (const item of activeUndo.items) ids.add(item.entry.id);
    for (const entry of activeUndo.deleteEntries) ids.add(entry.id);
    return ids;
  }, [activeUndo]);

  const visiblePendingEntries = useMemo(
    () => pendingEntries.filter((entry) => !stagedIds.has(entry.id)),
    [pendingEntries, stagedIds]
  );

  const groupedEntries = useMemo(
    () => groupPendingEntriesBySource(visiblePendingEntries),
    [visiblePendingEntries]
  );

  const confirmAllPartition = useMemo(
    () => partitionConfirmAllCandidates(visiblePendingEntries, drafts, reviewedUncertainMap),
    [visiblePendingEntries, drafts, reviewedUncertainMap]
  );

  const getDraft = (entry: LedgerEntryRecord): PendingEntryDraft => {
    if (drafts[entry.id]) return drafts[entry.id];
    return createDraftFromEntry(entry);
  };

  const updateDraft = (entry: LedgerEntryRecord, patch: Partial<PendingEntryDraft>) => {
    const current = getDraft(entry);
    setDrafts((prev) => ({
      ...prev,
      [entry.id]: { ...current, ...patch },
    }));
  };

  const getTypeLabel = (type: LedgerEntryType) => {
    if (type === 'sale') return t(language, 'homeTypeSale');
    if (type === 'expense') return t(language, 'homeTypeExpense');
    if (type === 'jama') return t(language, 'dashTypeJama');
    return t(language, 'dashTypeUdhaar');
  };

  const getGroupMeta = (key: PendingSourceGroupKey) => {
    if (key === 'voice') {
      return { icon: Mic, title: t(language, 'confirmGroupVoice') };
    }
    if (key === 'camera') {
      return { icon: Camera, title: t(language, 'confirmGroupPhoto') };
    }
    return { icon: Sparkles, title: t(language, 'confirmGroupOther') };
  };

  const handleConfirmSingle = async (entry: LedgerEntryRecord) => {
    const draft = getDraft(entry);
    const eligibility = evaluateConfirmEligibility(
      entry,
      draft,
      Boolean(reviewedUncertainMap[entry.id])
    );

    if (!eligibility.eligible) {
      setExpandedEditIds((prev) => ({ ...prev, [entry.id]: true }));
      setFieldErrors((prev) => ({
        ...prev,
        [entry.id]: {
          customerName:
            eligibility.reason === 'INVALID_CUSTOMER_NAME'
              ? t(language, 'errCustomerNameRequired')
              : undefined,
          amount:
            eligibility.reason === 'MISSING_OR_INVALID_AMOUNT'
              ? t(language, 'confirmBlockedAmountMsg')
              : undefined,
          uncertain:
            eligibility.reason === 'UNCERTAIN_FIELDS_UNREVIEWED'
              ? t(language, 'confirmBlockedUncertainMsg')
              : undefined,
        },
      }));
      return;
    }

    const transition = transitionConfirmationState('pending', {
      type: 'REQUEST_CONFIRM',
      canConfirm: true,
    });
    if (!transition.allowed) return;

    setFieldErrors((prev) => ({ ...prev, [entry.id]: {} }));

    await scheduleUndoBatch({
      id: `confirm_${entry.id}_${Date.now()}`,
      kind: 'confirm',
      lifecycleState: transition.nextState,
      items: [{ entry, sanitized: eligibility.sanitized }],
      deleteEntries: [],
      label: t(language, 'confirmUndoConfirmedMsg', {
        name: eligibility.sanitized.customerName,
      }),
    });
  };

  const handleDeleteSingle = async (entry: LedgerEntryRecord) => {
    const transition = transitionConfirmationState('pending', { type: 'REQUEST_DELETE' });
    if (!transition.allowed) return;

    await scheduleUndoBatch({
      id: `delete_${entry.id}_${Date.now()}`,
      kind: 'delete',
      lifecycleState: transition.nextState,
      items: [],
      deleteEntries: [entry],
      label: t(language, 'confirmUndoDeletedMsg', { name: entry.customerName }),
    });
  };

  const handleConfirmAllProceed = async () => {
    if (confirmAllPartition.eligible.length === 0) return;

    const transition = transitionConfirmationState('pending', {
      type: 'REQUEST_CONFIRM',
      canConfirm: true,
    });
    if (!transition.allowed) return;

    setShowConfirmAllDialog(false);

    await scheduleUndoBatch({
      id: `confirm_all_${Date.now()}`,
      kind: 'confirm',
      lifecycleState: transition.nextState,
      items: confirmAllPartition.eligible,
      deleteEntries: [],
      label: t(language, 'confirmUndoBatchMsg', {
        count: confirmAllPartition.eligible.length,
      }),
    });
  };

  const typeOptions: Array<{ id: LedgerEntryType; label: string }> = [
    { id: 'sale', label: t(language, 'homeTypeSale') },
    { id: 'expense', label: t(language, 'homeTypeExpense') },
    { id: 'udhaar', label: t(language, 'dashTypeUdhaar') },
    { id: 'jama', label: t(language, 'dashTypeJama') },
  ];

  const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const progressPct = Math.max(0, Math.min(100, (remainingMs / UNDO_WINDOW_MS) * 100));

  return (
    <section
      aria-labelledby="confirmation-module-heading"
      data-testid="confirmation-module"
      className="space-y-5 pb-20"
    >
      {/* Top Header Row + Confirm All Action */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => void handleBackToHome()}
            className="min-h-[40px] px-0 py-1 text-sm font-semibold text-emerald-800 hover:text-emerald-950 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>{t(language, 'confirmModuleBackToHome')}</span>
          </button>
          <h1
            id="confirmation-module-heading"
            className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight"
          >
            {t(language, 'confirmModuleTitle')}
          </h1>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl">
            {t(language, 'confirmModuleSubtitle')}
          </p>
        </div>

        {visiblePendingEntries.length > 0 && (
          <button
            type="button"
            data-testid="confirm-all-btn"
            onClick={() => setShowConfirmAllDialog(true)}
            className="min-h-[48px] px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <CheckCheck className="w-4 h-4" aria-hidden="true" />
            <span>{t(language, 'confirmAllBtn')}</span>
          </button>
        )}
      </div>

      {/* Offline Notice */}
      {isOffline && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-slate-100 border border-slate-300 text-slate-800 text-xs sm:text-sm font-medium flex items-center gap-2.5"
        >
          <WifiOff className="w-4 h-4 text-slate-600 shrink-0" aria-hidden="true" />
          <span>{t(language, 'confirmOfflineNotice')}</span>
        </div>
      )}

      {/* Commit Error Banner */}
      {actionError && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-900 text-sm font-medium flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-700 shrink-0" aria-hidden="true" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label={t(language, 'close')}
            className="min-h-[36px] min-w-[36px] rounded-lg hover:bg-red-100 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Empty State */}
      {visiblePendingEntries.length === 0 ? (
        <div
          data-testid="confirmation-empty-state"
          className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-4"
        >
          <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <CheckCircle2 className="w-7 h-7" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900">
              {t(language, 'confirmModuleEmptyTitle')}
            </h2>
            <p className="text-sm text-slate-600">
              {t(language, 'confirmModuleEmptyDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleBackToHome()}
            className="min-h-[48px] px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm cursor-pointer"
          >
            {t(language, 'confirmModuleBackToHome')}
          </button>
        </div>
      ) : (
        /* Source-Grouped Pending Lists (Voice / Photo / Other AI) */
        <div className="space-y-6" data-testid="confirmation-pending-list">
          {groupedEntries.map((group) => {
            const groupMeta = getGroupMeta(group.key);
            const GroupIcon = groupMeta.icon;

            return (
              <section
                key={group.key}
                data-testid={`confirm-group-${group.key}`}
                aria-labelledby={`confirm-group-heading-${group.key}`}
                className="space-y-3"
              >
                {/* Group Section Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
                      <GroupIcon className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <h2
                      id={`confirm-group-heading-${group.key}`}
                      className="text-base font-bold text-slate-900"
                    >
                      {groupMeta.title}
                    </h2>
                    <span className="text-xs font-semibold text-slate-500">
                      · {t(language, 'confirmGroupCount', { count: group.entries.length })}
                    </span>
                  </div>

                  {group.uncertainCount > 0 && (
                    <span className="text-xs font-semibold text-amber-800 inline-flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>
                        {t(language, 'confirmGroupUncertainCount', {
                          count: group.uncertainCount,
                        })}
                      </span>
                    </span>
                  )}
                </div>

                {/* Entries inside Source Group */}
                <ul className="space-y-4">
                  {group.entries.map((entry) => {
                    const draft = getDraft(entry);
                    const uncertainSet = new Set<UncertainField>(entry.uncertainFields ?? []);
                    const parsedDraftPaise = rupeesToPaise(draft.amountRupees.trim());
                    const hasValidAmount = parsedDraftPaise !== null && parsedDraftPaise > 0;
                    const originalMissingAmount =
                      entry.amountPaise === null || entry.amountPaise <= 0;

                    if (originalMissingAmount || !hasValidAmount) {
                      uncertainSet.add('amount');
                    }

                    const needsUncertainReview = entryHasUncertainFields(entry);
                    const isReviewed = Boolean(reviewedUncertainMap[entry.id]);
                    const isLowConfidence =
                      typeof entry.confidence === 'number' &&
                      entry.confidence < LOW_CONFIDENCE_THRESHOLD;
                    const showEditor =
                      needsUncertainReview ||
                      !hasValidAmount ||
                      Boolean(expandedEditIds[entry.id]);
                    const isOutflow = draft.type === 'expense' || draft.type === 'udhaar';
                    const confidencePct =
                      typeof entry.confidence === 'number'
                        ? Math.round(entry.confidence * 100)
                        : null;
                    const errors = fieldErrors[entry.id] ?? {};

                    return (
                      <li
                        key={entry.id}
                        data-testid={`pending-card-${entry.id}`}
                        className={`bg-white rounded-2xl p-5 space-y-4 border ${
                          !hasValidAmount
                            ? 'border-red-300'
                            : needsUncertainReview && !isReviewed
                              ? 'border-amber-300'
                              : 'border-slate-200'
                        }`}
                      >
                        {/* Card Summary Row */}
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span className="font-semibold text-slate-800">
                                {getTypeLabel(draft.type)}
                              </span>
                              {confidencePct !== null && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span
                                    className={`font-mono font-semibold ${
                                      isLowConfidence ? 'text-amber-800' : 'text-slate-600'
                                    }`}
                                  >
                                    {t(language, 'confirmConfidenceLabel', {
                                      pct: confidencePct,
                                    })}
                                  </span>
                                </>
                              )}
                            </div>

                            <h3 className="text-lg font-bold text-slate-900 truncate">
                              {draft.customerName}
                            </h3>

                            {draft.note && (
                              <p className="text-sm text-slate-600 leading-relaxed">
                                {draft.note}
                              </p>
                            )}

                            {entry.transcript && (
                              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-1.5 leading-relaxed">
                                <span className="font-semibold text-slate-800">
                                  {t(language, 'confirmTranscriptLabel')}:{' '}
                                </span>
                                “{entry.transcript}”
                              </p>
                            )}

                            {isSafeSourceImageUrl(entry.sourceImageUrl) && (
                              <a
                                href={entry.sourceImageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-950 hover:underline pt-0.5"
                              >
                                <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>{t(language, 'photoViewSourceLink')}</span>
                                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                              </a>
                            )}
                          </div>

                          <div className="shrink-0 flex sm:flex-col items-center sm:items-end justify-between gap-2">
                            {hasValidAmount ? (
                              <span
                                className={`text-2xl font-bold font-mono tabular-nums ${
                                  isOutflow ? 'text-red-700' : 'text-emerald-700'
                                }`}
                              >
                                {formatINR(parsedDraftPaise as number)}
                              </span>
                            ) : (
                              <span className="text-sm font-bold text-red-700 inline-flex items-center gap-1">
                                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                                <span>{t(language, 'homeAmountMissingLabel')}</span>
                              </span>
                            )}

                            <button
                              type="button"
                              data-testid={`edit-btn-${entry.id}`}
                              onClick={() =>
                                setExpandedEditIds((prev) => ({
                                  ...prev,
                                  [entry.id]: !showEditor,
                                }))
                              }
                              className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <PencilLine className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>
                                {showEditor
                                  ? t(language, 'confirmCloseEditToggle')
                                  : t(language, 'confirmEditFieldsToggle')}
                              </span>
                            </button>
                          </div>
                        </div>

                        {/* Uncertain / Missing Amount Alert Banner */}
                        {needsUncertainReview && (
                          <div
                            role="status"
                            data-testid="uncertain-fields-banner"
                            className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs font-medium flex items-start gap-2 leading-relaxed"
                          >
                            <AlertTriangle
                              className="w-4 h-4 text-amber-700 shrink-0 mt-0.5"
                              aria-hidden="true"
                            />
                            <span>
                              {!hasValidAmount
                                ? t(language, 'confirmBlockedAmountMsg')
                                : confidencePct !== null
                                  ? t(language, 'confirmLowConfidenceBanner', {
                                      pct: confidencePct,
                                    })
                                  : t(language, 'confirmModuleAmountPrompt')}
                            </span>
                          </div>
                        )}

                        {/* Inline Editable Fields */}
                        {showEditor && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-3 border-t border-slate-100">
                            {/* Type Selector */}
                            <div className="sm:col-span-2 space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-700">
                                  {t(language, 'voiceEntryTypeLabel')}
                                </span>
                                {uncertainSet.has('type') && (
                                  <span className="text-[11px] font-bold text-amber-800">
                                    {t(language, 'confirmFieldUncertain')}
                                  </span>
                                )}
                              </div>
                              <div
                                className={`grid grid-cols-2 sm:grid-cols-4 gap-2 p-1 rounded-xl ${
                                  uncertainSet.has('type')
                                    ? 'bg-amber-50/70 border border-amber-300'
                                    : ''
                                }`}
                              >
                                {typeOptions.map((opt) => (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => updateDraft(entry, { type: opt.id })}
                                    aria-pressed={draft.type === opt.id}
                                    className={`min-h-[42px] px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                                      draft.type === opt.id
                                        ? 'border-emerald-700 bg-emerald-50 text-emerald-950'
                                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Customer Name */}
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  htmlFor={`confirm-name-${entry.id}`}
                                  className="text-xs font-semibold text-slate-700"
                                >
                                  {t(language, 'voiceTitleLabel')}
                                </label>
                                {uncertainSet.has('customerName') && (
                                  <span className="text-[11px] font-bold text-amber-800">
                                    {t(language, 'confirmFieldUncertain')}
                                  </span>
                                )}
                              </div>
                              <input
                                id={`confirm-name-${entry.id}`}
                                type="text"
                                value={draft.customerName}
                                onChange={(e) => {
                                  updateDraft(entry, { customerName: e.target.value });
                                  if (errors.customerName) {
                                    setFieldErrors((prev) => ({
                                      ...prev,
                                      [entry.id]: {
                                        ...prev[entry.id],
                                        customerName: undefined,
                                      },
                                    }));
                                  }
                                }}
                                className={`w-full min-h-[46px] px-3.5 py-2 text-sm rounded-xl border bg-white text-slate-900 focus:outline-none focus:border-emerald-700 ${
                                  uncertainSet.has('customerName')
                                    ? 'border-amber-400 bg-amber-50/40'
                                    : 'border-slate-300'
                                }`}
                              />
                              {errors.customerName && (
                                <p role="alert" className="text-xs font-medium text-red-700">
                                  {errors.customerName}
                                </p>
                              )}
                            </div>

                            {/* Amount (₹) — Strictly Required > 0 */}
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  htmlFor={`pending-amount-${entry.id}`}
                                  className="text-xs font-semibold text-slate-700"
                                >
                                  {t(language, 'voiceAmountLabel')}
                                </label>
                                {uncertainSet.has('amount') && (
                                  <span className="text-[11px] font-bold text-amber-800">
                                    {t(language, 'confirmFieldUncertain')}
                                  </span>
                                )}
                              </div>
                              <div className="relative flex items-center">
                                <span className="absolute left-3.5 text-sm font-bold text-slate-500">
                                  ₹
                                </span>
                                <input
                                  id={`pending-amount-${entry.id}`}
                                  data-testid={`pending-amount-${entry.id}`}
                                  type="text"
                                  inputMode="decimal"
                                  value={draft.amountRupees}
                                  onChange={(e) => {
                                    updateDraft(entry, { amountRupees: e.target.value });
                                    if (errors.amount) {
                                      setFieldErrors((prev) => ({
                                        ...prev,
                                        [entry.id]: { ...prev[entry.id], amount: undefined },
                                      }));
                                    }
                                  }}
                                  placeholder={t(language, 'entryAmountPlaceholder')}
                                  className={`w-full min-h-[46px] pl-8 pr-3.5 py-2 text-base font-mono tabular-nums rounded-xl border bg-white text-slate-900 focus:outline-none focus:border-emerald-700 ${
                                    !hasValidAmount
                                      ? 'border-red-400 bg-red-50/30'
                                      : uncertainSet.has('amount')
                                        ? 'border-amber-400 bg-amber-50/40'
                                        : 'border-slate-300'
                                  }`}
                                />
                              </div>
                              {errors.amount && (
                                <p
                                  role="alert"
                                  data-testid={`block-alert-${entry.id}`}
                                  className="text-xs font-semibold text-red-700"
                                >
                                  {errors.amount}
                                </p>
                              )}
                            </div>

                            {/* Note */}
                            <div className="sm:col-span-2 space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  htmlFor={`confirm-note-${entry.id}`}
                                  className="text-xs font-semibold text-slate-700"
                                >
                                  {t(language, 'entryNoteLabel')}
                                </label>
                                {uncertainSet.has('note') && (
                                  <span className="text-[11px] font-bold text-amber-800">
                                    {t(language, 'confirmFieldUncertain')}
                                  </span>
                                )}
                              </div>
                              <input
                                id={`confirm-note-${entry.id}`}
                                type="text"
                                maxLength={140}
                                value={draft.note}
                                onChange={(e) => updateDraft(entry, { note: e.target.value })}
                                className={`w-full min-h-[44px] px-3.5 py-2 text-sm rounded-xl border bg-white text-slate-900 focus:outline-none focus:border-emerald-700 ${
                                  uncertainSet.has('note')
                                    ? 'border-amber-400 bg-amber-50/40'
                                    : 'border-slate-300'
                                }`}
                              />
                            </div>
                          </div>
                        )}

                        {/* Explicit Uncertain Fields Review Checkbox */}
                        {needsUncertainReview && (
                          <div className="space-y-1.5">
                            <label
                              htmlFor={`review-uncertain-${entry.id}`}
                              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                                isReviewed
                                  ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950'
                                  : 'bg-amber-50/50 border-amber-300 text-slate-900'
                              }`}
                            >
                              <input
                                id={`review-uncertain-${entry.id}`}
                                data-testid={`review-uncertain-${entry.id}`}
                                type="checkbox"
                                checked={isReviewed}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setReviewedUncertainMap((prev) => ({
                                    ...prev,
                                    [entry.id]: checked,
                                  }));
                                  if (checked && errors.uncertain) {
                                    setFieldErrors((prev) => ({
                                      ...prev,
                                      [entry.id]: { ...prev[entry.id], uncertain: undefined },
                                    }));
                                  }
                                }}
                                className="w-5 h-5 accent-emerald-700 rounded cursor-pointer shrink-0"
                              />
                              <span className="text-xs sm:text-sm font-semibold">
                                {t(language, 'confirmReviewUncertainCheckbox')}
                              </span>
                            </label>
                            {errors.uncertain && (
                              <p
                                role="alert"
                                data-testid={`uncertain-alert-${entry.id}`}
                                className="text-xs font-semibold text-amber-900"
                              >
                                {errors.uncertain}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Per-Entry Action Buttons: Confirm & Delete */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            data-testid={`confirm-btn-${entry.id}`}
                            disabled={finalizing}
                            onClick={() => void handleConfirmSingle(entry)}
                            className={`min-h-[48px] px-5 py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 ${
                              !hasValidAmount || (needsUncertainReview && !isReviewed)
                                ? 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                                : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                            }`}
                          >
                            <Check className="w-4 h-4" aria-hidden="true" />
                            <span>
                              {needsUncertainReview
                                ? t(language, 'confirmSaveAndConfirm')
                                : t(language, 'dashConfirmBtn')}
                            </span>
                          </button>

                          <button
                            type="button"
                            data-testid={`delete-btn-${entry.id}`}
                            disabled={finalizing}
                            onClick={() => void handleDeleteSingle(entry)}
                            className="min-h-[48px] px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-red-50 hover:text-red-700 hover:border-red-200 text-slate-700 font-semibold text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                            <span>{t(language, 'dashDiscardBtn')}</span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {/* Confirm All Warning Dialog */}
      {showConfirmAllDialog && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-all-dialog-title"
            aria-describedby="confirm-all-dialog-desc"
            data-testid="confirm-all-dialog"
            className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-xl"
          >
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-6 h-6" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h2
                  id="confirm-all-dialog-title"
                  className="text-lg font-bold text-slate-900 leading-snug"
                >
                  {t(language, 'confirmAllDialogTitle')}
                </h2>
                <p
                  id="confirm-all-dialog-desc"
                  className="text-sm text-slate-600 leading-relaxed"
                >
                  {t(language, 'confirmAllDialogDesc')}
                </p>
              </div>
            </div>

            {/* Eligible vs Blocked Breakdown */}
            <div className="space-y-2 text-sm">
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                <span>
                  {t(language, 'confirmAllEligibleCount', {
                    count: confirmAllPartition.eligible.length,
                  })}
                </span>
              </div>

              {confirmAllPartition.blockedMissingAmount.length > 0 && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-900 text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0" aria-hidden="true" />
                  <span>
                    {t(language, 'confirmAllBlockedAmountCount', {
                      count: confirmAllPartition.blockedMissingAmount.length,
                    })}
                  </span>
                </div>
              )}

              {confirmAllPartition.blockedUncertain.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle
                    className="w-4 h-4 text-amber-700 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    {t(language, 'confirmAllBlockedUncertainCount', {
                      count: confirmAllPartition.blockedUncertain.length,
                    })}
                  </span>
                </div>
              )}

              {confirmAllPartition.eligible.length === 0 && (
                <p className="text-xs text-slate-600 leading-relaxed pt-1">
                  {t(language, 'confirmAllNoneEligible')}
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowConfirmAllDialog(false)}
                className="min-h-[46px] px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm cursor-pointer"
              >
                {t(language, 'cancel')}
              </button>
              <button
                type="button"
                data-testid="confirm-all-proceed-btn"
                disabled={confirmAllPartition.eligible.length === 0 || finalizing}
                onClick={() => void handleConfirmAllProceed()}
                className="min-h-[46px] px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm cursor-pointer disabled:opacity-40"
              >
                {t(language, 'confirmAllProceedBtn', {
                  count: confirmAllPartition.eligible.length,
                })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 10-Second Undo Snackbar */}
      {activeUndo && (
        <div
          role="status"
          aria-live="polite"
          data-testid="confirm-undo-snackbar"
          className="fixed bottom-20 md:bottom-6 left-4 right-4 z-50 max-w-xl mx-auto bg-slate-900 text-white rounded-2xl shadow-xl border border-slate-700 overflow-hidden"
        >
          <div className="px-4 py-3.5 flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-semibold truncate">{activeUndo.label}</p>
              <p
                data-testid="confirm-undo-countdown"
                className="text-xs text-slate-300 font-mono tabular-nums"
              >
                {finalizing
                  ? t(language, 'confirmFinalizingHint')
                  : t(language, 'confirmUndoCountdown', { sec: remainingSeconds })}
              </p>
            </div>

            <button
              type="button"
              data-testid="confirm-undo-btn"
              onClick={handleUndoClick}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-sm inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              <span>{t(language, 'confirmUndoBtn')}</span>
            </button>
          </div>
          {/* Live 10s Progress Indicator */}
          <div className="h-1 bg-slate-800 w-full">
            <div
              className="h-full bg-emerald-400 transition-[width] duration-150 ease-linear"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
