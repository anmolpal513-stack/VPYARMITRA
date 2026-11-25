/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { BookOpen } from 'lucide-react';
import type { User } from 'firebase/auth';
import { t, type AppLanguage } from './lib/i18n';
import {
  resolveAppRoute,
  hasAutostartParam,
  type ShopProfileData,
} from './lib/routeGuard';
import type { LedgerEntryRecord } from './lib/finance';
import { DEMO_PROFILE, DEMO_LEDGER_ENTRIES } from './lib/demoData';
import {
  subscribeToAuth,
  fetchShopProfile,
  saveShopProfileToFirestore,
  subscribeToLedgerEntries,
  createLedgerEntryInFirestore,
  confirmPendingEntryInFirestore,
  updateMissingExpenseAmountInFirestore,
  deleteLedgerEntryInFirestore,
  type ConfirmEntryOverrides,
} from './lib/firebase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OfflineBanner } from './components/OfflineBanner';
import { OnboardingFlow } from './components/onboarding/OnboardingFlow';
import { LedgerDashboard } from './components/dashboard/LedgerDashboard';

const PROFILE_STORAGE_KEY = 'vyaparmitra_profile_v1';
const ENTRIES_STORAGE_KEY = 'vyaparmitra_entries_v2';
const LANGUAGE_STORAGE_KEY = 'vyaparmitra_lang_v1';

function readCachedProfile(): ShopProfileData | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShopProfileData;
    if (typeof parsed.shopName === 'string' && typeof parsed.onboarded === 'boolean') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile: ShopProfileData): void {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, profile.language);
  } catch {
    // ignore storage quota failures on restricted browsers
  }
}

function readCachedEntries(): LedgerEntryRecord[] {
  try {
    const raw = window.localStorage.getItem(ENTRIES_STORAGE_KEY);
    if (!raw) return DEMO_LEDGER_ENTRIES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LedgerEntryRecord[]) : DEMO_LEDGER_ENTRIES;
  } catch {
    return DEMO_LEDGER_ENTRIES;
  }
}

function writeCachedEntries(entries: LedgerEntryRecord[]): void {
  try {
    window.localStorage.setItem(ENTRIES_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore storage quota errors
  }
}

function readInitialLanguage(cachedProfile: ShopProfileData | null): AppLanguage {
  if (cachedProfile?.language === 'en' || cachedProfile?.language === 'hi') {
    return cachedProfile.language;
  }
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'en' || stored === 'hi') return stored;
  } catch {
    // ignore
  }
  return 'hi';
}

