import { useState } from 'react';
import { BookOpen, Check } from 'lucide-react';
import type { User } from 'firebase/auth';
import { t, type AppLanguage } from '../../lib/i18n';
import type { ShopProfileData } from '../../lib/routeGuard';
import { StepLanguage } from './StepLanguage';
import {
  StepShopRegistration,
  type ShopRegistrationValues,
} from './StepShopRegistration';
import { StepVoiceGuide } from './StepVoiceGuide';

interface OnboardingFlowProps {
  language: AppLanguage;
  onChangeLanguage: (lang: AppLanguage) => void;
  firebaseUser: User | null;
  initialProfile: ShopProfileData | null;
  onCompleteOnboarding: (profile: ShopProfileData) => Promise<void>;
}

type OnboardingStep = 1 | 2 | 3;

export function OnboardingFlow({
  language,
  onChangeLanguage,
  firebaseUser,
  initialProfile,
  onCompleteOnboarding,
}: OnboardingFlowProps) {
  const [step, setStep] = useState<OnboardingStep>(1);
  const [regValues, setRegValues] = useState<ShopRegistrationValues>({
    shopName: initialProfile?.shopName ?? '',
    ownerName: initialProfile?.ownerName ?? '',
    phone: initialProfile?.phone ?? firebaseUser?.phoneNumber ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const stepsMeta: Array<{ id: OnboardingStep; label: string }> = [
    { id: 1, label: t(language, 'step1Label') },
    { id: 2, label: t(language, 'step2Label') },
    { id: 3, label: t(language, 'step3Label') },
  ];

  const handleFinalizeOnboarding = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      const uid = firebaseUser?.uid ?? initialProfile?.uid ?? 'local-shopkeeper';
      await onCompleteOnboarding({
        uid,
        shopName: regValues.shopName,
        ownerName: regValues.ownerName,
        phone: regValues.phone || firebaseUser?.phoneNumber || '',
        language,
        onboarded: true,
        updatedAtIso: new Date().toISOString(),
      });
    } catch {
      setSaveError(t(language, 'errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Compact Brand Header */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 h-14 flex items-center">
        <div className="w-full max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center">
              <BookOpen className="w-4 h-4" aria-hidden="true" />
            </span>
            <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
              {t(language, 'appName')}
            </span>
          </div>

          <div className="text-xs sm:text-sm font-semibold text-slate-600 whitespace-nowrap">
            {t(language, 'stepIndicator', { current: step, total: 3 })}
          </div>
        </div>
      </header>

      {/* Main Responsive Container */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Desktop Context Rail (visible on lg+, clean step progress on mobile) */}
          <aside className="lg:col-span-4 space-y-6">
            <div className="hidden lg:block space-y-2">
              <p className="text-sm font-semibold text-emerald-800">
                {t(language, 'appTagline')}
              </p>
              <h2 className="text-2xl font-bold text-slate-900 leading-snug">
                {t(language, 'onboardingRailTitle')}
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                {t(language, 'onboardingRailDesc')}
              </p>
            </div>

            {/* Stepper List */}
            <nav aria-label={t(language, 'appName')}>
              <ol className="grid grid-cols-3 lg:grid-cols-1 gap-2 sm:gap-3">
                {stepsMeta.map((item) => {
                  const completed = step > item.id;
                  const active = step === item.id;
                  return (
                    <li
                      key={item.id}
                      className={`flex items-center gap-2.5 p-2.5 sm:p-3 rounded-xl border transition-colors ${
                        active
                          ? 'bg-white border-emerald-700 text-slate-900'
                          : completed
                            ? 'bg-emerald-50/50 border-emerald-200 text-emerald-900'
                            : 'bg-transparent border-slate-200 text-slate-500'
                      }`}
                    >
                      <span
                        className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                          completed
                            ? 'bg-emerald-700 text-white'
                            : active
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {completed ? <Check className="w-4 h-4" aria-hidden="true" /> : item.id}
                      </span>
                      <span className="text-xs sm:text-sm font-semibold truncate">
                        {item.label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </nav>
          </aside>

          {/* Primary Interactive Step Surface */}
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl p-5 sm:p-8">
            {step === 1 && (
              <StepLanguage
                language={language}
                onSelectLanguage={onChangeLanguage}
                onContinue={() => setStep(2)}
              />
            )}

            {step === 2 && (
              <StepShopRegistration
                language={language}
                initialValues={regValues}
                firebaseUser={firebaseUser}
                onBack={() => setStep(1)}
                onCompleteStep={(values) => {
                  setRegValues(values);
                  setStep(3);
                }}
              />
            )}

            {step === 3 && (
              <StepVoiceGuide
                language={language}
                saving={saving}
                saveError={saveError}
                onBack={() => setStep(2)}
                onSkip={handleFinalizeOnboarding}
                onComplete={handleFinalizeOnboarding}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
