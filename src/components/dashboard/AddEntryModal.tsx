import React, { useState } from 'react';
import { X } from 'lucide-react';
import { t, type AppLanguage } from '../../lib/i18n';
import {
  rupeesToPaise,
  type LedgerEntryType,
  type LedgerEntryRecord,
} from '../../lib/finance';
import {
  sanitizeCustomerName,
  sanitizeNote,
  validateAndNormalizeIndianPhone,
} from '../../lib/validation';

interface AddEntryModalProps {
  language: AppLanguage;
  entryType: LedgerEntryType;
  ownerUid: string;
  onClose: () => void;
  onSaveEntry: (entry: LedgerEntryRecord) => Promise<void>;
}

export function AddEntryModal({
  language,
  entryType,
  ownerUid,
  onClose,
  onSaveEntry,
}: AddEntryModalProps) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [note, setNote] = useState('');

  const [customerError, setCustomerError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isNegativeFlow = entryType === 'udhaar' || entryType === 'expense';
  const allowMissingAmount = entryType === 'expense';
  const showPhoneField = entryType === 'udhaar' || entryType === 'jama';

  const modalTitle =
    entryType === 'sale'
      ? t(language, 'homeQuickSale')
      : entryType === 'expense'
        ? t(language, 'homeQuickExpense')
        : entryType === 'udhaar'
          ? t(language, 'entryModalTitleUdhaar')
          : t(language, 'entryModalTitleJama');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const custCheck = sanitizeCustomerName(customerName);
    const phoneCheck = validateAndNormalizeIndianPhone(customerPhone);
    const trimmedAmt = amountRupees.trim();
    let amountPaise: number | null = null;

    if (trimmedAmt.length === 0 && allowMissingAmount) {
      amountPaise = null;
      setAmountError(null);
    } else {
      amountPaise = rupeesToPaise(trimmedAmt);
      setAmountError(amountPaise === null ? t(language, 'errAmountInvalid') : null);
    }

    setCustomerError(custCheck.valid ? null : t(language, custCheck.errorKey!));
    setPhoneError(phoneCheck.valid ? null : t(language, phoneCheck.errorKey!));

    if (!custCheck.valid || !phoneCheck.valid || (!allowMissingAmount && amountPaise === null)) {
      return;
    }
    if (trimmedAmt.length > 0 && amountPaise === null) {
      return;
    }

    setSaving(true);
    try {
      const entry: LedgerEntryRecord = {
        id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ownerUid,
        customerName: custCheck.sanitized,
        customerPhone: showPhoneField ? phoneCheck.sanitized : '',
        type: entryType,
        amountPaise,
        note: sanitizeNote(note),
        source: 'manual',
        status: 'confirmed',
        occurredAtIso: new Date().toISOString(),
      };
      await onSaveEntry(entry);
      onClose();
    } catch {
      setSubmitError(t(language, 'errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-entry-modal-title"
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <h2
            id="add-entry-modal-title"
            className={`text-xl font-bold ${isNegativeFlow ? 'text-red-800' : 'text-emerald-800'}`}
          >
            {modalTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(language, 'close')}
            className="min-h-[44px] min-w-[44px] rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="entry-customer-input"
              className="block text-sm font-semibold text-slate-900"
            >
              {entryType === 'sale' || entryType === 'expense'
                ? t(language, 'voiceTitleLabel')
                : t(language, 'entryCustomerLabel')}{' '}
              *
            </label>
            <input
              id="entry-customer-input"
              type="text"
              required
              value={customerName}
              onChange={(e) => {
                setCustomerName(e.target.value);
                if (customerError) setCustomerError(null);
              }}
              placeholder={
                entryType === 'sale' || entryType === 'expense'
                  ? t(language, 'voiceTitlePlaceholder')
                  : t(language, 'entryCustomerPlaceholder')
              }
              className={`w-full min-h-[50px] px-4 py-2.5 text-base rounded-xl border bg-white text-slate-900 focus:outline-none focus:ring-2 ${
                customerError
                  ? 'border-red-600 focus:ring-red-600/20'
                  : 'border-slate-300 focus:border-emerald-700 focus:ring-emerald-700/20'
              }`}
            />
            {customerError && (
              <p role="alert" className="text-sm font-medium text-red-700">
                {customerError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="entry-amount-input"
              className="block text-sm font-semibold text-slate-900"
            >
              {t(language, 'entryAmountLabel')}{' '}
              {allowMissingAmount ? `(${t(language, 'optional')})` : '*'}
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-4 text-lg font-bold text-slate-500">₹</span>
              <input
                id="entry-amount-input"
                type="text"
                inputMode="decimal"
                required={!allowMissingAmount}
                value={amountRupees}
                onChange={(e) => {
                  setAmountRupees(e.target.value);
                  if (amountError) setAmountError(null);
                }}
                placeholder={t(language, 'entryAmountPlaceholder')}
                className={`w-full min-h-[52px] pl-10 pr-4 py-2.5 text-lg font-mono tabular-nums rounded-xl border bg-white text-slate-900 focus:outline-none focus:ring-2 ${
                  amountError
                    ? 'border-red-600 focus:ring-red-600/20'
                    : 'border-slate-300 focus:border-emerald-700 focus:ring-emerald-700/20'
                }`}
              />
            </div>
            {amountError ? (
              <p role="alert" className="text-sm font-medium text-red-700">
                {amountError}
              </p>
            ) : (
              allowMissingAmount && (
                <p className="text-xs text-slate-500">
                  {t(language, 'cameraLeaveAmountEmptyHint')}
                </p>
              )
            )}
          </div>

          {showPhoneField && (
            <div className="space-y-1.5">
              <label
                htmlFor="entry-phone-input"
                className="block text-sm font-semibold text-slate-900"
              >
                {t(language, 'entryPhoneLabel')} ({t(language, 'optional')})
              </label>
              <input
                id="entry-phone-input"
                type="tel"
                inputMode="numeric"
                value={customerPhone}
                onChange={(e) => {
                  setCustomerPhone(e.target.value);
                  if (phoneError) setPhoneError(null);
                }}
                placeholder={t(language, 'entryPhonePlaceholder')}
                className={`w-full min-h-[48px] px-4 py-2.5 text-base font-mono tabular-nums rounded-xl border bg-white text-slate-900 placeholder:font-sans focus:outline-none focus:ring-2 ${
                  phoneError
                    ? 'border-red-600 focus:ring-red-600/20'
                    : 'border-slate-300 focus:border-emerald-700 focus:ring-emerald-700/20'
                }`}
              />
              {phoneError && (
                <p role="alert" className="text-sm font-medium text-red-700">
                  {phoneError}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="entry-note-input"
              className="block text-sm font-semibold text-slate-900"
            >
              {t(language, 'entryNoteLabel')} ({t(language, 'optional')})
            </label>
            <input
              id="entry-note-input"
              type="text"
              maxLength={140}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t(language, 'entryNotePlaceholder')}
              className="w-full min-h-[48px] px-4 py-2.5 text-base rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
            />
          </div>

          {submitError && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {submitError}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="w-1/3 min-h-[52px] px-4 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-base cursor-pointer"
            >
              {t(language, 'cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className={`flex-1 min-h-[52px] px-5 py-3 rounded-xl text-white font-semibold text-base transition-colors cursor-pointer disabled:opacity-60 ${
                isNegativeFlow
                  ? 'bg-red-700 hover:bg-red-800'
                  : 'bg-emerald-700 hover:bg-emerald-800'
              }`}
            >
              {saving ? t(language, 'saving') : t(language, 'entrySaveBtn')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
