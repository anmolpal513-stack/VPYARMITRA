import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Loader2,
  Mic,
  PencilLine,
  RotateCcw,
  Square,
  X,
} from 'lucide-react';
import { t, type AppLanguage, type TranslationKey } from '../../lib/i18n';
import {
  rupeesToPaise,
  type LedgerEntryRecord,
  type LedgerEntryType,
} from '../../lib/finance';
import {
  MAX_VOICE_RECORDING_SECONDS,
  VoiceExtractionSchema,
  mapVoiceExtractionToPendingEntry,
} from '../../lib/voiceExtraction';
import { sanitizeCustomerName, sanitizeNote } from '../../lib/validation';

type VoiceStep = 'idle' | 'recording' | 'processing' | 'manual_fallback';

const WAVEFORM_BAR_COUNT = 28;
const IDLE_WAVEFORM_LEVELS = Array.from({ length: WAVEFORM_BAR_COUNT }, (_, idx) => {
  const wave = Math.sin((idx / WAVEFORM_BAR_COUNT) * Math.PI);
  return Math.round(18 + wave * 24);
});

function formatTimerSeconds(totalSec: number): string {
  const clamped = Math.max(0, Math.min(MAX_VOICE_RECORDING_SECONDS, Math.floor(totalSec)));
  const mins = String(Math.floor(clamped / 60)).padStart(2, '0');
  const secs = String(clamped % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function pickSupportedRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read recorded audio'));
    reader.readAsDataURL(blob);
  });
}

interface VoiceEntryModalProps {
  language: AppLanguage;
  ownerUid: string;
  isOffline: boolean;
  onClose: () => void;
  onSavePendingEntry: (entry: LedgerEntryRecord) => Promise<void>;
  onRouteToConfirmation: () => void;
}