export default function App() {
  const autostart =
    typeof window !== 'undefined' ? hasAutostartParam(window.location.search) : false;

  const [profile, setProfile] = useState<ShopProfileData | null>(() => {
    const cached = readCachedProfile();
    if (cached) return cached;
    return autostart ? DEMO_PROFILE : null;
  });
  const [language, setLanguage] = useState<AppLanguage>(() => readInitialLanguage(profile));
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [forceOnboarding, setForceOnboarding] = useState(false);
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  const [entries, setEntries] = useState<LedgerEntryRecord[]>(() => readCachedEntries());
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState(0);

  // Keep <html lang="..."> synced with selected language
  useEffect(() => {
    document.documentElement.lang = language;
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // ignore
    }
  }, [language]);

  // Monitor browser online/offline state
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Firebase Auth listener + Firestore profile hydration (users/{uid}/profile/main)
  useEffect(() => {
    const unsub = subscribeToAuth(async (user) => {
      setFirebaseUser(user);
      setAuthReady(true);

      if (!user) {
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);
      try {
        const remoteProfile = await fetchShopProfile(user.uid);
        if (remoteProfile) {
          setProfile(remoteProfile);
          setLanguage(remoteProfile.language);
          writeCachedProfile(remoteProfile);
        }
      } catch {
        // Retain offline cached profile if Firestore is unreachable
      } finally {
        setProfileLoading(false);
      }
    });

    return () => unsub();
  }, []);

  // Real-time Firestore listener for sales, expenses, credit & pending entries
  useEffect(() => {
    if (!firebaseUser || !profile?.onboarded) {
      setEntriesLoading(false);
      setEntriesError(null);
      return;
    }

    setEntriesLoading(true);
    setEntriesError(null);

    const unsub = subscribeToLedgerEntries(
      firebaseUser.uid,
      (remoteEntries) => {
        setEntries(remoteEntries);
        writeCachedEntries(remoteEntries);
        setEntriesLoading(false);
      },
      (err) => {
        setEntriesError(err.message);
        setEntriesLoading(false);
      }
    );

    return () => unsub();
  }, [firebaseUser, profile?.onboarded, retryCounter]);

  const handleSaveProfile = useCallback(
    async (nextProfile: ShopProfileData) => {
      const normalized: ShopProfileData = {
        ...nextProfile,
        uid: firebaseUser?.uid ?? nextProfile.uid,
        onboarded: true,
        updatedAtIso: new Date().toISOString(),
      };

      setProfile(normalized);
      setLanguage(normalized.language);
      writeCachedProfile(normalized);
      setForceOnboarding(false);

      if (firebaseUser) {
        try {
          await saveShopProfileToFirestore({
            uid: firebaseUser.uid,
            shopName: normalized.shopName,
            ownerName: normalized.ownerName,
            phone: normalized.phone,
            language: normalized.language,
            onboarded: true,
          });
        } catch (err) {
          if (!isOffline) {
            throw err;
          }
        }
      }
    },
    [firebaseUser, isOffline]
  );

  const handleChangeLanguage = useCallback(
    (nextLang: AppLanguage) => {
      setLanguage(nextLang);
      if (profile) {
        const updated = { ...profile, language: nextLang };
        setProfile(updated);
        writeCachedProfile(updated);
        if (firebaseUser && profile.onboarded) {
          void saveShopProfileToFirestore({
            uid: firebaseUser.uid,
            shopName: updated.shopName,
            ownerName: updated.ownerName,
            phone: updated.phone,
            language: nextLang,
            onboarded: true,
          }).catch(() => {
            // keep local preference if offline
          });
        }
      }
    },
    [firebaseUser, profile]
  );

  const handleAddEntry = useCallback(
    async (entry: LedgerEntryRecord) => {
      if (firebaseUser) {
        await createLedgerEntryInFirestore(firebaseUser.uid, entry);
      } else {
        setEntries((prev) => {
          const next = [entry, ...prev];
          writeCachedEntries(next);
          return next;
        });
      }
    },
    [firebaseUser]
  );

  const handleConfirmEntry = useCallback(
    async (entryId: string, overrides: ConfirmEntryOverrides) => {
      if (!Number.isSafeInteger(overrides.amountPaise) || overrides.amountPaise <= 0) {
        throw new Error('errAmountInvalid');
      }
      if (firebaseUser) {
        await confirmPendingEntryInFirestore(firebaseUser.uid, entryId, overrides);
      } else {
        setEntries((prev) => {
          const next = prev.map((item) =>
            item.id === entryId
              ? {
                  ...item,
                  status: 'confirmed' as const,
                  uncertainFields: [],
                  customerName:
                    overrides.customerName !== undefined
                      ? overrides.customerName
                      : item.customerName,
                  type: overrides.type !== undefined ? overrides.type : item.type,
                  amountPaise: overrides.amountPaise,
                  note: overrides.note !== undefined ? overrides.note : item.note,
                  confirmedAt: overrides.confirmedAt,
                  editedFields: overrides.editedFields,
                  originalAIValue: overrides.originalAIValue,
                }
              : item
          );
          writeCachedEntries(next);
          return next;
        });
      }
    },
    [firebaseUser]
  );

  const handleFillExpenseAmount = useCallback(
    async (entryId: string, amountPaise: number) => {
      if (firebaseUser) {
        await updateMissingExpenseAmountInFirestore(firebaseUser.uid, entryId, amountPaise);
      } else {
        setEntries((prev) => {
          const next = prev.map((item) =>
            item.id === entryId ? { ...item, amountPaise } : item
          );
          writeCachedEntries(next);
          return next;
        });
      }
    },
    [firebaseUser]
  );

  const handleDeleteEntry = useCallback(
    async (entryId: string) => {
      if (firebaseUser) {
        await deleteLedgerEntryInFirestore(firebaseUser.uid, entryId);
      } else {
        setEntries((prev) => {
          const next = prev.filter((item) => item.id !== entryId);
          writeCachedEntries(next);
          return next;
        });
      }
    },
    [firebaseUser]
  );

  const route = resolveAppRoute({
    authReady,
    profileLoading,
    profile,
    forceOnboarding,
    autostart,
  });

  const activeProfile = profile ?? DEMO_PROFILE;

  return (
    <ErrorBoundary language={language}>
      <OfflineBanner language={language} isOffline={isOffline} />

      {route === 'loading' && (
        <div
          className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 gap-4"
          aria-busy="true"
        >
          <div className="w-14 h-14 rounded-2xl bg-emerald-700 text-white flex items-center justify-center">
            <BookOpen className="w-7 h-7" aria-hidden="true" />
          </div>
          <div className="text-center space-y-1">
            <h1 className="text-xl font-bold text-slate-900">{t(language, 'appName')}</h1>
            <p className="text-sm text-slate-600">{t(language, 'loadingApp')}</p>
          </div>
        </div>
      )}

      {route === 'onboarding' && (
        <OnboardingFlow
          language={language}
          onChangeLanguage={handleChangeLanguage}
          firebaseUser={firebaseUser}
          initialProfile={profile}
          onCompleteOnboarding={handleSaveProfile}
        />
      )}

      {route === 'dashboard' && (
        <LedgerDashboard
          language={language}
          profile={activeProfile}
          firebaseUser={firebaseUser}
          isOffline={isOffline}
          entries={entries}
          entriesLoading={entriesLoading}
          entriesError={entriesError}
          onRetryEntries={() => setRetryCounter((c) => c + 1)}
          onAddEntry={handleAddEntry}
          onConfirmEntry={handleConfirmEntry}
          onFillExpenseAmount={handleFillExpenseAmount}
          onDeleteEntry={handleDeleteEntry}
          onChangeLanguage={handleChangeLanguage}
          onSaveProfile={handleSaveProfile}
          onRestartOnboarding={() => setForceOnboarding(true)}
        />
      )}
    </ErrorBoundary>
  );
}
