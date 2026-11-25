import React, { useState, useRef, useEffect } from 'react';
import { Camera, Check, Mic, MicOff, Upload, X } from 'lucide-react';
import { t, type AppLanguage } from '../../lib/i18n';
import {
  rupeesToPaise,
  type LedgerEntryRecord,
  type LedgerEntryType,
} from '../../lib/finance';
import { sanitizeCustomerName, sanitizeNote } from '../../lib/validation';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Deterministic helper to pre-fill amount & type suggestions from spoken/typed text.
 * Final entry ALWAYS saves strictly as status="pending" for explicit confirmation.
 */
function parseDraftFromTranscript(text: string): {
  suggestedType?: LedgerEntryType;
  suggestedAmount?: string;
} {
  const lower = text.toLowerCase();
  const amountMatch = text.match(/(\d+(?:\.\d{1,2})?)/);
  const suggestedAmount = amountMatch ? amountMatch[1] : undefined;

  if (/(खर्च|expense|bill|supplier|सप्लायर|रसीद|paid)/.test(lower)) {
    return { suggestedType: 'expense', suggestedAmount };
  }
  if (/(उधार|udhaar|credit)/.test(lower)) {
    return { suggestedType: 'udhaar', suggestedAmount };
  }
  if (/(जमा|jama|received)/.test(lower)) {
    return { suggestedType: 'jama', suggestedAmount };
  }
  if (/(बिक्री|sale|bikri|cash|upi)/.test(lower)) {
    return { suggestedType: 'sale', suggestedAmount };
  }
  return { suggestedAmount };
}

interface CaptureModalProps {
  language: AppLanguage;
  ownerUid: string;
  mode: 'voice' | 'camera';
  onClose: () => void;
  onSavePendingEntry: (entry: LedgerEntryRecord) => Promise<void>;
}

