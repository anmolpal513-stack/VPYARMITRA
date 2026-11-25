import React, { useState } from 'react';
import {
  Check,
  Cloud,
  LogOut,
  RotateCcw,
  Volume2,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { t, type AppLanguage } from '../../lib/i18n';
import type { ShopProfileData } from '../../lib/routeGuard';
import {
  SHOP_NAME_MAX_LEN,
  validateShopName,
  validateOwnerName,
  validateAndNormalizeIndianPhone,
} from '../../lib/validation';
import { signInWithGooglePopup, signOutUser } from '../../lib/firebase';

interface SettingsViewProps {
  language: AppLanguage;
  profile: ShopProfileData;
  firebaseUser: User | null;
  onChangeLanguage: (lang: AppLanguage) => void;
  onSaveProfile: (updated: ShopProfileData) => Promise<void>;
  onOpenVoiceGuide: () => void;
  onRestartOnboarding: () => void;
}

export function SettingsView({
  language,
  profile,
  firebaseUser,
  onChangeLanguage,
  onSaveProfile,
  onOpenVoiceGuide,
  onRestartOnboarding,
}: SettingsViewProps) {
  const [shopName, setShopName] = useState(profile.shopName);
  const [ownerName, setOwnerName] = useState(profile.ownerName ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');

  const [shopError, setShopError] = useState<string | null>(null);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavedNotice(false);

    const shopCheck = validateShopName(shopName);
    const ownerCheck = validateOwnerName(ownerName);
    const phoneCheck = validateAndNormalizeIndianPhone(phone);

    setShopError(shopCheck.valid ? null : t(language, shopCheck.errorKey!));
    setOwnerError(ownerCheck.valid ? null : t(language, ownerCheck.errorKey!));
    setPhoneError(phoneCheck.valid ? null : t(language, phoneCheck.errorKey!));

    if (!shopCheck.valid || !ownerCheck.valid || !phoneCheck.valid) return;

    setSaving(true);
    try {
      await onSaveProfile({
        ...profile,
        shopName: shopCheck.sanitized,
        ownerName: ownerCheck.sanitized,
        phone: phoneCheck.sanitized,
        language,
        onboarded: true,
        updatedAtIso: new Date().toISOString(),
      });
      setSavedNotice(true);
    } finally {
      setSaving(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    try {
      await signInWithGooglePopup();
    } catch {
      // user cancelled popup or network error
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    setAuthBusy(true);
    try {
      await signOutUser();
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Shop Profile Form */}
      <section className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
        <h2 className="text-lg font-bold text-slate-900">
          {t(language, 'settingsProfileHeading')}
        </h2>

        <form onSubmit={handleSave} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="settings-shop-name" className="text-sm font-semibold text-slate-900">
                {t(language, 'shopNameLabel')} *
              </label>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {shopName.trim().length}/{SHOP_NAME_MAX_LEN}
              </span>
            </div>
            <input
              id="settings-shop-name"
              type="text"
              value={shopName}
              onChange={(e) => {
                setShopName(e.target.value);
                setSavedNotice(false);
                if (shopError) setShopError(null);
              }}
              className="w-full min-h-[48px] px-4 py-2.5 text-base rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
            />
            {shopError && (
              <p role="alert" className="text-sm font-medium text-red-700">
                {shopError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="settings-owner-name" className="block text-sm font-semibold text-slate-900">
              {t(language, 'ownerNameLabel')} ({t(language, 'optional')})
            </label>
            <input
              id="settings-owner-name"
              type="text"
              value={ownerName}
              onChange={(e) => {
                setOwnerName(e.target.value);
                setSavedNotice(false);
                if (ownerError) setOwnerError(null);
              }}
              className="w-full min-h-[48px] px-4 py-2.5 text-base rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
            />
            {ownerError && (
              <p role="alert" className="text-sm font-medium text-red-700">
                {ownerError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="settings-phone" className="block text-sm font-semibold text-slate-900">
              {t(language, 'phoneLabel')} ({t(language, 'optional')})
            </label>
            <input
              id="settings-phone"
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setSavedNotice(false);
                if (phoneError) setPhoneError(null);
              }}
              className="w-full min-h-[48px] px-4 py-2.5 text-base font-mono tabular-nums rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
            />
            {phoneError && (
              <p role="alert" className="text-sm font-medium text-red-700">
                {phoneError}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="min-h-[48px] px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-60"
            >
              {saving ? t(language, 'saving') : t(language, 'save')}
            </button>
            {savedNotice && (
              <span role="status" className="text-sm font-semibold text-emerald-800 flex items-center gap-1.5">
                <Check className="w-4 h-4" aria-hidden="true" />
                <span>{t(language, 'settingsSavedToast')}</span>
              </span>
            )}
          </div>
        </form>
      </section>

      {/* Language, Cloud Sync & Guide Controls */}
      <div className="lg:col-span-5 space-y-5">
        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3.5">
          <h2 className="text-base font-bold text-slate-900">
            {t(language, 'settingsLanguageHeading')}
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {(['hi', 'en'] as const).map((code) => {
              const active = language === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => onChangeLanguage(code)}
                  aria-pressed={active}
                  className={`min-h-[48px] px-4 py-2.5 rounded-xl border font-semibold text-sm transition-colors cursor-pointer ${
                    active
                      ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {code === 'hi' ? t(language, 'langHindiTitle') : t(language, 'langEnglishTitle')}
                </button>
              );
            })}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Cloud className="w-4 h-4 text-emerald-700" aria-hidden="true" />
              <span>{t(language, 'cloudBackupSection')}</span>
            </h2>
            <span className="text-xs font-medium text-slate-600">
              {firebaseUser
                ? t(language, 'settingsCloudStatusSynced')
                : t(language, 'settingsCloudStatusLocal')}
            </span>
          </div>

          {firebaseUser ? (
            <div className="flex items-center justify-between gap-2 text-sm text-slate-700">
              <span className="truncate">
                {firebaseUser.phoneNumber || firebaseUser.email || firebaseUser.uid}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={authBusy}
                className="min-h-[40px] px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t(language, 'signOut')}</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={authBusy}
              className="w-full min-h-[48px] px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 font-semibold text-sm cursor-pointer disabled:opacity-60"
            >
              {authBusy ? t(language, 'signingIn') : t(language, 'signInGoogle')}
            </button>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-2.5">
          <button
            type="button"
            onClick={onOpenVoiceGuide}
            className="w-full min-h-[48px] px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70 text-emerald-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Volume2 className="w-4 h-4" aria-hidden="true" />
            <span>{t(language, 'settingsReplayGuide')}</span>
          </button>

          <button
            type="button"
            onClick={onRestartOnboarding}
            className="w-full min-h-[48px] px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            <span>{t(language, 'settingsResetOnboarding')}</span>
          </button>
        </section>
      </div>
    </div>
  );
}
