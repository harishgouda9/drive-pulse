import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AutoUpdateHistoryEntry,
  buildHarnessUpdatePostMessage,
  evaluateUpdateDecision,
  SoftwareReleaseManifest,
  UpdateChannel,
} from '../core/autoUpdateEngine';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type AutoUpdaterStatus =
  | 'UP_TO_DATE'
  | 'CHECKING'
  | 'UPDATE_AVAILABLE'
  | 'AUTO_APPLYING'
  | 'JUST_UPDATED';

interface UseAutoUpdaterOptions {
  autoUpdateEnabled: boolean;
  autoUpdateHarnessPlugin: boolean;
  channel: UpdateChannel;
  checkIntervalSec: number;
  onUpdateApplied?: (entry: AutoUpdateHistoryEntry, release: SoftwareReleaseManifest) => void;
}

export function useAutoUpdater(options: UseAutoUpdaterOptions) {
  const [currentVersion, setCurrentVersion] = useState<string>('2.5.0');
  const [currentBuildHash, setCurrentBuildHash] = useState<string>('build-250-ota-ready');
  const [latestRelease, setLatestRelease] = useState<SoftwareReleaseManifest | null>(null);
  const [pendingRelease, setPendingRelease] = useState<SoftwareReleaseManifest | null>(null);
  const [status, setStatus] = useState<AutoUpdaterStatus>('UP_TO_DATE');
  const [lastCheckedAt, setLastCheckedAt] = useState<string>('Just now');
  const [updateHistory, setUpdateHistory] = useState<AutoUpdateHistoryEntry[]>([]);
  const [swRegistered, setSwRegistered] = useState<boolean>(false);

  // Desktop PWA Install Prompt state
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isDesktopInstalled, setIsDesktopInstalled] = useState<boolean>(false);

  const currentVersionRef = useRef(currentVersion);
  const currentBuildHashRef = useRef(currentBuildHash);
  const isApplyingRef = useRef(false);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    currentVersionRef.current = currentVersion;
    currentBuildHashRef.current = currentBuildHash;
  }, [currentVersion, currentBuildHash]);

  // Register Desktop Service Worker (/sw.js) & PWA Install Listeners
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsDesktopInstalled(isStandalone);

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setIsDesktopInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => {
          setSwRegistered(true);
        })
        .catch(() => {
          setSwRegistered(false);
        });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const applyReleaseNow = useCallback(
    (
      release: SoftwareReleaseManifest,
      mode: AutoUpdateHistoryEntry['mode'] = 'AUTO_OTA_HOTSWAP'
    ) => {
      if (isApplyingRef.current) return;
      isApplyingRef.current = true;
      const prevVersion = currentVersionRef.current;
      const currentOpts = optionsRef.current;

      setStatus('AUTO_APPLYING');

      // 1. Notify connected Harness / Host Software that auto-update is in progress
      if (currentOpts.autoUpdateHarnessPlugin && typeof window !== 'undefined') {
        window.parent?.postMessage(
          buildHarnessUpdatePostMessage(release, prevVersion, 'AUTO_UPDATING'),
          '*'
        );
      }

      // 2. Instruct Desktop Service Worker to hot-swap cache and skipWaiting
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.controller?.postMessage({
          type: 'APPLY_OTA_UPDATE',
          version: release.version,
          buildHash: release.buildHash,
        });
        navigator.serviceWorker.getRegistration().then((reg) => {
          reg?.update().catch(() => {});
        });
      }

      // 3. Complete zero-downtime hot-swap and notify Harness + Desktop UI
      window.setTimeout(() => {
        currentVersionRef.current = release.version;
        currentBuildHashRef.current = release.buildHash;
        setCurrentVersion(release.version);
        setCurrentBuildHash(release.buildHash);
        setLatestRelease(release);
        setPendingRelease(null);
        setStatus('JUST_UPDATED');
        setLastCheckedAt(new Date().toISOString().slice(11, 19) + ' UTC');

        const historyEntry: AutoUpdateHistoryEntry = {
          id: `ota-${Date.now().toString(36)}`,
          fromVersion: prevVersion,
          toVersion: release.version,
          buildHash: release.buildHash,
          channel: release.channel,
          appliedAt: new Date().toISOString(),
          mode,
          targetsUpdated: ['Desktop PWA Runtime', 'Connected Harness Plugin', 'MCP JSON-RPC Bridge'],
          changelog: release.changelog,
        };

        setUpdateHistory((prev) => [historyEntry, ...prev].slice(0, 25));

        const latestOpts = optionsRef.current;
        if (latestOpts.autoUpdateHarnessPlugin && typeof window !== 'undefined') {
          window.parent?.postMessage(
            buildHarnessUpdatePostMessage(release, prevVersion, 'AUTO_APPLIED'),
            '*'
          );
        }

        latestOpts.onUpdateApplied?.(historyEntry, release);
        isApplyingRef.current = false;

        window.setTimeout(() => {
          setStatus((s) => (s === 'JUST_UPDATED' ? 'UP_TO_DATE' : s));
        }, 4500);
      }, 450);
    },
    []
  );

  // Ingest a release manifest from either SSE stream or HTTP version poll
  const ingestRemoteRelease = useCallback(
    (
      remoteRelease: SoftwareReleaseManifest,
      sourceMode: AutoUpdateHistoryEntry['mode'] = 'AUTO_OTA_HOTSWAP'
    ) => {
      if (!remoteRelease || !remoteRelease.version) return;
      setLatestRelease(remoteRelease);
      setLastCheckedAt(new Date().toISOString().slice(11, 19) + ' UTC');

      const currentOpts = optionsRef.current;
      const decision = evaluateUpdateDecision({
        currentVersion: currentVersionRef.current,
        currentBuildHash: currentBuildHashRef.current,
        remoteRelease,
        autoUpdateEnabled: currentOpts.autoUpdateEnabled,
        autoUpdateHarnessPlugin: currentOpts.autoUpdateHarnessPlugin,
      });

      if (!decision.updateAvailable) {
        if (!isApplyingRef.current) {
          setStatus((prev) => (prev === 'JUST_UPDATED' ? prev : 'UP_TO_DATE'));
        }
        return;
      }

      if (decision.shouldAutoApplyDesktop) {
        applyReleaseNow(remoteRelease, sourceMode);
      } else {
        setPendingRelease(remoteRelease);
        setStatus('UPDATE_AVAILABLE');
        if (decision.shouldAutoNotifyHarness && typeof window !== 'undefined') {
          window.parent?.postMessage(
            buildHarnessUpdatePostMessage(
              remoteRelease,
              currentVersionRef.current,
              'UPDATE_AVAILABLE'
            ),
            '*'
          );
        }
      }
    },
    [applyReleaseNow]
  );

  // Explicit check against GET /api/system/version
  const checkForUpdatesNow = useCallback(async () => {
    if (!isApplyingRef.current) {
      setStatus((prev) => (prev === 'JUST_UPDATED' ? prev : 'CHECKING'));
    }
    try {
      const res = await fetch('/api/system/version', {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.release) {
        ingestRemoteRelease(data.release as SoftwareReleaseManifest, 'AUTO_OTA_HOTSWAP');
        return data.release as SoftwareReleaseManifest;
      }
    } catch {
      // Ignore transient offline error
    } finally {
      if (!isApplyingRef.current) {
        setStatus((prev) => (prev === 'CHECKING' ? 'UP_TO_DATE' : prev));
      }
    }
    return null;
  }, [ingestRemoteRelease]);

  // Push a new OTA software update to the server (which broadcasts to all desktops & connected harnesses)
  const pushSoftwareUpdateOta = useCallback(
    async (params?: {
      version?: string;
      bumpType?: 'patch' | 'minor';
      channel?: UpdateChannel;
      changelog?: string[];
      critical?: boolean;
    }) => {
      const res = await fetch('/api/system/push-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: params?.version,
          bumpType: params?.bumpType || 'patch',
          channel: params?.channel || options.channel,
          changelog: params?.changelog,
          critical: params?.critical ?? false,
        }),
      });
      if (!res.ok) {
        throw new Error(`Failed to push OTA update (${res.status})`);
      }
      const data = await res.json();
      if (data?.release) {
        ingestRemoteRelease(data.release as SoftwareReleaseManifest, 'AUTO_OTA_HOTSWAP');
      }
      return data.release as SoftwareReleaseManifest;
    },
    [ingestRemoteRelease, options.channel]
  );

  // Background polling loop for desktop & Harness version drift
  useEffect(() => {
    void checkForUpdatesNow();
    const intervalMs = Math.max(10, options.checkIntervalSec || 15) * 1000;
    const timer = window.setInterval(() => {
      void checkForUpdatesNow();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [checkForUpdatesNow, options.checkIntervalSec]);

  const installDesktopApp = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsDesktopInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  }, [deferredPrompt]);

  return {
    currentVersion,
    currentBuildHash,
    latestRelease,
    pendingRelease,
    status,
    lastCheckedAt,
    updateHistory,
    swRegistered,
    isDesktopInstallable: Boolean(deferredPrompt),
    isDesktopInstalled,
    installDesktopApp,
    checkForUpdatesNow,
    applyReleaseNow,
    ingestRemoteRelease,
    pushSoftwareUpdateOta,
  };
}
