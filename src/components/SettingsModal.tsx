import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Cpu,
  Download,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Rocket,
  Settings,
  ShieldCheck,
  Sliders,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { AuthErrorDetails, DriveAuthUser } from '../services/authService';
import {
  DEFAULT_PLUGIN_SETTINGS,
  DriveScopeOption,
  PluginSettings,
} from '../types/settings';
import {
  AutoUpdateHistoryEntry,
  SoftwareReleaseManifest,
  UpdateChannel,
} from '../core/autoUpdateEngine';
import { AutoUpdaterStatus } from '../hooks/useAutoUpdater';

export type SettingsTabId = 'auth' | 'tokens' | 'engine' | 'bridge' | 'updates';

interface SettingsModalProps {
  isOpen: boolean;
  initialTab?: SettingsTabId;
  settings: PluginSettings;
  onUpdateSettings: (patch: Partial<PluginSettings>) => void;
  user: DriveAuthUser | null;
  errorDetails: AuthErrorDetails | null;
  isBusy: boolean;
  isDark: boolean;
  onToggleTheme: () => void;
  onClose: () => void;
  onTriggerFirebaseLogin: (scopeOverride?: string) => Promise<void>;
  onTriggerGisLogin: (scopeOverride?: string) => Promise<void>;
  onSubmitDirectToken: (token: string) => Promise<void>;
  onSubmitServiceAccount: (serviceAccountJson: string) => Promise<void>;
  onSubmitRefreshToken: (params: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }) => Promise<void>;
  onPurgeCache: () => void;
  onLogout: () => void;
  currentVersion?: string;
  currentBuildHash?: string;
  updateStatus?: AutoUpdaterStatus;
  lastUpdateCheckAt?: string;
  updateHistory?: AutoUpdateHistoryEntry[];
  swRegistered?: boolean;
  isDesktopInstallable?: boolean;
  isDesktopInstalled?: boolean;
  onInstallDesktopApp?: () => Promise<boolean>;
  onCheckForUpdatesNow?: () => Promise<SoftwareReleaseManifest | null>;
  onPushSoftwareUpdateOta?: (params?: {
    version?: string;
    bumpType?: 'patch' | 'minor';
    channel?: UpdateChannel;
    changelog?: string[];
    critical?: boolean;
  }) => Promise<SoftwareReleaseManifest>;
}

