import { useState, useMemo } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Home,
  MessageCircle,
  Plus,
  Search,
  Settings,
  Trash2,
  Volume2,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { t, type AppLanguage } from '../../lib/i18n';
import {
  selectTodayDashboardTotals,
  selectPendingEntries,
  calculateLedgerSummary,
  formatINR,
  buildWhatsAppReminderUrl,
  getLocalDateKey,
  type LedgerEntryRecord,
  type LedgerEntryType,
} from '../../lib/finance';
import type { ShopProfileData } from '../../lib/routeGuard';
import { StepVoiceGuide } from '../onboarding/StepVoiceGuide';
import { VoiceEntryModal } from '../voice/VoiceEntryModal';
import { PhotoToLedgerModal } from '../photo/PhotoToLedgerModal';
import { TodaySummaryCards } from './TodaySummaryCards';
import { PendingEntriesBanner } from './PendingEntriesBanner';
import { ConfirmationModule } from './ConfirmationModule';
import { FloatingCaptureActions } from './FloatingCaptureActions';
import { MissingAmountModal } from './CaptureModals';
import { AddEntryModal } from './AddEntryModal';
import { SettingsView } from './SettingsView';
import type { ConfirmEntryOverrides } from '../../lib/firebase';

type DashboardTab = 'home' | 'confirm' | 'guide' | 'settings';
type LedgerFilter = 'all' | 'sale' | 'expense' | 'udhaar' | 'pending';

interface LedgerDashboardProps {
  language: AppLanguage;
  profile: ShopProfileData;
  firebaseUser: User | null;
  isOffline: boolean;
  entries: LedgerEntryRecord[];
  entriesLoading: boolean;
  entriesError: string | null;
  onRetryEntries: () => void;
  onAddEntry: (entry: LedgerEntryRecord) => Promise<void>;
  onConfirmEntry: (entryId: string, overrides: ConfirmEntryOverrides) => Promise<void>;
  onFillExpenseAmount: (entryId: string, amountPaise: number) => Promise<void>;
  onDeleteEntry: (entryId: string) => Promise<void>;
  onChangeLanguage: (lang: AppLanguage) => void;
  onSaveProfile: (updated: ShopProfileData) => Promise<void>;
  onRestartOnboarding: () => void;
}

