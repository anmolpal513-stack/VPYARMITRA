import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cloud,
  LogOut,
  Phone,
  ShieldCheck,
  Store,
  User as UserIcon,
} from 'lucide-react';
import type { ConfirmationResult, User } from 'firebase/auth';
import { t, type AppLanguage } from '../../lib/i18n';
import {
  SHOP_NAME_MAX_LEN,
  OWNER_NAME_MAX_LEN,
  validateShopName,
  validateOwnerName,
  validateAndNormalizeIndianPhone,
  validateOtpCode,
} from '../../lib/validation';
import {
  sendPhoneOtp,
  clearRecaptchaVerifier,
  signInWithGooglePopup,
  signOutUser,
} from '../../lib/firebase';

export interface ShopRegistrationValues {
  shopName: string;
  ownerName: string;
  phone: string;
}

interface StepShopRegistrationProps {
  language: AppLanguage;
  initialValues: ShopRegistrationValues;
  firebaseUser: User | null;
  onBack: () => void;
  onCompleteStep: (values: ShopRegistrationValues) => void;
}

export function StepShopRegistration({
  language,
  initialValues,
  firebaseUser,
  onBack,
  onCompleteStep,
}: StepShopRegistrationProps) {
  const [shopName, setShopName] = useState(initialValues.shopName);
  const [ownerName, setOwnerName] = useState(initialValues.ownerName);
  const [phone, setPhone] = useState(initialValues.phone);
  const [otpCode, setOtpCode] = useState('');

  const [shopNameError, setShopNameError] = useState<string | null>(null);
  const [ownerNameError, setOwnerNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [signingInGoogle, setSigningInGoogle] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(Boolean(firebaseUser?.phoneNumber));

  useEffect(() => {
    if (firebaseUser?.phoneNumber) {
      setPhoneVerified(true);
      if (!phone) {
        setPhone(firebaseUser.phoneNumber);
      }
    }
    if (firebaseUser?.displayName && !ownerName) {
      setOwnerName(firebaseUser.displayName.slice(0, OWNER_NAME_MAX_LEN));
    }
  }, [firebaseUser, ownerName, phone]);

  useEffect(() => {
    return () => {
      clearRecaptchaVerifier();
    };
  }, []);

  const handleShopNameChange = (value: string) => {
    setShopName(value);
    if (shopNameError) {
      const check = validateShopName(value);
      setShopNameError(check.valid ? null : t(language, check.errorKey!));
    }
  };

  const handleOwnerNameChange = (value: string) => {
    setOwnerName(value);
    if (ownerNameError) {
      const check = validateOwnerName(value);
      setOwnerNameError(check.valid ? null : t(language, check.errorKey!));
    }
  };

  const handlePhoneChange = (value: string) => {
    setPhone(value);
    setPhoneVerified(false);
    setConfirmationResult(null);
    setOtpCode('');
    setPhoneError(null);
    setAuthNotice(null);
  };

  const handleSendOtp = async () => {
    setPhoneError(null);
    setAuthNotice(null);
    const check = validateAndNormalizeIndianPhone(phone);
    if (!check.valid || !check.sanitized) {
      setPhoneError(t(language, 'errPhoneInvalid'));
      return;
    }

    setSendingOtp(true);
    try {
      const result = await sendPhoneOtp(check.sanitized, 'vyaparmitra-recaptcha');
      setConfirmationResult(result);
    } catch (err: unknown) {
      const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: string }).code) : '';
      if (
        code.includes('operation-not-allowed') ||
        code.includes('billing-not-enabled') ||
        code.includes('invalid-app-credential') ||
        code.includes('captcha-check-failed')
      ) {
        setAuthNotice(t(language, 'phoneOtpNotEnabledHint'));
      } else {
        setAuthNotice(t(language, 'phoneOtpNotEnabledHint'));
      }
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    setOtpError(null);
    const codeCheck = validateOtpCode(otpCode);
    if (!codeCheck.valid) {
      setOtpError(t(language, 'errOtpInvalid'));
      return;
    }
    if (!confirmationResult) return;

    setVerifyingOtp(true);
    try {
      await confirmationResult.confirm(codeCheck.sanitized);
      setPhoneVerified(true);
      setConfirmationResult(null);
      setOtpCode('');
    } catch {
      setOtpError(t(language, 'phoneOtpInvalidCode'));
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthNotice(null);
    setSigningInGoogle(true);
    try {
      await signInWithGooglePopup();
    } catch {
      setAuthNotice(t(language, 'errorGeneric'));
    } finally {
      setSigningInGoogle(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutUser();
      setPhoneVerified(false);
    } catch {
      setAuthNotice(t(language, 'errorGeneric'));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const shopCheck = validateShopName(shopName);
    const ownerCheck = validateOwnerName(ownerName);
    const phoneCheck = validateAndNormalizeIndianPhone(phone);

    setShopNameError(shopCheck.valid ? null : t(language, shopCheck.errorKey!));
    setOwnerNameError(ownerCheck.valid ? null : t(language, ownerCheck.errorKey!));
    setPhoneError(phoneCheck.valid ? null : t(language, phoneCheck.errorKey!));

    if (!shopCheck.valid || !ownerCheck.valid || !phoneCheck.valid) {
      return;
    }

    onCompleteStep({
      shopName: shopCheck.sanitized,
      ownerName: ownerCheck.sanitized,
      phone: phoneCheck.sanitized,
    });
  };

  const trimmedLen = shopName.trim().replace(/\s+/g, ' ').length;

  return (
    <section aria-labelledby="onboarding-reg-heading" className="space-y-6">
      <div className="space-y-2">
        <h1
          id="onboarding-reg-heading"
          className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight"
        >
          {t(language, 'regTitle')}
        </h1>
        <p className="text-base text-slate-600 leading-relaxed">
          {t(language, 'regSubtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {/* Shop Name (Required, 2-50 chars) */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <label
              htmlFor="shop-name-input"
              className="text-base font-semibold text-slate-900 flex items-center gap-2"
            >
              <Store className="w-4 h-4 text-emerald-700" aria-hidden="true" />
              <span>{t(language, 'shopNameLabel')}</span>
              <span className="text-xs font-medium text-red-700">
                * {t(language, 'required')}
              </span>
            </label>
            <span
              className={`text-xs font-mono tabular-nums ${
                trimmedLen > SHOP_NAME_MAX_LEN ? 'text-red-700 font-semibold' : 'text-slate-500'
              }`}
            >
              {trimmedLen}/{SHOP_NAME_MAX_LEN}
            </span>
          </div>

          <input
            id="shop-name-input"
            name="shopName"
            type="text"
            required
            autoComplete="organization"
            value={shopName}
            onChange={(e) => handleShopNameChange(e.target.value)}
            onBlur={() => {
              const check = validateShopName(shopName);
              setShopNameError(check.valid ? null : t(language, check.errorKey!));
            }}
            placeholder={t(language, 'shopNamePlaceholder')}
            aria-invalid={Boolean(shopNameError)}
            aria-describedby={shopNameError ? 'shop-name-error' : 'shop-name-helper'}
            className={`w-full min-h-[54px] px-4 py-3 text-base rounded-xl border bg-white text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 ${
              shopNameError
                ? 'border-red-600 focus:ring-red-600/20'
                : 'border-slate-300 focus:border-emerald-700 focus:ring-emerald-700/20'
            }`}
          />
          {shopNameError ? (
            <p id="shop-name-error" role="alert" className="text-sm font-medium text-red-700">
              {shopNameError}
            </p>
          ) : (
            <p id="shop-name-helper" className="text-xs text-slate-500">
              {t(language, 'shopNameHelper')}
            </p>
          )}
        </div>

        {/* Owner Name (Optional) */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <label
              htmlFor="owner-name-input"
              className="text-base font-semibold text-slate-900 flex items-center gap-2"
            >
              <UserIcon className="w-4 h-4 text-slate-500" aria-hidden="true" />
              <span>{t(language, 'ownerNameLabel')}</span>
              <span className="text-xs font-normal text-slate-500">
                ({t(language, 'optional')})
              </span>
            </label>
          </div>
          <input
            id="owner-name-input"
            name="ownerName"
            type="text"
            autoComplete="name"
            value={ownerName}
            onChange={(e) => handleOwnerNameChange(e.target.value)}
            placeholder={t(language, 'ownerNamePlaceholder')}
            aria-invalid={Boolean(ownerNameError)}
            className={`w-full min-h-[52px] px-4 py-3 text-base rounded-xl border bg-white text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 ${
              ownerNameError
                ? 'border-red-600 focus:ring-red-600/20'
                : 'border-slate-300 focus:border-emerald-700 focus:ring-emerald-700/20'
            }`}
          />
          {ownerNameError && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {ownerNameError}
            </p>
          )}
        </div>

        {/* Mobile Number + Firebase Auth OTP (Optional) */}
        <div className="space-y-2.5">
          <label
            htmlFor="phone-input"
            className="text-base font-semibold text-slate-900 flex items-center gap-2"
          >
            <Phone className="w-4 h-4 text-slate-500" aria-hidden="true" />
            <span>{t(language, 'phoneLabel')}</span>
            <span className="text-xs font-normal text-slate-500">
              ({t(language, 'optional')})
            </span>
          </label>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1 flex items-center">
              <span className="absolute left-3.5 text-base font-semibold text-slate-500 select-none">
                +91
              </span>
              <input
                id="phone-input"
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={phone.replace(/^\+91/, '')}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder={t(language, 'phonePlaceholder')}
                aria-invalid={Boolean(phoneError)}
                className={`w-full min-h-[52px] pl-14 pr-4 py-3 text-base font-mono tabular-nums rounded-xl border bg-white text-slate-900 placeholder:font-sans placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 ${
                  phoneError
                    ? 'border-red-600 focus:ring-red-600/20'
                    : 'border-slate-300 focus:border-emerald-700 focus:ring-emerald-700/20'
                }`}
              />
            </div>

            {!phoneVerified && (
              <button
                type="button"
                onClick={handleSendOtp}
                disabled={sendingOtp || phone.trim().length === 0}
                className="min-h-[52px] px-5 py-3 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold text-sm whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                {sendingOtp ? t(language, 'sendingOtp') : t(language, 'sendOtp')}
              </button>
            )}
          </div>

          {phoneError && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {phoneError}
            </p>
          )}

          {phoneVerified && (
            <p className="text-sm font-semibold text-emerald-800 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t(language, 'phoneVerifiedBadge')}</span>
            </p>
          )}

          {confirmationResult && !phoneVerified && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
              <label
                htmlFor="otp-code-input"
                className="block text-sm font-semibold text-slate-900"
              >
                {t(language, 'otpCodeLabel')}
              </label>
              <div className="flex gap-2.5">
                <input
                  id="otp-code-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => {
                    setOtpCode(e.target.value.replace(/\D/g, ''));
                    setOtpError(null);
                  }}
                  placeholder={t(language, 'otpCodePlaceholder')}
                  className="flex-1 min-h-[48px] px-4 py-2 text-lg font-mono tracking-widest rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                />
                <button
                  type="button"
                  onClick={handleVerifyOtp}
                  disabled={verifyingOtp || otpCode.length < 6}
                  className="min-h-[48px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-semibold text-sm whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {verifyingOtp ? t(language, 'verifyingOtp') : t(language, 'verifyOtp')}
                </button>
              </div>
              {otpError && (
                <p role="alert" className="text-sm font-medium text-red-700">
                  {otpError}
                </p>
              )}
            </div>
          )}

          <div id="vyaparmitra-recaptcha" aria-hidden="true" />
        </div>

        {/* Cloud Backup (Google Sign-In / Signed-in Status) */}
        <div className="pt-2 border-t border-slate-200 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <Cloud className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                <span>{t(language, 'cloudBackupSection')}</span>
              </h2>
              <p className="text-xs text-slate-600">{t(language, 'cloudBackupDesc')}</p>
            </div>
          </div>

          {firebaseUser ? (
            <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
              <div className="flex items-center gap-2 min-w-0 text-sm text-emerald-950 font-medium">
                <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-700" aria-hidden="true" />
                <span className="truncate">
                  {t(language, 'signedInAs', {
                    account: firebaseUser.phoneNumber || firebaseUser.email || firebaseUser.uid,
                  })}
                </span>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="min-h-[40px] px-3 text-xs font-semibold text-slate-700 hover:text-slate-900 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t(language, 'signOut')}</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={signingInGoogle}
              className="w-full min-h-[48px] px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
            >
              <span>{signingInGoogle ? t(language, 'signingIn') : t(language, 'signInGoogle')}</span>
            </button>
          )}

          {authNotice && (
            <p role="status" className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 leading-relaxed">
              {authNotice}
            </p>
          )}
        </div>

        {/* Navigation Buttons */}
        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
          <button
            type="button"
            onClick={onBack}
            className="sm:w-36 min-h-[54px] px-5 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            <span>{t(language, 'back')}</span>
          </button>

          <button
            type="submit"
            className="flex-1 min-h-[54px] px-6 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-base sm:text-lg flex items-center justify-center gap-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 active:scale-[0.99]"
          >
            <span>{t(language, 'regContinue')}</span>
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
      </form>
    </section>
  );
}
