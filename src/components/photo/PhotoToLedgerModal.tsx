import React, { useState, useRef, useEffect } from 'react';
import {
  AlertTriangle,
  Camera,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { t, type AppLanguage, type TranslationKey } from '../../lib/i18n';
import { rupeesToPaise, type LedgerEntryRecord } from '../../lib/finance';
import {
  compressRegisterPhoto,
  formatFileSizeKb,
  type CompressedPhotoResult,
} from '../../lib/imageCompression';
import {
  PhotoExtractionSchema,
  enforcePhotoRowUncertainty,
  isPhotoRetakeRequired,
  isSafeSourceImageUrl,
  mapPhotoRowToPendingEntry,
  type PhotoImageQuality,
  type PhotoLedgerRow,
  type PhotoRowType,
  type PhotoUncertainField,
} from '../../lib/photoExtraction';
import { uploadRegisterPhotoToStorage } from '../../lib/firebase';

type PhotoStep = 'capture' | 'processing' | 'retake_required' | 'review_table' | 'error';

interface EditablePhotoRow {
  localId: string;
  date: string;
  customerName: string;
  item: string;
  amountText: string;
  type: PhotoRowType | '';
  confidence: number;
  uncertainFields: PhotoUncertainField[];
}

function toEditableRows(rows: PhotoLedgerRow[]): EditablePhotoRow[] {
  return rows.map((row, idx) => {
    const audited = enforcePhotoRowUncertainty(row);
    return {
      localId: `prow_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
      date: audited.date ?? '',
      customerName: audited.customerName ?? '',
      item: audited.item ?? '',
      amountText: audited.amount !== null ? String(audited.amount) : '',
      type: audited.type ?? '',
      confidence: audited.confidence,
      uncertainFields: audited.uncertainFields,
    };
  });
}

function createBlankEditableRow(): EditablePhotoRow {
  const todayIso = new Date().toISOString().slice(0, 10);
  return {
    localId: `prow_manual_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    date: todayIso,
    customerName: '',
    item: '',
    amountText: '',
    type: 'udhaar_given',
    confidence: 1,
    uncertainFields: ['customerName', 'amount'],
  };
}

interface PhotoToLedgerModalProps {
  language: AppLanguage;
  ownerUid: string;
  isSignedIn: boolean;
  isOffline: boolean;
  onClose: () => void;
  onSavePendingEntries: (entries: LedgerEntryRecord[]) => Promise<void>;
  onRouteToConfirmation: () => void;
}

export function PhotoToLedgerModal({
  language,
  ownerUid,
  isSignedIn,
  isOffline,
  onClose,
  onSavePendingEntries,
  onRouteToConfirmation,
}: PhotoToLedgerModalProps) {
  const [step, setStep] = useState<PhotoStep>('capture');
  const [statusKey, setStatusKey] = useState<TranslationKey>('photoCompressingStatus');
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [compressedPhoto, setCompressedPhoto] = useState<CompressedPhotoResult | null>(null);
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null);
  const [imageQuality, setImageQuality] = useState<PhotoImageQuality>('good');
  const [rows, setRows] = useState<EditablePhotoRow[]>([]);
  const [tableError, setTableError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const previewUrlRef = useRef<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const resetForRetake = () => {
    setErrorKey(null);
    setTableError(null);
    setRows([]);
    setSourceImageUrl(null);
    setStep('capture');
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  };

  const runVisionExtraction = async (photo: CompressedPhotoResult) => {
    setErrorKey(null);
    setTableError(null);
    setStep('processing');

    // Step 2: Upload compressed JPEG to Firebase Storage (when signed in & online)
    let uploadedUrl: string | null = sourceImageUrl;
    if (isSignedIn && !isOffline && navigator.onLine && !uploadedUrl) {
      setStatusKey('photoUploadingStatus');
      try {
        uploadedUrl = await uploadRegisterPhotoToStorage(ownerUid, photo.blob);
        setSourceImageUrl(uploadedUrl);
      } catch {
        // Non-blocking: continue extraction even if Storage bucket rules aren't enabled yet
      }
    }

    if (isOffline || !navigator.onLine) {
      setErrorKey('photoOfflineHint');
      setStep('error');
      return;
    }

    // Step 3: Send compressed image to server-side Gemini Vision route
    setStatusKey('photoExtractingStatus');
    try {
      const response = await fetch('/api/photo/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: photo.base64,
          mimeType: photo.mimeType,
          language,
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        extraction?: unknown;
        retakeRequired?: boolean;
      } | null;

      if (!response.ok || !payload?.ok) {
        setErrorKey('photoErrService');
        setStep('error');
        return;
      }

      const validated = PhotoExtractionSchema.safeParse(payload.extraction);
      if (!validated.success) {
        setErrorKey('photoErrService');
        setStep('error');
        return;
      }

      const extracted = validated.data;
      setImageQuality(extracted.imageQuality);

      if (payload.retakeRequired || isPhotoRetakeRequired(extracted)) {
        setRows([]);
        setStep('retake_required');
        return;
      }

      setRows(toEditableRows(extracted.rows));
      setStep('review_table');
    } catch {
      setErrorKey('photoErrService');
      setStep('error');
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorKey(null);
    setTableError(null);
    setStep('processing');
    setStatusKey('photoCompressingStatus');

    try {
      const compressed = await compressRegisterPhoto(file);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      previewUrlRef.current = compressed.previewObjectUrl;
      setCompressedPhoto(compressed);
      setSourceImageUrl(null);
      await runVisionExtraction(compressed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'IMAGE_TOO_LARGE') {
        setErrorKey('photoErrTooLarge');
      } else if (msg === 'IMAGE_UNSUPPORTED_TYPE') {
        setErrorKey('photoErrUnsupported');
      } else {
        setErrorKey('photoErrService');
      }
      setStep('error');
    }
  };

  const updateRowField = (
    localId: string,
    field: 'date' | 'customerName' | 'item' | 'amountText' | 'type',
    value: string
  ) => {
    setTableError(null);
    setRows((prev) =>
      prev.map((row) => {
        if (row.localId !== localId) return row;

        const nextRow: EditablePhotoRow = {
          ...row,
          [field]: value,
        };

        const uncertainKey: PhotoUncertainField =
          field === 'amountText' ? 'amount' : field;
        const trimmed = value.trim();
        let nextUncertain = row.uncertainFields.filter((f) => f !== uncertainKey);

        if (field === 'amountText') {
          if (trimmed.length === 0 || rupeesToPaise(trimmed) === null) {
            nextUncertain = [...nextUncertain, 'amount'];
          }
        } else if (trimmed.length === 0) {
          nextUncertain = [...nextUncertain, uncertainKey];
        }

        return {
          ...nextRow,
          uncertainFields: nextUncertain,
        };
      })
    );
  };

  const handleDeleteRow = (localId: string) => {
    setTableError(null);
    setRows((prev) => prev.filter((r) => r.localId !== localId));
  };

  const handleAddRow = () => {
    setTableError(null);
    setRows((prev) => [...prev, createBlankEditableRow()]);
  };

  const handleSaveAllPending = async () => {
    if (rows.length === 0) {
      setTableError(t(language, 'photoNoRowsWarning'));
      return;
    }

    const pendingEntries: LedgerEntryRecord[] = [];
    const fallbackIso = new Date().toISOString();

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const trimmedAmt = row.amountText.trim();
      const rowType: PhotoRowType = row.type || 'udhaar_given';

      let amountRupees: number | null = null;
      if (trimmedAmt.length === 0) {
        if (rowType === 'expense') {
          amountRupees = null;
        } else {
          setTableError(t(language, 'photoErrInvalidRowAmount'));
          return;
        }
      } else {
        const paise = rupeesToPaise(trimmedAmt);
        if (paise === null) {
          setTableError(t(language, 'photoErrInvalidRowAmount'));
          return;
        }
        amountRupees = paise / 100;
      }

      const photoRow: PhotoLedgerRow = {
        date: row.date.trim() || null,
        customerName: row.customerName.trim() || null,
        item: row.item.trim() || null,
        amount: amountRupees,
        type: row.type || null,
        confidence: row.confidence,
        uncertainFields: row.uncertainFields,
      };

      pendingEntries.push(
        mapPhotoRowToPendingEntry(photoRow, ownerUid, language, {
          sourceImageUrl: isSafeSourceImageUrl(sourceImageUrl) ? sourceImageUrl! : undefined,
          fallbackOccurredAtIso: fallbackIso,
          rowIndex: i,
        })
      );
    }

    setSaving(true);
    try {
      await onSavePendingEntries(pendingEntries);
      onClose();
      onRouteToConfirmation();
    } finally {
      setSaving(false);
    }
  };

  const totalUncertainCells = rows.reduce(
    (sum, r) => sum + r.uncertainFields.length,
    0
  );

  const qualityText = (q: PhotoImageQuality): string => {
    if (q === 'good') return t(language, 'photoQualityGood');
    if (q === 'fair') return t(language, 'photoQualityFair');
    if (q === 'blurry') return t(language, 'photoQualityBlurry');
    return t(language, 'photoQualityUnreadable');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-ledger-modal-title"
      data-testid="photo-ledger-modal"
    >
      <div className="w-full sm:max-w-4xl bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2
              id="photo-ledger-modal-title"
              className="text-xl font-bold text-slate-900 flex items-center gap-2"
            >
              <Camera className="w-5 h-5 text-emerald-700" aria-hidden="true" />
              <span>{t(language, 'cameraModalTitle')}</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {t(language, 'cameraModalDesc')}
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

        {/* Hidden file inputs for camera & gallery */}
        <input
          ref={cameraInputRef}
          id="photo-capture-camera-input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelected}
          className="sr-only"
        />
        <input
          ref={galleryInputRef}
          id="photo-capture-gallery-input"
          type="file"
          accept="image/*"
          onChange={handleFileSelected}
          className="sr-only"
        />

        {/* STEP 1: CAPTURE OR GALLERY UPLOAD */}
        {step === 'capture' && (
          <div className="space-y-5" data-testid="photo-step-capture">
            {isOffline && (
              <div
                role="status"
                className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs sm:text-sm flex items-start gap-2.5"
              >
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{t(language, 'photoOfflineHint')}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                data-testid="photo-camera-btn"
                className="min-h-[120px] p-5 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white flex flex-col items-center justify-center gap-2.5 shadow-sm transition-colors cursor-pointer"
              >
                <Camera className="w-9 h-9" aria-hidden="true" />
                <span className="text-base font-bold">{t(language, 'photoTakeCameraBtn')}</span>
              </button>

              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                data-testid="photo-gallery-btn"
                className="min-h-[120px] p-5 rounded-2xl border-2 border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-900 flex flex-col items-center justify-center gap-2.5 transition-colors cursor-pointer"
              >
                <ImageIcon className="w-9 h-9 text-slate-700" aria-hidden="true" />
                <span className="text-base font-bold">{t(language, 'photoChooseGalleryBtn')}</span>
              </button>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t(language, 'photoTipsHeading')}
              </p>
              <ul className="space-y-1 text-xs sm:text-sm text-slate-700 list-disc pl-5">
                <li>{t(language, 'photoTip1')}</li>
                <li>{t(language, 'photoTip2')}</li>
                <li>{t(language, 'photoTip3')}</li>
              </ul>
            </div>

            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => {
                  setImageQuality('fair');
                  setRows([createBlankEditableRow()]);
                  setStep('review_table');
                }}
                data-testid="photo-open-manual-table-btn"
                className="min-h-[44px] px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                {t(language, 'photoManualTableBtn')}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: COMPRESSING / UPLOADING / VISION EXTRACTING */}
        {step === 'processing' && (
          <div
            className="rounded-2xl bg-slate-50 border border-slate-200 p-6 sm:p-8 text-center space-y-4"
            aria-busy="true"
            data-testid="photo-step-processing"
          >
            {compressedPhoto && (
              <div className="space-y-2">
                <img
                  src={compressedPhoto.previewObjectUrl}
                  alt={t(language, 'cameraModalTitle')}
                  className="max-h-44 mx-auto rounded-xl border border-slate-200 object-contain bg-white"
                />
                <p className="text-xs font-mono text-slate-500">
                  {t(language, 'photoCompressedMeta', {
                    before: formatFileSizeKb(compressedPhoto.originalBytes),
                    after: formatFileSizeKb(compressedPhoto.compressedBytes),
                  })}
                </p>
              </div>
            )}

            <Loader2
              className="w-9 h-9 text-emerald-700 animate-spin mx-auto"
              aria-hidden="true"
            />
            <p className="text-base font-bold text-slate-900">{t(language, statusKey)}</p>
          </div>
        )}

        {/* STEP 3: BLURRY / UNREADABLE RETAKE PROMPT */}
        {step === 'retake_required' && (
          <div
            className="rounded-2xl bg-amber-50 border border-amber-300 p-5 sm:p-6 space-y-5"
            role="alert"
            data-testid="photo-step-retake"
          >
            <div className="flex flex-col sm:flex-row items-center gap-4">
              {compressedPhoto && (
                <img
                  src={compressedPhoto.previewObjectUrl}
                  alt={t(language, 'photoRetakeTitle')}
                  className="w-28 h-28 rounded-xl border border-amber-300 object-cover shrink-0 bg-white"
                />
              )}
              <div className="space-y-1.5 text-center sm:text-left">
                <div className="inline-flex items-center gap-1.5 text-amber-900 font-bold text-base">
                  <AlertTriangle className="w-5 h-5 text-amber-700" aria-hidden="true" />
                  <span>{t(language, 'photoRetakeTitle')}</span>
                </div>
                <p className="text-sm text-amber-950 leading-relaxed">
                  {t(language, 'photoRetakeDesc')}
                </p>
                <p className="text-xs font-semibold text-amber-800">
                  {t(language, 'photoQualityLabel', { quality: qualityText(imageQuality) })}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={resetForRetake}
                data-testid="photo-retake-btn"
                className="flex-1 min-h-[50px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                <span>{t(language, 'photoRetakeBtn')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRows([createBlankEditableRow()]);
                  setStep('review_table');
                }}
                className="min-h-[50px] px-4 py-2.5 rounded-xl border border-amber-400 bg-white hover:bg-amber-100 text-amber-950 font-semibold text-sm cursor-pointer"
              >
                {t(language, 'photoManualTableBtn')}
              </button>
            </div>
          </div>
        )}

        {/* ERROR STATE */}
        {step === 'error' && (
          <div
            className="rounded-2xl bg-red-50 border border-red-200 p-5 sm:p-6 space-y-4"
            role="alert"
            data-testid="photo-step-error"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm font-medium text-red-900 leading-relaxed">
                {errorKey ? t(language, errorKey) : t(language, 'photoErrService')}
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5">
              {compressedPhoto && !isOffline && (
                <button
                  type="button"
                  onClick={() => void runVisionExtraction(compressedPhoto)}
                  className="min-h-[46px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                  <span>{t(language, 'photoRetryScanBtn')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={resetForRetake}
                className="min-h-[46px] px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                <span>{t(language, 'photoRetakeBtn')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRows([createBlankEditableRow()]);
                  setStep('review_table');
                }}
                className="min-h-[46px] px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-semibold cursor-pointer"
              >
                {t(language, 'photoManualTableBtn')}
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: EDITABLE TABLE REVIEW WITH YELLOW UNCERTAIN CELLS */}
        {step === 'review_table' && (
          <div className="space-y-4" data-testid="photo-step-review-table">
            {/* Source Photo Meta Strip */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {compressedPhoto && (
                  <img
                    src={compressedPhoto.previewObjectUrl}
                    alt={t(language, 'cameraModalTitle')}
                    className="w-12 h-12 rounded-lg border border-slate-200 object-cover shrink-0 bg-white"
                  />
                )}
                <div className="space-y-0.5 text-xs">
                  <div className="font-semibold text-slate-900">
                    {t(language, 'photoQualityLabel', { quality: qualityText(imageQuality) })}
                  </div>
                  {compressedPhoto && (
                    <div className="text-slate-500 font-mono">
                      {t(language, 'photoCompressedMeta', {
                        before: formatFileSizeKb(compressedPhoto.originalBytes),
                        after: formatFileSizeKb(compressedPhoto.compressedBytes),
                      })}
                    </div>
                  )}
                  {isSafeSourceImageUrl(sourceImageUrl) ? (
                    <a
                      href={sourceImageUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
                    >
                      <span>{t(language, 'photoStorageSaved')}</span>
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  ) : (
                    compressedPhoto && (
                      <div className="text-slate-500">
                        {t(language, 'photoStorageLocalFallback')}
                      </div>
                    )
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={resetForRetake}
                className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t(language, 'photoRetakeBtn')}</span>
              </button>
            </div>

            {/* Yellow Uncertain Cells Alert */}
            {totalUncertainCells > 0 && (
              <div
                role="status"
                data-testid="photo-uncertain-summary"
                className="p-3 rounded-xl bg-amber-100/80 border border-amber-300 text-amber-950 text-xs sm:text-sm font-medium flex items-start gap-2"
              >
                <AlertTriangle
                  className="w-4 h-4 text-amber-800 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <span>
                  {t(language, 'photoUncertainSummary', { count: totalUncertainCells })}
                </span>
              </div>
            )}

            {/* Editable Table */}
            {rows.length === 0 ? (
              <div className="p-6 rounded-xl border border-slate-200 text-center space-y-3">
                <p className="text-sm text-slate-600">{t(language, 'photoNoRowsWarning')}</p>
                <button
                  type="button"
                  onClick={handleAddRow}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>{t(language, 'photoAddRowBtn')}</span>
                </button>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table
                  className="w-full min-w-[700px] border-collapse text-left"
                  data-testid="photo-ledger-table"
                >
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                      <th className="py-2.5 px-2.5 w-32">{t(language, 'photoColDate')}</th>
                      <th className="py-2.5 px-2.5 min-w-[140px]">
                        {t(language, 'photoColCustomer')}
                      </th>
                      <th className="py-2.5 px-2.5 min-w-[150px]">
                        {t(language, 'photoColItem')}
                      </th>
                      <th className="py-2.5 px-2.5 w-36">{t(language, 'photoColType')}</th>
                      <th className="py-2.5 px-2.5 w-32">{t(language, 'photoColAmount')}</th>
                      <th className="py-2.5 px-2 w-12" aria-label={t(language, 'dashDiscardBtn')} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row, idx) => {
                      const isUncertain = (field: PhotoUncertainField) =>
                        row.uncertainFields.includes(field);

                      const cellClass = (field: PhotoUncertainField) =>
                        `w-full min-h-[42px] px-2.5 py-1.5 text-sm rounded-lg border focus:outline-none focus:border-emerald-700 ${
                          isUncertain(field)
                            ? 'bg-amber-100 border-amber-400 text-amber-950 font-medium placeholder:text-amber-800/70'
                            : 'bg-white border-slate-200 text-slate-900'
                        }`;

                      return (
                        <tr
                          key={row.localId}
                          data-testid={`photo-row-${idx}`}
                          className="align-top hover:bg-slate-50/50"
                        >
                          {/* Date */}
                          <td className="p-2">
                            <input
                              type="text"
                              aria-label={`${t(language, 'photoColDate')} ${idx + 1}`}
                              data-uncertain={isUncertain('date') ? 'true' : 'false'}
                              value={row.date}
                              onChange={(e) =>
                                updateRowField(row.localId, 'date', e.target.value)
                              }
                              placeholder="YYYY-MM-DD"
                              className={`${cellClass('date')} font-mono text-xs`}
                            />
                            {isUncertain('date') && (
                              <span className="block mt-0.5 text-[10px] font-bold text-amber-800">
                                {t(language, 'confirmFieldUncertain')}
                              </span>
                            )}
                          </td>

                          {/* Customer Name */}
                          <td className="p-2">
                            <input
                              type="text"
                              aria-label={`${t(language, 'photoColCustomer')} ${idx + 1}`}
                              data-uncertain={isUncertain('customerName') ? 'true' : 'false'}
                              value={row.customerName}
                              onChange={(e) =>
                                updateRowField(row.localId, 'customerName', e.target.value)
                              }
                              placeholder={t(language, 'entryCustomerPlaceholder')}
                              className={cellClass('customerName')}
                            />
                            {isUncertain('customerName') && (
                              <span className="block mt-0.5 text-[10px] font-bold text-amber-800">
                                {t(language, 'confirmFieldUncertain')}
                              </span>
                            )}
                          </td>

                          {/* Item / Note */}
                          <td className="p-2">
                            <input
                              type="text"
                              aria-label={`${t(language, 'photoColItem')} ${idx + 1}`}
                              data-uncertain={isUncertain('item') ? 'true' : 'false'}
                              value={row.item}
                              onChange={(e) =>
                                updateRowField(row.localId, 'item', e.target.value)
                              }
                              placeholder={t(language, 'entryNotePlaceholder')}
                              className={cellClass('item')}
                            />
                            {isUncertain('item') && (
                              <span className="block mt-0.5 text-[10px] font-bold text-amber-800">
                                {t(language, 'confirmFieldUncertain')}
                              </span>
                            )}
                          </td>

                          {/* Type */}
                          <td className="p-2">
                            <select
                              aria-label={`${t(language, 'photoColType')} ${idx + 1}`}
                              data-uncertain={isUncertain('type') ? 'true' : 'false'}
                              value={row.type}
                              onChange={(e) =>
                                updateRowField(row.localId, 'type', e.target.value)
                              }
                              className={cellClass('type')}
                            >
                              <option value="">—</option>
                              <option value="sale">{t(language, 'homeTypeSale')}</option>
                              <option value="expense">{t(language, 'homeTypeExpense')}</option>
                              <option value="udhaar_given">
                                {t(language, 'dashTypeUdhaar')}
                              </option>
                              <option value="udhaar_received">
                                {t(language, 'dashTypeJama')}
                              </option>
                            </select>
                            {isUncertain('type') && (
                              <span className="block mt-0.5 text-[10px] font-bold text-amber-800">
                                {t(language, 'confirmFieldUncertain')}
                              </span>
                            )}
                          </td>

                          {/* Amount (₹) */}
                          <td className="p-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              aria-label={`${t(language, 'photoColAmount')} ${idx + 1}`}
                              data-uncertain={isUncertain('amount') ? 'true' : 'false'}
                              value={row.amountText}
                              onChange={(e) =>
                                updateRowField(row.localId, 'amountText', e.target.value)
                              }
                              placeholder="0.00"
                              className={`${cellClass('amount')} font-mono tabular-nums`}
                            />
                            {isUncertain('amount') && (
                              <span className="block mt-0.5 text-[10px] font-bold text-amber-800">
                                {t(language, 'confirmFieldUncertain')}
                              </span>
                            )}
                          </td>

                          {/* Delete Row */}
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteRow(row.localId)}
                              aria-label={t(language, 'photoDeleteRowLabel', { num: idx + 1 })}
                              className="min-h-[42px] min-w-[42px] rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 flex items-center justify-center cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {tableError && (
              <p role="alert" className="text-xs sm:text-sm font-medium text-red-700">
                {tableError}
              </p>
            )}

            {/* Table Footer Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleAddRow}
                data-testid="photo-add-row-btn"
                className="min-h-[46px] px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>{t(language, 'photoAddRowBtn')}</span>
              </button>

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[48px] px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm cursor-pointer"
                >
                  {t(language, 'cancel')}
                </button>
                <button
                  type="button"
                  disabled={saving || rows.length === 0}
                  onClick={handleSaveAllPending}
                  data-testid="photo-save-all-pending-btn"
                  className="flex-1 sm:flex-none min-h-[48px] px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
                >
                  {saving
                    ? t(language, 'saving')
                    : t(language, 'photoSaveAllPendingBtn', { count: rows.length })}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