const GCP_PROJECT_ID = 'gen-lang-client-0526103837';
const GCP_AUDIENCE_URL = `https://console.cloud.google.com/auth/audience?project=${GCP_PROJECT_ID}`;
const GCP_CONSENT_URL = `https://console.cloud.google.com/apis/credentials/consent?project=${GCP_PROJECT_ID}`;
const OAUTH_PLAYGROUND_URL =
  'https://developers.google.com/oauthplayground/#step1&apisSelect=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive&url=https%3A%2F%2F&content_type=application%2Fjson&http_method=GET&useDefaultOauthCred=unchecked';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  initialTab = 'auth',
  settings,
  onUpdateSettings,
  user,
  errorDetails,
  isBusy,
  isDark,
  onToggleTheme,
  onClose,
  onTriggerFirebaseLogin,
  onTriggerGisLogin,
  onSubmitDirectToken,
  onSubmitServiceAccount,
  onSubmitRefreshToken,
  onPurgeCache,
  onLogout,
  currentVersion = '2.5.0',
  currentBuildHash = 'build-250-ota-ready',
  updateStatus = 'UP_TO_DATE',
  lastUpdateCheckAt = 'Just now',
  updateHistory = [],
  swRegistered = true,
  isDesktopInstallable = false,
  isDesktopInstalled = false,
  onInstallDesktopApp,
  onCheckForUpdatesNow,
  onPushSoftwareUpdateOta,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [directToken, setDirectToken] = useState('');
  const [serviceAccountJson, setServiceAccountJson] = useState('');
  const [refreshClientId, setRefreshClientId] = useState(settings.customOAuthClientId);
  const [refreshClientSecret, setRefreshClientSecret] = useState('');
  const [refreshTokenValue, setRefreshTokenValue] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  // OTA Release Push Form State
  const [otaBumpType, setOtaBumpType] = useState<'patch' | 'minor'>('patch');
  const [otaReleaseNote, setOtaReleaseNote] = useState(
    'Hot-swapped Google Drive virtualized stream viewer and Harness MCP bridge schema'
  );
  const [isPushingOta, setIsPushingOta] = useState(false);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const showToast = (msg: string) => {
    setStatusToast(msg);
    setTimeout(() => setStatusToast(null), 3500);
  };

  const handleDirectTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directToken.trim()) {
      setLocalError('Paste a valid Google OAuth 2.0 Bearer access token (ya29...) first.');
      return;
    }
    setLocalError(null);
    try {
      await onSubmitDirectToken(directToken);
      setDirectToken('');
      showToast('Verified OAuth 2.0 token & connected Google Drive.');
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Token verification failed');
    }
  };

  const handleServiceAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceAccountJson.trim()) {
      setLocalError('Paste a Google Cloud Service Account JSON key first.');
      return;
    }
    setLocalError(null);
    try {
      await onSubmitServiceAccount(serviceAccountJson);
      setServiceAccountJson('');
      showToast('Authenticated Service Account via RS256 JWT & connected Google Drive.');
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Service Account authentication failed');
    }
  };

  const handleServiceAccountFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setServiceAccountJson(text);
    setLocalError(null);
  };

  const handleRefreshTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refreshClientId.trim() || !refreshClientSecret.trim() || !refreshTokenValue.trim()) {
      setLocalError('Client ID, Client Secret, and Refresh Token are required.');
      return;
    }
    setLocalError(null);
    try {
      await onSubmitRefreshToken({
        clientId: refreshClientId,
        clientSecret: refreshClientSecret,
        refreshToken: refreshTokenValue,
      });
      setRefreshTokenValue('');
      showToast('Exchanged Refresh Token & connected Google Drive.');
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Refresh token exchange failed');
    }
  };

  const tabs: Array<{ id: SettingsTabId; label: string; icon: React.ReactNode }> = [
    {
      id: 'auth',
      label: 'Google OAuth & 403 Fix',
      icon: <ShieldCheck className="w-3.5 h-3.5" />,
    },
    {
      id: 'tokens',
      label: 'Tokens & Service Account',
      icon: <KeyRound className="w-3.5 h-3.5" />,
    },
    {
      id: 'engine',
      label: 'Stream & LRU Cache',
      icon: <Sliders className="w-3.5 h-3.5" />,
    },
    {
      id: 'bridge',
      label: 'Workspace & Harness',
      icon: <Cpu className="w-3.5 h-3.5" />,
    },
    {
      id: 'updates',
      label: 'Auto-Update & OTA',
      icon: <Rocket className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-3xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Settings className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <div>
              <h2
                id="settings-modal-title"
                className="text-base font-bold font-display text-slate-900 dark:text-slate-100"
              >
                DrivePulse Plugin Settings & Authentication Control Center
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Configure Google Drive OAuth channels, Service Account credentials, LRU cache memory, and chunked stream parameters.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Settings Categories"
          className="px-6 pt-3 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 overflow-x-auto"
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setActiveTab(tab.id);
                  setLocalError(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-[#111827] rounded-t-lg'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          {statusToast && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-800 dark:text-emerald-200 font-medium flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{statusToast}</span>
            </div>
          )}

          {localError && (
            <div
              role="alert"
              className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 font-medium"
            >
              {localError}
            </div>
          )}

          {/* TAB 1: GOOGLE OAUTH & 403 ACCESS_DENIED ROOT-CAUSE FIX */}
          {activeTab === 'auth' && (
            <div className="space-y-5">
              {/* Root-Cause Explanation & 1-Click GCP Unblocker Banner */}
              <div className="p-4 bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/70 rounded-xl space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-bold text-amber-950 dark:text-amber-200">
                      Why Google Shows &ldquo;Error 403: access_denied (has not completed verification)&rdquo;
                    </div>
                    <p className="text-amber-900/90 dark:text-amber-300/90 leading-relaxed">
                      Google Cloud project <span className="font-mono font-semibold">{GCP_PROJECT_ID}</span> was created under <span className="font-mono font-semibold">harishgouda9916@gmail.com</span> with its OAuth Consent Screen in <strong>Testing</strong> status. When signing in with <span className="font-mono font-semibold">harishgouda0001@gmail.com</span> (or any account not yet added to the project&apos;s Test Users list) while requesting the restricted <span className="font-mono">drive</span> scope, Google blocks the popup with <span className="font-mono">Error 403: access_denied</span>.
                    </p>
                  </div>
                </div>

                <div className="pl-6 space-y-2">
                  <div className="font-semibold text-amber-950 dark:text-amber-200">
                    Choose any of these 3 immediate fixes:
                  </div>
                  <ol className="list-decimal pl-4 space-y-1 text-amber-900 dark:text-amber-300">
                    <li>
                      <strong>Permanent Fix in GCP Console (10 seconds):</strong> Open{' '}
                      <a
                        href={GCP_AUDIENCE_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="underline font-semibold text-blue-700 dark:text-blue-400"
                      >
                        GCP Auth Audience ({GCP_PROJECT_ID})
                      </a>{' '}
                      and click <strong>&ldquo;Publish App&rdquo;</strong> (or add{' '}
                      <span className="font-mono">harishgouda0001@gmail.com</span> &amp;{' '}
                      <span className="font-mono">harishgouda9916@gmail.com</span> under{' '}
                      <strong>Test users &rarr; + Add users</strong>).
                    </li>
                    <li>
                      <strong>Zero-Console Token Bypass (2 clicks):</strong> Switch to the{' '}
                      <button
                        type="button"
                        onClick={() => setActiveTab('tokens')}
                        className="underline font-semibold text-blue-700 dark:text-blue-400 cursor-pointer"
                      >
                        Tokens &amp; Service Account tab
                      </button>{' '}
                      to connect via Google OAuth Playground or a Service Account JSON key (never hits the Testing screen).
                    </li>
                    <li>
                      <strong>Instant Identity-Only Sign-In (Below):</strong> Click{' '}
                      <strong>&ldquo;Sign In with Identity Mode (Bypass Scope Block)&rdquo;</strong> below to sign in with <span className="font-mono">harishgouda0001@gmail.com</span> or <span className="font-mono">harishgouda9916@gmail.com</span> without requesting restricted scopes.
                    </li>
                  </ol>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <a
                      href={GCP_AUDIENCE_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-900 text-white hover:bg-amber-800 rounded-lg font-semibold transition-colors"
                    >
                      <span>1. Open GCP Audience (Publish App / Add Test Users)</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <a
                      href={GCP_CONSENT_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 rounded-lg font-medium hover:bg-amber-100/50 transition-colors"
                    >
                      <span>Open Classic Consent Screen</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </div>

              {errorDetails && (
                <div className="p-3 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-mono text-[11px] text-slate-700 dark:text-slate-300">
                  Last Diagnostic: {errorDetails.message}
                </div>
              )}

              {/* Account Hint & OAuth Scope Configuration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="settings-login-hint"
                    className="block font-semibold text-slate-800 dark:text-slate-200"
                  >
                    Target Google Account Hint (login_hint)
                  </label>
                  <input
                    id="settings-login-hint"
                    type="email"
                    value={settings.loginHint}
                    onChange={(e) => onUpdateSettings({ loginHint: e.target.value })}
                    placeholder="e.g. harishgouda9916@gmail.com"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-mono"
                  />
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ loginHint: 'harishgouda9916@gmail.com' })}
                      className="px-2 py-0.5 text-[11px] font-mono bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 rounded cursor-pointer"
                    >
                      harishgouda9916@gmail.com (Owner)
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ loginHint: 'harishgouda0001@gmail.com' })}
                      className="px-2 py-0.5 text-[11px] font-mono bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 rounded cursor-pointer"
                    >
                      harishgouda0001@gmail.com
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ loginHint: '' })}
                      className="px-2 py-0.5 text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-500 rounded cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="settings-oauth-scope"
                    className="block font-semibold text-slate-800 dark:text-slate-200"
                  >
                    Requested Google OAuth Scope
                  </label>
                  <select
                    id="settings-oauth-scope"
                    value={settings.oauthScope}
                    onChange={(e) =>
                      onUpdateSettings({ oauthScope: e.target.value as DriveScopeOption })
                    }
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    <option value="https://www.googleapis.com/auth/drive">
                      Full Drive Sync (auth/drive)
                    </option>
                    <option value="https://www.googleapis.com/auth/drive.file">
                      Per-File Non-Restricted (auth/drive.file)
                    </option>
                    <option value="https://www.googleapis.com/auth/drive.readonly">
                      Read-Only Drive (auth/drive.readonly)
                    </option>
                    <option value="profile_only">
                      Identity Only — Bypass Unverified Scope Check (openid email profile)
                    </option>
                  </select>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Use <strong>Per-File (drive.file)</strong> or <strong>Identity Only</strong> if full Drive scope is blocked.
                  </p>
                </div>
              </div>

              {/* Custom OAuth Client ID Override */}
              <div className="space-y-1.5">
                <label
                  htmlFor="settings-client-id"
                  className="block font-semibold text-slate-800 dark:text-slate-200"
                >
                  OAuth 2.0 Web Client ID (GIS Direct Channel)
                </label>
                <input
                  id="settings-client-id"
                  type="text"
                  value={settings.customOAuthClientId}
                  onChange={(e) => onUpdateSettings({ customOAuthClientId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-mono text-[11px]"
                />
              </div>

              {/* 3 Direct Sign-In Channels */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  Launch Google Sign-In with Configured Settings
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onTriggerGisLogin(settings.oauthScope)}
                    className="p-3 text-left bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors cursor-pointer disabled:opacity-60 space-y-1"
                  >
                    <div className="font-bold flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5" />
                      <span>Direct Google OAuth (GIS)</span>
                    </div>
                    <div className="text-[11px] text-blue-100">
                      Uses {settings.loginHint || 'chooser'} &amp; selected scope
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onTriggerFirebaseLogin(settings.oauthScope)}
                    className="p-3 text-left bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg transition-colors cursor-pointer disabled:opacity-60 space-y-1"
                  >
                    <div className="font-bold">Firebase Auth Popup</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Standard popup with {settings.loginHint || 'account selector'}
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onTriggerFirebaseLogin('profile_only')}
                    className="p-3 text-left bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors cursor-pointer disabled:opacity-60 space-y-1"
                  >
                    <div className="font-bold flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Sign In (Identity Bypass)</span>
                    </div>
                    <div className="text-[11px] text-emerald-100">
                      Skips restricted Drive scope to avoid 403 block
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: TOKENS & SERVICE ACCOUNT BRIDGE (BYPASSES OAUTH POPUP 100%) */}
          {activeTab === 'tokens' && (
            <div className="space-y-6">
              {/* Section A: Direct OAuth 2.0 Access Token + Google OAuth Playground */}
              <form
                onSubmit={handleDirectTokenSubmit}
                className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>1. Direct Google Drive OAuth 2.0 Bearer Token (Instant 403 Bypass)</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Google&apos;s official OAuth 2.0 Playground is already verified by Google, so it never shows &ldquo;Error 403: access_denied&rdquo;.
                    </p>
                  </div>
                  <a
                    href={OAUTH_PLAYGROUND_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white hover:bg-blue-500 rounded-lg font-semibold transition-colors shrink-0"
                  >
                    <span>Open Google OAuth Playground (Drive Pre-Selected)</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="text-[11px] text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                  <strong>How to get a token in 15 seconds:</strong> Click the blue button above &rarr; Click <strong>Authorize APIs</strong> (sign in with <span className="font-mono">harishgouda0001@gmail.com</span> or <span className="font-mono">harishgouda9916@gmail.com</span>) &rarr; Click <strong>Exchange authorization code for tokens</strong> &rarr; Copy the <strong>Access token</strong> (<span className="font-mono">ya29...</span>) and paste it below:
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="settings-direct-token-input"
                    type="password"
                    value={directToken}
                    onChange={(e) => setDirectToken(e.target.value)}
                    placeholder="Paste ya29.a0AfH6SM... OAuth 2.0 Access Token"
                    className="flex-1 px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={isBusy}
                    className="px-4 py-2 font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Verify &amp; Connect Drive
                  </button>
                </div>
              </form>

              {/* Section B: Google Cloud Service Account JSON Key (RS256 JWT Exchange) */}
              <form
                onSubmit={handleServiceAccountSubmit}
                className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-slate-100">
                      2. Google Cloud Service Account JSON Key (Headless Harness / Agent Mode)
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Signs an RS256 JWT assertion on the Express bridge (/api/auth/service-account) and exchanges it for a live Google Drive Bearer token with zero browser popups.
                    </p>
                  </div>
                  <label className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer shrink-0">
                    <span>Load .json Key File</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={handleServiceAccountFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <textarea
                  id="settings-service-account-json"
                  rows={4}
                  value={serviceAccountJson}
                  onChange={(e) => setServiceAccountJson(e.target.value)}
                  placeholder='{"type": "service_account", "project_id": "...", "private_key": "-----BEGIN PRIVATE KEY-----\n...", "client_email": "...@...iam.gserviceaccount.com"}'
                  className="w-full p-3 font-mono text-[11px] bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isBusy}
                    className="px-4 py-2 font-semibold text-white bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 rounded-lg transition-colors cursor-pointer"
                  >
                    Authenticate Service Account
                  </button>
                </div>
              </form>

              {/* Section C: OAuth 2.0 Refresh Token Exchange */}
              <form
                onSubmit={handleRefreshTokenSubmit}
                className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3"
              >
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100">
                    3. OAuth 2.0 Refresh Token Exchange (/api/auth/refresh-token)
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Exchange a long-lived OAuth 2.0 Refresh Token for a volatile Google Drive access token.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="text"
                    value={refreshClientId}
                    onChange={(e) => setRefreshClientId(e.target.value)}
                    placeholder="OAuth Client ID"
                    className="px-3 py-2 font-mono text-[11px] bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                  <input
                    type="password"
                    value={refreshClientSecret}
                    onChange={(e) => setRefreshClientSecret(e.target.value)}
                    placeholder="OAuth Client Secret"
                    className="px-3 py-2 font-mono text-[11px] bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                  <input
                    type="password"
                    value={refreshTokenValue}
                    onChange={(e) => setRefreshTokenValue(e.target.value)}
                    placeholder="Refresh Token (1//04...)"
                    className="px-3 py-2 font-mono text-[11px] bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isBusy}
                    className="px-4 py-2 font-semibold text-white bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 rounded-lg transition-colors cursor-pointer"
                  >
                    Exchange Refresh Token
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 3: STREAM & LRU CACHE ENGINE SETTINGS */}
          {activeTab === 'engine' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                  <label
                    htmlFor="settings-lru-ceiling"
                    className="block font-bold text-slate-900 dark:text-slate-100"
                  >
                    Volatile LRU Memory Ceiling
                  </label>
                  <select
                    id="settings-lru-ceiling"
                    value={settings.lruCacheMaxMb}
                    onChange={(e) => {
                      const mb = Number(e.target.value) as PluginSettings['lruCacheMaxMb'];
                      onUpdateSettings({ lruCacheMaxMb: mb });
                      showToast(`Updated LRU Cache ceiling to ${mb} MB.`);
                    }}
                    className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {[32, 64, 128, 256, 512, 1024].map((mb) => (
                      <option key={mb} value={mb}>
                        {mb} MB RAM Allocation
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Controls maximum in-memory byte capacity before least-recently-used Drive files are evicted.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                  <label
                    htmlFor="settings-chunk-size"
                    className="block font-bold text-slate-900 dark:text-slate-100"
                  >
                    Stream Chunk Frame Size
                  </label>
                  <select
                    id="settings-chunk-size"
                    value={settings.chunkSizeKb}
                    onChange={(e) => {
                      const kb = Number(e.target.value) as PluginSettings['chunkSizeKb'];
                      onUpdateSettings({ chunkSizeKb: kb });
                      showToast(`Updated stream chunk frame size to ${kb} KB.`);
                    }}
                    className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {[16, 32, 64, 128, 256].map((kb) => (
                      <option key={kb} value={kb}>
                        {kb} KB per Chunk Frame
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Used for deterministic CRC-32 frame slicing during multipart uploads and stream inspection.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                  <label
                    htmlFor="settings-auto-sync"
                    className="block font-bold text-slate-900 dark:text-slate-100"
                  >
                    Automatic Delta-Sync Polling (changes.list)
                  </label>
                  <select
                    id="settings-auto-sync"
                    value={settings.autoSyncIntervalSec}
                    onChange={(e) => {
                      const sec = Number(e.target.value) as PluginSettings['autoSyncIntervalSec'];
                      onUpdateSettings({ autoSyncIntervalSec: sec });
                      showToast(
                        sec === 0
                          ? 'Disabled background delta-sync polling.'
                          : `Enabled automatic delta-sync polling every ${sec}s.`
                      );
                    }}
                    className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    <option value={0}>Manual Poll Only (Off)</option>
                    <option value={15}>Every 15 Seconds (Real-Time)</option>
                    <option value={30}>Every 30 Seconds</option>
                    <option value={60}>Every 60 Seconds</option>
                  </select>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Automatically polls Google Drive changes.list and invalidates stale MD5 keys in the LRU cache.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                  <label
                    htmlFor="settings-page-size"
                    className="block font-bold text-slate-900 dark:text-slate-100"
                  >
                    Drive List Fetch Batch Size (pageSize)
                  </label>
                  <select
                    id="settings-page-size"
                    value={settings.pageSize}
                    onChange={(e) => {
                      const size = Number(e.target.value) as PluginSettings['pageSize'];
                      onUpdateSettings({ pageSize: size });
                      showToast(`Updated Drive list fetch batch size to ${size} files.`);
                    }}
                    className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {[15, 30, 50, 100].map((sz) => (
                      <option key={sz} value={sz}>
                        {sz} Files per Query
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Maximum number of file metadata records retrieved per Google Drive v3 list request.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: WORKSPACE & HARNESS BRIDGE SETTINGS */}
          {activeTab === 'bridge' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                  <label
                    htmlFor="settings-default-folder"
                    className="block font-bold text-slate-900 dark:text-slate-100"
                  >
                    Default Target Mount Directory
                  </label>
                  <input
                    id="settings-default-folder"
                    type="text"
                    value={settings.defaultFolderPath}
                    onChange={(e) => onUpdateSettings({ defaultFolderPath: e.target.value })}
                    className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Default virtual mount directory assigned to newly uploaded harness artifacts.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    Workspace Appearance
                  </div>
                  <button
                    type="button"
                    onClick={onToggleTheme}
                    className="w-full px-3 py-2 font-semibold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    Switch to {isDark ? 'Light Mode' : 'Dark Mode'}
                  </button>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Synchronizes workspace surfaces and D3.js P99 chart palette.
                  </p>
                </div>
              </div>

              {/* Active Session & Maintenance Actions */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    Session &amp; Volatile Memory Controls
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    {user
                      ? `Connected: ${user.email} (${user.authMethod || 'OAUTH'})`
                      : 'Currently operating in Local Harness Sandbox mode'}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onPurgeCache();
                      showToast('Purged all hydrated keys from volatile LRU cache.');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    <span>Purge LRU Cache</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onUpdateSettings(DEFAULT_PLUGIN_SETTINGS);
                      showToast('Reset plugin settings to defaults.');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Reset Defaults</span>
                  </button>

                  {user && (
                    <button
                      type="button"
                      onClick={() => {
                        onLogout();
                        showToast('Signed out and cleared volatile access token.');
                      }}
                      className="px-3 py-2 font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg cursor-pointer"
                    >
                      Sign Out
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: AUTONOMOUS DESKTOP & CONNECTED HARNESS OTA AUTO-UPDATER */}
          {activeTab === 'updates' && (
            <div className="space-y-4">
              {/* Live Runtime Version & Zero-Touch Auto-Update Status Banner */}
              <div className="p-4 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/80 rounded-xl flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="font-bold text-slate-900 dark:text-slate-100">
                      Active Build: v{currentVersion} ({currentBuildHash})
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-600 text-white font-semibold uppercase">
                      {settings.autoUpdateChannel}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                    <span>Status: {updateStatus}</span>
                    <span aria-hidden="true" className="mx-1.5">·</span>
                    <span>Last Checked: {lastUpdateCheckAt}</span>
                    <span aria-hidden="true" className="mx-1.5">·</span>
                    <span>
                      Desktop Service Worker: {swRegistered ? 'Active (SkipWaiting)' : 'Standby'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isDesktopInstallable && !isDesktopInstalled && onInstallDesktopApp && (
                    <button
                      type="button"
                      onClick={() => void onInstallDesktopApp()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Install Desktop App</span>
                    </button>
                  )}
                  {onCheckForUpdatesNow && (
                    <button
                      type="button"
                      onClick={async () => {
                        const rel = await onCheckForUpdatesNow();
                        showToast(
                          rel
                            ? `Verified server release v${rel.version} (${rel.buildHash}).`
                            : 'Checked OTA update server.'
                        );
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          updateStatus === 'CHECKING' ? 'animate-spin' : ''
                        }`}
                      />
                      <span>Check for Updates Now</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Autonomous Auto-Update Policy Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="toggle-desktop-autoupdate"
                      className="font-bold text-slate-900 dark:text-slate-100"
                    >
                      Auto-Update User Desktop &amp; Web Runtime
                    </label>
                    <input
                      id="toggle-desktop-autoupdate"
                      type="checkbox"
                      checked={settings.autoUpdateEnabled}
                      onChange={(e) => {
                        onUpdateSettings({ autoUpdateEnabled: e.target.checked });
                        showToast(
                          e.target.checked
                            ? 'Enabled autonomous zero-touch Desktop OTA updates.'
                            : 'Switched Desktop updates to manual confirmation.'
                        );
                      }}
                      className="w-4 h-4 accent-blue-600 cursor-pointer"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    When enabled, pushed updates automatically hot-swap the Service Worker asset cache and runtime in user desktop instances without manual intervention.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="toggle-harness-autoupdate"
                      className="font-bold text-slate-900 dark:text-slate-100"
                    >
                      Auto-Update Connected Harness &amp; Host Software
                    </label>
                    <input
                      id="toggle-harness-autoupdate"
                      type="checkbox"
                      checked={settings.autoUpdateHarnessPlugin}
                      onChange={(e) => {
                        onUpdateSettings({ autoUpdateHarnessPlugin: e.target.checked });
                        showToast(
                          e.target.checked
                            ? 'Enabled autonomous Harness Plugin hot-update notifications.'
                            : 'Paused Harness Plugin auto-update broadcast.'
                        );
                      }}
                      className="w-4 h-4 accent-blue-600 cursor-pointer"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Automatically emits <code className="font-mono">plugin.autoUpdate</code> JSON-RPC frames over <code className="font-mono">window.parent.postMessage</code> and SSE to connected Harness hosts.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                  <label
                    htmlFor="settings-update-channel"
                    className="block font-bold text-slate-900 dark:text-slate-100"
                  >
                    OTA Release Channel
                  </label>
                  <select
                    id="settings-update-channel"
                    value={settings.autoUpdateChannel}
                    onChange={(e) => {
                      const ch = e.target.value as UpdateChannel;
                      onUpdateSettings({ autoUpdateChannel: ch });
                      showToast(`Switched OTA release channel to ${ch.toUpperCase()}.`);
                    }}
                    className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    <option value="stable">Stable (Production Desktop &amp; Harness)</option>
                    <option value="rapid">Rapid (Continuous Hot-Swap)</option>
                    <option value="canary">Canary (Bleeding-Edge Builds)</option>
                  </select>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                  <label
                    htmlFor="settings-update-interval"
                    className="block font-bold text-slate-900 dark:text-slate-100"
                  >
                    Background Version Drift Poll (Plus Instant SSE Push)
                  </label>
                  <select
                    id="settings-update-interval"
                    value={settings.autoUpdateCheckIntervalSec}
                    onChange={(e) => {
                      const sec = Number(
                        e.target.value
                      ) as PluginSettings['autoUpdateCheckIntervalSec'];
                      onUpdateSettings({ autoUpdateCheckIntervalSec: sec });
                      showToast(`Updated background OTA version check interval to ${sec}s.`);
                    }}
                    className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    <option value={15}>Every 15 Seconds + Real-Time SSE Stream</option>
                    <option value={30}>Every 30 Seconds + Real-Time SSE Stream</option>
                    <option value={60}>Every 60 Seconds + Real-Time SSE Stream</option>
                  </select>
                </div>
              </div>

              {/* Live OTA Release Publisher (Push Update to Desktop & Connected Harness) */}
              {onPushSoftwareUpdateOta && (
                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <Rocket className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <span>Push Live Software Update (Broadcast to User Desktops &amp; Connected Harness)</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Publishes a new build over <code className="font-mono">/api/system/push-update</code> and <code className="font-mono">/api/sync/stream</code> so all connected desktops and Harness plugins auto-update on their own.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label
                        htmlFor="ota-bump-select"
                        className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
                      >
                        Version Increment
                      </label>
                      <select
                        id="ota-bump-select"
                        value={otaBumpType}
                        onChange={(e) => setOtaBumpType(e.target.value as 'patch' | 'minor')}
                        className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                      >
                        <option value="patch">Patch Release (+0.0.1)</option>
                        <option value="minor">Minor Release (+0.1.0)</option>
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label
                        htmlFor="ota-changelog-input"
                        className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
                      >
                        Release Notes / Changelog Entry
                      </label>
                      <input
                        id="ota-changelog-input"
                        type="text"
                        value={otaReleaseNote}
                        onChange={(e) => setOtaReleaseNote(e.target.value)}
                        placeholder="Describe what changed in this software update..."
                        className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={isPushingOta}
                      data-testid="push-ota-update-btn"
                      onClick={async () => {
                        setIsPushingOta(true);
                        try {
                          const rel = await onPushSoftwareUpdateOta({
                            bumpType: otaBumpType,
                            channel: settings.autoUpdateChannel,
                            changelog: [
                              otaReleaseNote.trim() ||
                                'Autonomous OTA update pushed to Desktop & Harness bridge',
                            ],
                          });
                          showToast(
                            `Pushed OTA Update v${rel.version} (${rel.buildHash}) — auto-applied on Desktop & Connected Harness!`
                          );
                        } catch (err: unknown) {
                          setLocalError(
                            err instanceof Error ? err.message : 'Failed to push OTA update'
                          );
                        } finally {
                          setIsPushingOta(false);
                        }
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>
                        {isPushingOta
                          ? 'Broadcasting OTA Release...'
                          : 'Push OTA Update Now (Auto-Update Desktop & Harness)'}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Live Auto-Update History Ledger */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2.5">
                <div className="font-bold text-slate-900 dark:text-slate-100">
                  Autonomous OTA Update Ledger ({updateHistory.length})
                </div>
                {updateHistory.length === 0 ? (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Running initial release v{currentVersion} ({currentBuildHash}). Push an OTA update above or via <code className="font-mono">plugin.pushUpdate</code> RPC to watch autonomous hot-swapping in real time.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-44 overflow-y-auto">
                    {updateHistory.map((item) => (
                      <div
                        key={item.id}
                        className="p-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs space-y-1"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                            v{item.fromVersion} → v{item.toVersion} ({item.buildHash})
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {item.appliedAt.slice(11, 19)} UTC · {item.targetsUpdated.join(' + ')}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300">
                          {item.changelog[0]}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
          <div className="text-slate-500 dark:text-slate-400 font-mono">
            Chunk Frame: {settings.chunkSizeKb} KB · LRU Ceiling: {settings.lruCacheMaxMb} MB · Auto-Sync:{' '}
            {settings.autoSyncIntervalSec === 0 ? 'Off' : `${settings.autoSyncIntervalSec}s`}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