export function VoiceEntryModal({
  language,
  ownerUid,
  isOffline,
  onClose,
  onSavePendingEntry,
  onRouteToConfirmation,
}: VoiceEntryModalProps) {
  const [step, setStep] = useState<VoiceStep>(isOffline ? 'manual_fallback' : 'idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [waveformLevels, setWaveformLevels] = useState<number[]>(IDLE_WAVEFORM_LEVELS);
  const [fallbackReasonKey, setFallbackReasonKey] = useState<TranslationKey | null>(
    isOffline ? 'voiceFallbackOffline' : null
  );
  const [capturedTranscript, setCapturedTranscript] = useState('');

  // Manual-entry fallback state (always saves strictly as status="pending")
  const [entryType, setEntryType] = useState<LedgerEntryType>('sale');
  const [customerName, setCustomerName] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [note, setNote] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [savingManual, setSavingManual] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const abortedRef = useRef(false);

  const cleanupRecordingResources = useCallback(() => {
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {
        // ignore close failure
      });
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      abortedRef.current = true;
      cleanupRecordingResources();
    };
  }, [cleanupRecordingResources]);

  const openManualFallback = useCallback(
    (reasonKey: TranslationKey, transcript = '') => {
      setFallbackReasonKey(reasonKey);
      if (transcript) {
        setCapturedTranscript(transcript);
        setNote((prev) => prev || transcript.slice(0, 140));
      }
      setStep('manual_fallback');
    },
    []
  );

  const processRecordedBlob = useCallback(
    async (blob: Blob, mimeType: string) => {
      if (abortedRef.current) return;

      if (!navigator.onLine) {
        openManualFallback('voiceFallbackOffline');
        return;
      }

      setStep('processing');
      try {
        const audioBase64 = await blobToBase64(blob);
        const response = await fetch('/api/voice/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64,
            mimeType: mimeType || 'audio/webm',
            language,
          }),
        });

        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean;
          code?: string;
          transcript?: string;
          extraction?: unknown;
        } | null;

        if (abortedRef.current) return;

        if (!response.ok || !payload?.ok) {
          const code = payload?.code;
          const reasonKey: TranslationKey =
            code === 'EMPTY_TRANSCRIPT'
              ? 'voiceFallbackEmptySpeech'
              : code === 'INVALID_EXTRACTION'
                ? 'voiceFallbackExtractionFailed'
                : 'voiceFallbackServiceError';
          openManualFallback(reasonKey, payload?.transcript ?? '');
          return;
        }

        // Defense-in-depth: validate response with Zod on the client too
        const validated = VoiceExtractionSchema.safeParse(payload.extraction);
        if (!validated.success) {
          openManualFallback('voiceFallbackExtractionFailed', payload.transcript ?? '');
          return;
        }

        // Non-negotiable Rule 1, 2 & 4: deterministic integer paise + ALWAYS status="pending"
        const pendingEntry = mapVoiceExtractionToPendingEntry(
          validated.data,
          ownerUid,
          language,
          new Date().toISOString()
        );

        await onSavePendingEntry(pendingEntry);
        if (!abortedRef.current) {
          onClose();
          onRouteToConfirmation();
        }
      } catch {
        if (!abortedRef.current) {
          openManualFallback('voiceFallbackServiceError');
        }
      }
    },
    [language, ownerUid, onSavePendingEntry, onClose, onRouteToConfirmation, openManualFallback]
  );

  const stopRecording = useCallback(
    (discard = false) => {
      if (discard) {
        abortedRef.current = true;
      }
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          cleanupRecordingResources();
        }
      } else {
        cleanupRecordingResources();
      }
    },
    [cleanupRecordingResources]
  );

  const startRecording = async () => {
    if (isOffline || !navigator.onLine) {
      openManualFallback('voiceFallbackOffline');
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      openManualFallback('voiceFallbackUnsupported');
      return;
    }

    abortedRef.current = false;
    chunksRef.current = [];
    setElapsedSec(0);
    setFallbackReasonKey(null);
    setCapturedTranscript('');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      openManualFallback('voiceFallbackPermission');
      return;
    }

    streamRef.current = stream;

    // Live audio analyser for real-time waveform visualization
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.78;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        const tickWaveform = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(freqData);
          const nextLevels: number[] = [];
          for (let i = 0; i < WAVEFORM_BAR_COUNT; i += 1) {
            const bin = freqData[i % freqData.length] ?? 0;
            const normalized = Math.max(14, Math.min(100, Math.round((bin / 255) * 100)));
            nextLevels.push(normalized);
          }
          setWaveformLevels(nextLevels);
          rafRef.current = window.requestAnimationFrame(tickWaveform);
        };
        rafRef.current = window.requestAnimationFrame(tickWaveform);
      }
    } catch {
      // Waveform falls back to clean static bars if Web Audio API is restricted
    }

    const mimeType = pickSupportedRecorderMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch {
      cleanupRecordingResources();
      openManualFallback('voiceFallbackUnsupported');
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const recordedMime = recorder.mimeType || mimeType || 'audio/webm';
      const chunks = [...chunksRef.current];
      cleanupRecordingResources();

      if (abortedRef.current) {
        setStep('idle');
        return;
      }

      const blob = new Blob(chunks, { type: recordedMime });
      if (blob.size < 128) {
        openManualFallback('voiceFallbackEmptySpeech');
        return;
      }

      void processRecordedBlob(blob, recordedMime);
    };

    mediaRecorderRef.current = recorder;
    setStep('recording');
    recorder.start(250);

    const startedAt = Date.now();
    timerIntervalRef.current = window.setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      setElapsedSec(secs);
      if (secs >= MAX_VOICE_RECORDING_SECONDS) {
        stopRecording(false);
      }
    }, 250);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nameCheck = sanitizeCustomerName(customerName);
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

    setSavingManual(true);
    try {
      // NON-NEGOTIABLE RULE 2: Always save strictly as pending and route to Confirmation
      const pendingEntry: LedgerEntryRecord = {
        id: `entry_voice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ownerUid,
        customerName: nameCheck.sanitized,
        type: entryType,
        amountPaise: parsedPaise,
        note: sanitizeNote(note),
        source: 'voice',
        status: 'pending',
        occurredAtIso: new Date().toISOString(),
        transcript: capturedTranscript ? capturedTranscript.slice(0, 500) : undefined,
        uncertainFields: parsedPaise === null ? ['amount'] : undefined,
      };
      await onSavePendingEntry(pendingEntry);
      onClose();
      onRouteToConfirmation();
    } finally {
      setSavingManual(false);
    }
  };

  const typeOptions: Array<{ id: LedgerEntryType; label: string }> = [
    { id: 'sale', label: t(language, 'homeTypeSale') },
    { id: 'expense', label: t(language, 'homeTypeExpense') },
    { id: 'udhaar', label: t(language, 'dashTypeUdhaar') },
    { id: 'jama', label: t(language, 'dashTypeJama') },
  ];

  const progressPercent = Math.min(100, Math.round((elapsedSec / MAX_VOICE_RECORDING_SECONDS) * 100));

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-entry-modal-title"
      data-testid="voice-entry-modal"
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2
              id="voice-entry-modal-title"
              className="text-xl font-bold text-slate-900 flex items-center gap-2"
            >
              <Mic className="w-5 h-5 text-emerald-700" aria-hidden="true" />
              <span>{t(language, 'voiceModalTitle')}</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {t(language, 'voiceModalDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopRecording(true);
              onClose();
            }}
            aria-label={t(language, 'close')}
            className="min-h-[44px] min-w-[44px] rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* IDLE STATE */}
        {step === 'idle' && (
          <div className="space-y-5" data-testid="voice-step-idle">
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-6 flex flex-col items-center text-center gap-4">
              <button
                type="button"
                onClick={startRecording}
                data-testid="voice-start-record-btn"
                className="w-24 h-24 rounded-full bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white shadow-lg flex items-center justify-center transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
                aria-label={t(language, 'voiceTapToRecord')}
              >
                <Mic className="w-10 h-10" aria-hidden="true" />
              </button>

              <div className="space-y-1">
                <p className="text-lg font-bold text-slate-900">
                  {t(language, 'voiceTapToRecord')}
                </p>
                <p className="text-xs font-medium text-slate-500">
                  {t(language, 'voiceMaxDurationHint')}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t(language, 'voiceExampleHeading')}
              </p>
              <ul className="space-y-1.5 text-sm text-slate-700">
                <li className="px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-100">
                  {t(language, 'voiceExample1')}
                </li>
                <li className="px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-100">
                  {t(language, 'voiceExample2')}
                </li>
                <li className="px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-100">
                  {t(language, 'voiceExample3')}
                </li>
              </ul>
            </div>

            <div className="pt-1 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  setFallbackReasonKey(null);
                  setStep('manual_fallback');
                }}
                data-testid="voice-switch-manual-btn"
                className="min-h-[44px] px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <PencilLine className="w-4 h-4" aria-hidden="true" />
                <span>{t(language, 'voiceSwitchToManual')}</span>
              </button>
            </div>
          </div>
        )}

        {/* RECORDING STATE — Live Waveform + 30s Timer */}
        {step === 'recording' && (
          <div className="space-y-5" data-testid="voice-step-recording">
            <div className="rounded-2xl bg-slate-900 text-white p-5 sm:p-6 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-red-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                  <span>{t(language, 'voiceRecordingNow')}</span>
                </span>
                <span
                  data-testid="voice-timer"
                  className="text-lg font-bold font-mono tabular-nums text-white"
                >
                  {formatTimerSeconds(elapsedSec)} / 00:30
                </span>
              </div>

              {/* Real-time Audio Waveform Visualizer */}
              <div
                aria-hidden="true"
                data-testid="voice-waveform"
                className="h-20 flex items-center justify-between gap-1 px-1"
              >
                {waveformLevels.map((level, idx) => (
                  <div
                    key={idx}
                    className="flex-1 rounded-full bg-emerald-400 transition-all duration-75"
                    style={{ height: `${level}%` }}
                  />
                ))}
              </div>

              {/* 30-second countdown progress track */}
              <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 transition-all duration-200"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => stopRecording(true)}
                className="w-1/3 min-h-[54px] px-4 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm cursor-pointer"
              >
                {t(language, 'cancel')}
              </button>
              <button
                type="button"
                onClick={() => stopRecording(false)}
                data-testid="voice-stop-record-btn"
                className="flex-1 min-h-[54px] px-5 py-3 rounded-xl bg-red-700 hover:bg-red-800 text-white font-semibold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Square className="w-4 h-4 fill-current" aria-hidden="true" />
                <span>{t(language, 'voiceStopAndExtract')}</span>
              </button>
            </div>
          </div>
        )}

        {/* PROCESSING STATE */}
        {step === 'processing' && (
          <div
            className="rounded-2xl bg-slate-50 border border-slate-200 p-8 text-center space-y-4"
            aria-busy="true"
            data-testid="voice-step-processing"
          >
            <Loader2
              className="w-10 h-10 text-emerald-700 animate-spin mx-auto"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <p className="text-base font-bold text-slate-900">
                {t(language, 'voiceProcessingTitle')}
              </p>
              <p className="text-sm text-slate-600 leading-relaxed">
                {t(language, 'voiceProcessingDesc')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                abortedRef.current = true;
                openManualFallback('voiceFallbackServiceError');
              }}
              className="min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              {t(language, 'voiceSwitchToManual')}
            </button>
          </div>
        )}

        {/* MANUAL-ENTRY FALLBACK STATE (Always saves as pending & routes to Confirmation) */}
        {step === 'manual_fallback' && (
          <div className="space-y-4" data-testid="voice-step-manual-fallback">
            {fallbackReasonKey && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 flex items-start gap-2.5 text-xs sm:text-sm leading-relaxed"
              >
                <AlertTriangle
                  className="w-4 h-4 text-amber-700 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div className="space-y-1.5 flex-1">
                  <p className="font-medium">{t(language, fallbackReasonKey)}</p>
                  {capturedTranscript && (
                    <p className="text-xs text-amber-900">
                      <span className="font-semibold">
                        {t(language, 'voiceCapturedTranscript')}{' '}
                      </span>
                      “{capturedTranscript}”
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900">
                {t(language, 'voiceFallbackHeading')}
              </h3>
              {!isOffline && (
                <button
                  type="button"
                  onClick={() => {
                    setFallbackReasonKey(null);
                    setStep('idle');
                  }}
                  className="min-h-[38px] px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t(language, 'voiceRetryMic')}</span>
                </button>
              )}
            </div>

            <form onSubmit={handleManualSubmit} noValidate className="space-y-4">
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
                  htmlFor="voice-manual-title"
                  className="block text-sm font-semibold text-slate-900"
                >
                  {t(language, 'voiceTitleLabel')} *
                </label>
                <input
                  id="voice-manual-title"
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => {
                    setCustomerName(e.target.value);
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
                  htmlFor="voice-manual-amount"
                  className="block text-sm font-semibold text-slate-900"
                >
                  {t(language, 'voiceAmountLabel')}{' '}
                  {entryType === 'expense' ? `(${t(language, 'optional')})` : '*'}
                </label>
                <div className="relative flex items-center">
                  <span className="absolute left-4 text-base font-bold text-slate-500">₹</span>
                  <input
                    id="voice-manual-amount"
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
                {amountError && (
                  <p role="alert" className="text-xs font-medium text-red-700">
                    {amountError}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="voice-manual-note"
                  className="block text-sm font-semibold text-slate-900"
                >
                  {t(language, 'voiceTranscriptLabel')} ({t(language, 'optional')})
                </label>
                <input
                  id="voice-manual-note"
                  type="text"
                  maxLength={140}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
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
                  disabled={savingManual}
                  data-testid="voice-manual-save-pending-btn"
                  className="flex-1 min-h-[50px] px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-semibold text-sm sm:text-base transition-colors cursor-pointer disabled:opacity-60"
                >
                  {savingManual ? t(language, 'saving') : t(language, 'voiceSavePendingBtn')}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