function formatEntryDate(iso: string, lang: AppLanguage): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
    return date.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export function LedgerDashboard({
  language,
  profile,
  firebaseUser,
  isOffline,
  entries,
  entriesLoading,
  entriesError,
  onRetryEntries,
  onAddEntry,
  onConfirmEntry,
  onFillExpenseAmount,
  onDeleteEntry,
  onChangeLanguage,
  onSaveProfile,
  onRestartOnboarding,
}: LedgerDashboardProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>('home');
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [modalType, setModalType] = useState<LedgerEntryType | null>(null);
  const [captureMode, setCaptureMode] = useState<'voice' | 'camera' | null>(null);
  const [showMissingModal, setShowMissingModal] = useState(false);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);

  const todayKey = getLocalDateKey();

  // Deterministic selectors from /lib/finance (confirmed entries only for totals)
  const todayTotals = useMemo(
    () => selectTodayDashboardTotals(entries, todayKey),
    [entries, todayKey]
  );
  const pendingEntries = useMemo(() => selectPendingEntries(entries), [entries]);
  const creditSummary = useMemo(() => calculateLedgerSummary(entries), [entries]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter === 'sale' && entry.type !== 'sale') return false;
      if (filter === 'expense' && entry.type !== 'expense') return false;
      if (filter === 'udhaar' && entry.type !== 'udhaar' && entry.type !== 'jama') return false;
      if (filter === 'pending' && entry.status !== 'pending') return false;
      if (q) {
        const nameMatch = entry.customerName.toLowerCase().includes(q);
        const noteMatch = (entry.note ?? '').toLowerCase().includes(q);
        return nameMatch || noteMatch;
      }
      return true;
    });
  }, [entries, filter, searchQuery]);

  const handleDelete = async (id: string) => {
    setBusyEntryId(id);
    try {
      await onDeleteEntry(id);
    } finally {
      setBusyEntryId(null);
    }
  };

  const saleCount = entries.filter((e) => e.type === 'sale').length;
  const expenseCount = entries.filter((e) => e.type === 'expense').length;
  const creditCount = entries.filter((e) => e.type === 'udhaar' || e.type === 'jama').length;

  const getTypeLabel = (entry: LedgerEntryRecord) => {
    if (entry.status === 'pending') return t(language, 'dashStatusPending');
    if (entry.type === 'sale') return t(language, 'homeTypeSale');
    if (entry.type === 'expense') return t(language, 'homeTypeExpense');
    if (entry.type === 'jama') return t(language, 'dashTypeJama');
    return t(language, 'dashTypeUdhaar');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-36 md:pb-24">
      {/* Top Bar Contract: [Shop Brand] — [3 Nav Links] — [1 Primary Action] */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 sm:px-6 h-14 flex items-center">
        <div className="w-full max-w-6xl mx-auto flex items-center justify-between gap-6">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 truncate max-w-[180px] sm:max-w-[240px] text-left cursor-pointer"
          >
            {profile.shopName || t(language, 'appName')}
          </button>

          <nav
            aria-label={t(language, 'appName')}
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
          >
            {(
              [
                { id: 'home', label: t(language, 'navHome') },
                { id: 'guide', label: t(language, 'navGuide') },
                { id: 'settings', label: t(language, 'navSettings') },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                  activeTab === item.id || (item.id === 'home' && activeTab === 'confirm')
                    ? 'text-slate-900 border-emerald-700 font-semibold'
                    : 'border-transparent hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => {
                setActiveTab('home');
                setModalType('sale');
              }}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>{t(language, 'homeQuickSale')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {activeTab === 'home' && (
          <>
            {/* Shop Greeting + Quick Manual Entry Controls */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-600">
                  {t(language, 'dashGreeting', {
                    owner: profile.ownerName || t(language, 'dashDefaultOwner'),
                  })}
                </p>
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                  {t(language, 'homeTodayHeading')}
                </h1>
              </div>

              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalType('sale')}
                  className="min-h-[46px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>{t(language, 'homeQuickSale')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalType('expense')}
                  className="min-h-[46px] px-4 py-2 rounded-xl bg-red-700 hover:bg-red-800 text-white font-semibold text-sm flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>{t(language, 'homeQuickExpense')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalType('udhaar')}
                  className="min-h-[46px] px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 font-semibold text-sm flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-red-700" aria-hidden="true" />
                  <span>{t(language, 'dashAddUdhaar')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalType('jama')}
                  className="min-h-[46px] px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 font-semibold text-sm flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                  <span>{t(language, 'dashAddJama')}</span>
                </button>
              </div>
            </div>

            {/* Pending Entries Banner — Tapping opens Confirmation Module */}
            <PendingEntriesBanner
              language={language}
              pendingCount={todayTotals.pendingCount}
              loading={entriesLoading}
              onOpenConfirmation={() => setActiveTab('confirm')}
            />

            {/* Primary 3 Home Dashboard Cards: Today's Sales, Today's Expenses, Estimated Profit */}
            <TodaySummaryCards
              language={language}
              totals={todayTotals}
              loading={entriesLoading}
              onOpenMissingAmountExpenses={() => setShowMissingModal(true)}
            />

            {/* Compact Credit Book (Udhaar) Strip */}
            {!entriesLoading && (
              <section
                aria-label={t(language, 'homeCreditSummaryTitle')}
                className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="space-y-0.5">
                  <h2 className="text-sm font-bold text-slate-900">
                    {t(language, 'homeCreditSummaryTitle')}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {t(language, 'homeConfirmedOnlyHint')}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-6 text-sm">
                  <div>
                    <div className="text-xs text-slate-500">
                      {t(language, 'dashNetOutstanding')}
                    </div>
                    <div
                      data-testid="kpi-net-outstanding"
                      className="text-lg font-bold font-mono tabular-nums text-slate-900"
                    >
                      {formatINR(creditSummary.netOutstandingPaise)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">
                      {t(language, 'dashTotalReceivable')}
                    </div>
                    <div
                      data-testid="kpi-total-udhaar"
                      className="text-lg font-bold font-mono tabular-nums text-red-700"
                    >
                      {formatINR(creditSummary.totalUdhaarPaise)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">
                      {t(language, 'dashTotalCollected')}
                    </div>
                    <div
                      data-testid="kpi-total-jama"
                      className="text-lg font-bold font-mono tabular-nums text-emerald-700"
                    >
                      {formatINR(creditSummary.totalJamaPaise)}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Unified Recent Entries & Credit Book List */}
            <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-slate-900">
                    {t(language, 'homeLedgerHeading')}
                  </h2>

                  <div className="relative w-full sm:max-w-xs">
                    <Search
                      className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t(language, 'dashSearchPlaceholder')}
                      aria-label={t(language, 'dashSearchPlaceholder')}
                      className="w-full min-h-[42px] pl-10 pr-4 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-emerald-700"
                    />
                  </div>
                </div>

                {/* Filter Tabs */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
                  {(
                    [
                      { id: 'all', label: t(language, 'dashFilterAll', { count: entries.length }) },
                      { id: 'sale', label: t(language, 'homeFilterSales', { count: saleCount }) },
                      {
                        id: 'expense',
                        label: t(language, 'homeFilterExpenses', { count: expenseCount }),
                      },
                      { id: 'udhaar', label: t(language, 'dashFilterDue', { count: creditCount }) },
                      {
                        id: 'pending',
                        label: t(language, 'dashFilterPending', {
                          count: todayTotals.pendingCount,
                        }),
                      },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFilter(tab.id)}
                      className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        filter === tab.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Skeleton Loading State */}
              {entriesLoading && (
                <div className="p-5 space-y-3" aria-busy="true">
                  {[1, 2, 3, 4].map((row) => (
                    <div
                      key={row}
                      className="h-16 rounded-xl bg-slate-100 animate-pulse"
                    />
                  ))}
                </div>
              )}

              {/* Error State */}
              {!entriesLoading && entriesError && (
                <div className="p-8 text-center space-y-4">
                  <AlertCircle className="w-8 h-8 text-red-600 mx-auto" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-700">
                    {t(language, 'dashLoadError')}
                  </p>
                  <button
                    type="button"
                    onClick={onRetryEntries}
                    className="min-h-[44px] px-5 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold cursor-pointer"
                  >
                    {t(language, 'retry')}
                  </button>
                </div>
              )}

              {/* Empty State */}
              {!entriesLoading && !entriesError && filteredEntries.length === 0 && (
                <div className="p-10 text-center space-y-2">
                  <p className="text-base font-bold text-slate-900">
                    {entries.length === 0
                      ? t(language, 'dashEmptyTitle')
                      : t(language, 'dashEmptyFiltered')}
                  </p>
                  {entries.length === 0 && (
                    <p className="text-sm text-slate-600">{t(language, 'dashEmptyDesc')}</p>
                  )}
                </div>
              )}

              {/* Entry Rows */}
              {!entriesLoading && !entriesError && filteredEntries.length > 0 && (
                <ul className="divide-y divide-slate-100" data-testid="ledger-entry-list">
                  {filteredEntries.map((entry) => {
                    const isPending = entry.status === 'pending';
                    const isOutflow = entry.type === 'expense' || entry.type === 'udhaar';
                    const isMissingAmount =
                      entry.amountPaise === null || entry.amountPaise <= 0;

                    const waUrl =
                      entry.type === 'udhaar' && !isPending && !isMissingAmount
                        ? buildWhatsAppReminderUrl(
                            entry.customerPhone,
                            t(language, 'waReminderMessage', {
                              customer: entry.customerName,
                              shop: profile.shopName,
                              amount: formatINR(entry.amountPaise as number),
                            })
                          )
                        : null;

                    return (
                      <li
                        key={entry.id}
                        className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-bold text-slate-900 truncate">
                              {entry.customerName}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span
                              className={`text-xs font-semibold whitespace-nowrap ${
                                isPending
                                  ? 'text-amber-800'
                                  : isOutflow
                                    ? 'text-red-700'
                                    : 'text-emerald-700'
                              }`}
                            >
                              {getTypeLabel(entry)}
                            </span>
                          </div>

                          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5">
                            <span>{formatEntryDate(entry.occurredAtIso, language)}</span>
                            {entry.note && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="truncate max-w-md">{entry.note}</span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                          {isMissingAmount ? (
                            <button
                              type="button"
                              onClick={() => setShowMissingModal(true)}
                              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                            >
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
                              <span>{t(language, 'homeFillAmountBtn')}</span>
                            </button>
                          ) : (
                            <span
                              className={`text-lg font-bold font-mono tabular-nums ${
                                isPending
                                  ? 'text-amber-800'
                                  : isOutflow
                                    ? 'text-red-700'
                                    : 'text-emerald-700'
                              }`}
                            >
                              {isOutflow ? '-' : '+'}
                              {formatINR(entry.amountPaise as number)}
                            </span>
                          )}

                          <div className="flex items-center gap-1.5">
                            {isPending && (
                              <button
                                type="button"
                                onClick={() => setActiveTab('confirm')}
                                className="min-h-[40px] px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 text-xs font-semibold whitespace-nowrap cursor-pointer"
                              >
                                {t(language, 'dashConfirmBtn')}
                              </button>
                            )}

                            {/* Rule 3: Pre-filled wa.me link triggered only on explicit shopkeeper tap */}
                            {waUrl && (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`${t(language, 'dashWhatsAppRemind')} — ${entry.customerName}`}
                                className="min-h-[44px] px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                              >
                                <MessageCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                                <span className="hidden sm:inline">
                                  {t(language, 'dashWhatsAppRemind')}
                                </span>
                              </a>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDelete(entry.id)}
                              disabled={busyEntryId === entry.id}
                              aria-label={t(language, 'entryDeleteLabel', {
                                name: entry.customerName,
                              })}
                              className="min-h-[44px] min-w-[44px] rounded-xl text-slate-400 hover:text-red-700 hover:bg-red-50 flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40"
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}

        {activeTab === 'confirm' && (
          <ConfirmationModule
            language={language}
            isOffline={isOffline}
            pendingEntries={pendingEntries}
            onConfirmEntry={onConfirmEntry}
            onDiscardEntry={onDeleteEntry}
            onClose={() => setActiveTab('home')}
          />
        )}

        {activeTab === 'guide' && (
          <div className="max-w-4xl mx-auto bg-white border border-slate-200 rounded-2xl p-5 sm:p-8">
            <StepVoiceGuide
              language={language}
              saving={false}
              saveError={null}
              onSkip={() => setActiveTab('home')}
              onComplete={() => setActiveTab('home')}
            />
          </div>
        )}

        {activeTab === 'settings' && (
          <SettingsView
            language={language}
            profile={profile}
            firebaseUser={firebaseUser}
            onChangeLanguage={onChangeLanguage}
            onSaveProfile={onSaveProfile}
            onOpenVoiceGuide={() => setActiveTab('guide')}
            onRestartOnboarding={onRestartOnboarding}
          />
        )}
      </main>

      {/* Two Large Floating Buttons: Voice (mic) and Camera (on Home view) */}
      {activeTab === 'home' && (
        <FloatingCaptureActions
          language={language}
          onOpenVoice={() => setCaptureMode('voice')}
          onOpenCamera={() => setCaptureMode('camera')}
        />
      )}

      {/* Mobile Bottom Tab Bar (64px height) */}
      <nav
        aria-label={t(language, 'appName')}
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-xs border-t border-slate-200 h-16 grid grid-cols-3"
      >
        {(
          [
            { id: 'home', label: t(language, 'navHome'), icon: Home },
            { id: 'guide', label: t(language, 'navGuide'), icon: Volume2 },
            { id: 'settings', label: t(language, 'navSettings'), icon: Settings },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active =
            activeTab === tab.id || (tab.id === 'home' && activeTab === 'confirm');
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                active ? 'text-emerald-800' : 'text-slate-500'
              }`}
            >
              <Icon className="w-5 h-5" aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Manual Entry Modal */}
      {modalType && (
        <AddEntryModal
          language={language}
          entryType={modalType}
          ownerUid={firebaseUser?.uid ?? profile.uid}
          onClose={() => setModalType(null)}
          onSaveEntry={onAddEntry}
        />
      )}

      {/* Voice Entry Module — MediaRecorder (30s) + Gemini Extraction + Pending Route to Confirmation */}
      {captureMode === 'voice' && (
        <VoiceEntryModal
          language={language}
          ownerUid={firebaseUser?.uid ?? profile.uid}
          isOffline={isOffline}
          onClose={() => setCaptureMode(null)}
          onSavePendingEntry={onAddEntry}
          onRouteToConfirmation={() => setActiveTab('confirm')}
        />
      )}

      {/* Photo-to-Ledger Module — Compress + Storage + Gemini Vision + Editable Table */}
      {captureMode === 'camera' && (
        <PhotoToLedgerModal
          language={language}
          ownerUid={firebaseUser?.uid ?? profile.uid}
          isSignedIn={Boolean(firebaseUser)}
          isOffline={isOffline}
          onClose={() => setCaptureMode(null)}
          onSavePendingEntries={async (newEntries) => {
            for (const item of newEntries) {
              await onAddEntry(item);
            }
          }}
          onRouteToConfirmation={() => setActiveTab('confirm')}
        />
      )}

      {/* Missing Expense Amount Modal */}
      {showMissingModal && (
        <MissingAmountModal
          language={language}
          missingExpenses={todayTotals.missingAmountExpenses}
          onFillExpenseAmount={onFillExpenseAmount}
          onClose={() => setShowMissingModal(false)}
        />
      )}
    </div>
  );
}