export function CaptureModal({
  language,
  ownerUid,
  mode,
  onClose,
  onSavePendingEntry,
}: CaptureModalProps) {
  const [entryType, setEntryType] = useState<LedgerEntryType>(
    mode === 'camera' ? 'expense' : 'sale'
  );
  const [title, setTitle] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [note, setNote] = useState('');
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const [titleError, setTitleError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechSupported = Boolean(getSpeechRecognitionCtor());

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore stop errors
      }
    };
  }, []);

  const handleToggleMic = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new Ctor();
    recognition.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? '';
      if (transcript) {
        setNote(transcript);
        const parsed = parseDraftFromTranscript(transcript);
        if (parsed.suggestedType) setEntryType(parsed.suggestedType);
        if (parsed.suggestedAmount && !amountRupees) {
          setAmountRupees(parsed.suggestedAmount);
        }
        if (!title) {
          setTitle(transcript.slice(0, 48));
        }
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    setIsListening(true);
    try {
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoName(file.name);
    if (!title) {
      setTitle(
        language === 'hi' ? 'कैमरा बिल रसीद' : 'Camera Bill Receipt'
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nameCheck = sanitizeCustomerName(title);
    setTitleError(nameCheck.valid ? null : t(language, nameCheck.errorKey!));

    const trimmedAmt = amountRupees.trim();
    let parsedPaise: number | null = null;

    if (trimmedAmt.length === 0) {
      if (entryType === 'expense') {
        parsedPaise = null;
        setAmountError(null);
      } else {
        setAmountError(t(language, 'errAmountInvalid'));
        return;
      }
    } else {
      parsedPaise = rupeesToPaise(trimmedAmt);
      if (parsedPaise === null) {
        setAmountError(t(language, 'errAmountInvalid'));
        return;
      }
      setAmountError(null);
    }

    if (!nameCheck.valid) return;

    setSaving(true);
    try {
      const noteText = photoName
        ? `${note ? `${note} — ` : ''}${photoName}`
        : note;

      // NON-NEGOTIABLE RULE 2: Voice/Camera entries are ALWAYS saved with status="pending"
      const pendingEntry: LedgerEntryRecord = {
        id: `entry_${mode}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ownerUid,
        customerName: nameCheck.sanitized,
        type: entryType,
        amountPaise: parsedPaise,
        note: sanitizeNote(noteText),
        source: mode,
        status: 'pending',
        occurredAtIso: new Date().toISOString(),
      };
      await onSavePendingEntry(pendingEntry);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const typeOptions: Array<{ id: LedgerEntryType; label: string }> = [
    { id: 'sale', label: t(language, 'homeTypeSale') },
    { id: 'expense', label: t(language, 'homeTypeExpense') },
    { id: 'udhaar', label: t(language, 'dashTypeUdhaar') },
    { id: 'jama', label: t(language, 'dashTypeJama') },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="capture-modal-title"
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 id="capture-modal-title" className="text-xl font-bold text-slate-900 flex items-center gap-2">
              {mode === 'voice' ? (
                <Mic className="w-5 h-5 text-emerald-700" aria-hidden="true" />
              ) : (
                <Camera className="w-5 h-5 text-slate-800" aria-hidden="true" />
              )}
              <span>
                {mode === 'voice'
                  ? t(language, 'voiceModalTitle')
                  : t(language, 'cameraModalTitle')}
              </span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {mode === 'voice'
                ? t(language, 'voiceModalDesc')
                : t(language, 'cameraModalDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(language, 'close')}
            className="min-h-[44px] min-w-[44px] rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Mode-specific trigger */}
        {mode === 'voice' ? (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
            {speechSupported ? (
              <button
                type="button"
                onClick={handleToggleMic}
                className={`w-full min-h-[52px] px-4 py-3 rounded-xl font-semibold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                  isListening
                    ? 'bg-red-700 hover:bg-red-800 text-white'
                    : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                }`}
              >
                {isListening ? (
                  <>
                    <MicOff className="w-5 h-5" aria-hidden="true" />
                    <span>{t(language, 'voiceStopListening')}</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-5 h-5" aria-hidden="true" />
                    <span>{t(language, 'voiceStartListening')}</span>
                  </>
                )}
              </button>
            ) : (
              <p className="text-xs text-slate-600 leading-relaxed">
                {t(language, 'voiceUnsupportedHint')}
              </p>
            )}
            {isListening && (
              <p role="status" className="text-xs font-semibold text-emerald-800 text-center">
                {t(language, 'voiceListeningNow')}
              </p>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-slate-50 border border-dashed border-slate-300 space-y-2">
            <label
              htmlFor="camera-bill-upload"
              className="w-full min-h-[52px] px-4 py-3 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-900 font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <Upload className="w-4 h-4 text-slate-700" aria-hidden="true" />
              <span>{t(language, 'cameraUploadLabel')}</span>
            </label>
            <input
              id="camera-bill-upload"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoChange}
              className="sr-only"
            />
            {photoName && (
              <p className="text-xs font-semibold text-emerald-800">
                {t(language, 'cameraPhotoSelected', { name: photoName })}
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Entry Type Segmented Buttons */}
          <div className="space-y-1.5">
            <span className="block text-sm font-semibold text-slate-900">
              {t(language, 'voiceEntryTypeLabel')}
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {typeOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setEntryType(opt.id);
                    setAmountError(null);
                  }}
                  aria-pressed={entryType === opt.id}
                  className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                    entryType === opt.id
                      ? 'border-emerald-700 bg-emerald-50 text-emerald-950'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="capture-title-input"
              className="block text-sm font-semibold text-slate-900"
            >
              {t(language, 'voiceTitleLabel')} *
            </label>
            <input
              id="capture-title-input"
              type="text"
              required
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(null);
              }}
              placeholder={t(language, 'voiceTitlePlaceholder')}
              className="w-full min-h-[48px] px-4 py-2.5 text-base rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-700"
            />
            {titleError && (
              <p role="alert" className="text-xs font-medium text-red-700">
                {titleError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="capture-amount-input"
              className="block text-sm font-semibold text-slate-900"
            >
              {t(language, 'voiceAmountLabel')}{' '}
              {entryType === 'expense' ? `(${t(language, 'optional')})` : '*'}
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-4 text-base font-bold text-slate-500">₹</span>
              <input
                id="capture-amount-input"
                type="text"
                inputMode="decimal"
                value={amountRupees}
                onChange={(e) => {
                  setAmountRupees(e.target.value);
                  if (amountError) setAmountError(null);
                }}
                placeholder={t(language, 'entryAmountPlaceholder')}
                className="w-full min-h-[48px] pl-10 pr-4 py-2.5 text-base font-mono tabular-nums rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-700"
              />
            </div>
            {amountError ? (
              <p role="alert" className="text-xs font-medium text-red-700">
                {amountError}
              </p>
            ) : (
              entryType === 'expense' && (
                <p className="text-xs text-slate-500">
                  {t(language, 'cameraLeaveAmountEmptyHint')}
                </p>
              )
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="capture-note-input"
              className="block text-sm font-semibold text-slate-900"
            >
              {t(language, 'voiceTranscriptLabel')} ({t(language, 'optional')})
            </label>
            <input
              id="capture-note-input"
              type="text"
              maxLength={140}
              value={note}
              onChange={(e) => {
                const val = e.target.value;
                setNote(val);
                if (mode === 'voice' && !amountRupees) {
                  const parsed = parseDraftFromTranscript(val);
                  if (parsed.suggestedAmount) setAmountRupees(parsed.suggestedAmount);
                }
              }}
              placeholder={t(language, 'voiceTranscriptPlaceholder')}
              className="w-full min-h-[46px] px-4 py-2 text-sm rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-700"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="w-1/3 min-h-[50px] px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm cursor-pointer"
            >
              {t(language, 'cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 min-h-[50px] px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-semibold text-sm sm:text-base transition-colors cursor-pointer disabled:opacity-60"
            >
              {saving ? t(language, 'saving') : t(language, 'voiceSavePendingBtn')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface MissingAmountModalProps {
  language: AppLanguage;
  missingExpenses: LedgerEntryRecord[];
  onFillExpenseAmount: (entryId: string, amountPaise: number) => Promise<void>;
  onClose: () => void;
}

export function MissingAmountModal({
  language,
  missingExpenses,
  onFillExpenseAmount,
  onClose,
}: MissingAmountModalProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const handleSaveAmount = async (entryId: string) => {
    const parsed = rupeesToPaise(drafts[entryId] ?? '');
    if (parsed === null) {
      setErrors((prev) => ({ ...prev, [entryId]: t(language, 'errAmountInvalid') }));
      return;
    }
    setSavingId(entryId);
    try {
      await onFillExpenseAmount(entryId, parsed);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="missing-amount-modal-title"
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 id="missing-amount-modal-title" className="text-xl font-bold text-slate-900">
              {t(language, 'homeMissingModalTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {t(language, 'homeMissingModalDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(language, 'close')}
            className="min-h-[44px] min-w-[44px] rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {missingExpenses.length === 0 ? (
          <p className="text-sm font-semibold text-emerald-800 py-4 text-center">
            {t(language, 'homeMissingModalEmpty')}
          </p>
        ) : (
          <ul className="space-y-3">
            {missingExpenses.map((entry) => (
              <li
                key={entry.id}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3"
              >
                <div className="space-y-0.5">
                  <div className="font-bold text-slate-900 text-base">
                    {entry.customerName}
                  </div>
                  {entry.note && (
                    <div className="text-xs text-slate-600">{entry.note}</div>
                  )}
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1 flex items-center">
                    <span className="absolute left-3.5 text-sm font-bold text-slate-500">
                      ₹
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`${entry.customerName} — ${t(language, 'voiceAmountLabel')}`}
                      value={drafts[entry.id] ?? ''}
                      onChange={(e) => {
                        setDrafts((prev) => ({ ...prev, [entry.id]: e.target.value }));
                        if (errors[entry.id]) {
                          setErrors((prev) => ({ ...prev, [entry.id]: '' }));
                        }
                      }}
                      placeholder={t(language, 'entryAmountPlaceholder')}
                      className="w-full min-h-[46px] pl-8 pr-3 py-2 text-base font-mono tabular-nums rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-700"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={savingId === entry.id}
                    onClick={() => handleSaveAmount(entry.id)}
                    className="min-h-[46px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" aria-hidden="true" />
                    <span>{t(language, 'save')}</span>
                  </button>
                </div>

                {errors[entry.id] && (
                  <p role="alert" className="text-xs font-medium text-red-700">
                    {errors[entry.id]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
