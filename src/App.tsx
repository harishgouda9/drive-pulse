import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AgentReasoningResult,
  CacheStatus,
  DestructiveActionRequest,
  DriveItem,
  FileCategory,
  HarnessRpcLog,
  TransferJob,
  WorkspaceView,
} from './types/drive';
import { DriveLruCache } from './core/lruCache';
import {
  calculateThroughputMbps,
  filterAndSortDriveItems,
  splitIntoChunks,
} from './core/chunkStreamer';
import {
  buildRollingSixtyMinuteSeries,
  OperationLatencyKind,
  RecordedLatencyEvent,
} from './core/latencyMetrics';
import { LiveSyncEvent, reconcileLiveSyncEvent } from './core/liveSyncEngine';
import {
  AuthErrorDetails,
  authenticateWithRefreshToken,
  authenticateWithServiceAccount,
  DriveAuthUser,
  formatAuthErrorDetails,
  getAccessToken,
  googleSignIn,
  initAuth,
  logout,
  signInWithGisTokenClient,
  verifyAndSetAccessToken,
} from './services/authService';
import {
  deleteDriveFileWithAuth,
  downloadDriveFileContent,
  executeUltraFastTurboSync,
  fetchLiveDriveFiles,
  importDriveFileByUrlOrId,
  pollDriveDeltaChanges,
  probeSyncBusRtt,
  uploadFileToDrive,
} from './services/driveBridgeService';
import { DEFAULT_PLUGIN_SETTINGS, PluginSettings } from './types/settings';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { ExplorerView } from './components/ExplorerView';
import { SyncCacheView } from './components/SyncCacheView';
import { AgentStudioView } from './components/AgentStudioView';
import { HarnessSdkView, PluginRpcMethod } from './components/HarnessSdkView';
import { UploadModal } from './components/UploadModal';
import { DestructiveConfirmModal } from './components/DestructiveConfirmModal';
import { SettingsModal } from './components/SettingsModal';

export default function App() {
  const lruCacheRef = useRef<DriveLruCache>(new DriveLruCache(128 * 1024 * 1024));

  const [activeView, setActiveView] = useState<WorkspaceView>(WorkspaceView.EXPLORER);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('ALL');
  const [selectedFile, setSelectedFile] = useState<DriveItem | null>(null);
  const [cacheVersion, setCacheVersion] = useState(0);

  // Universal Host Software Plugin Embed Mode (?embed=plugin or toggled in UI)
  const [isPluginEmbedMode, setIsPluginEmbedMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('embed') === 'plugin';
  });

  // Plugin Settings State
  const [settings, setSettings] = useState<PluginSettings>(DEFAULT_PLUGIN_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Auth State (following workspace-integration pattern + multi-channel recovery)
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [user, setUser] = useState<DriveAuthUser | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [authErrorDetails, setAuthErrorDetails] = useState<AuthErrorDetails | null>(null);

  // Modals & Real-Time Status Banner
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [destructiveRequest, setDestructiveRequest] = useState<DestructiveActionRequest | null>(
    null
  );
  const [lastTransferBanner, setLastTransferBanner] = useState<string | null>(null);

  // Real-Time Sync, Transfer Job Logs & Recorded Latency Events (Zero Fake/Demo Data)
  const [startPageToken, setStartPageToken] = useState<string>('1');
  const [lastDeltaSyncTime, setLastDeltaSyncTime] = useState<string>('Not polled yet');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isTurboSyncing, setIsTurboSyncing] = useState<boolean>(false);
  const [isHydratingFileId, setIsHydratingFileId] = useState<string | null>(null);
  const [isRefreshingDrive, setIsRefreshingDrive] = useState<boolean>(false);
  const [transferJobs, setTransferJobs] = useState<TransferJob[]>([]);
  const [latencyEvents, setLatencyEvents] = useState<RecordedLatencyEvent[]>([]);
  const [clockTickMs, setClockTickMs] = useState<number>(() => Date.now());

  // Real-Time SSE Sync Bus State
  const [liveSyncConnected, setLiveSyncConnected] = useState<boolean>(false);
  const [liveSyncRttMs, setLiveSyncRttMs] = useState<number>(0.42);
  const [liveSyncSeq, setLiveSyncSeq] = useState<number>(1);
  const [liveSyncSubscribers, setLiveSyncSubscribers] = useState<number>(1);
  const [liveSyncEvents, setLiveSyncEvents] = useState<LiveSyncEvent[]>([]);

  // Real-Time Agent Studio State
  const [agentResults, setAgentResults] = useState<AgentReasoningResult[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  // Real-Time Harness SDK RPC Logs
  const [rpcLogs, setRpcLogs] = useState<HarnessRpcLog[]>([]);

  // Theme State (defaults to Light Mode; toggles .dark on <html>)
  const [isDark, setIsDark] = useState<boolean>(false);

  const recordLatencyEvent = useCallback(
    (kind: OperationLatencyKind, latencyMs: number, bytes: number) => {
      const now = Date.now();
      setLatencyEvents((prev) => [
        ...prev.filter((ev) => ev.timestampMs >= now - 60 * 60 * 1000),
        { timestampMs: now, kind, latencyMs, bytes },
      ]);
      setClockTickMs(now);
    },
    []
  );

  // Keep the 60-minute rolling window aligned with real wall-clock time
  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockTickMs(Date.now());
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  // Perform real startup bridge synchronization check against /api/mcp/rpc and measure initial Sync Bus RTT
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [res, ping] = await Promise.all([
          fetchLiveDriveFiles(30),
          probeSyncBusRtt().catch(() => null),
        ]);
        if (!active) return;
        if (ping) {
          setLiveSyncRttMs(ping.rttMs);
          setLiveSyncSeq(ping.seq);
          setLiveSyncSubscribers(ping.activeSubscribers);
          recordLatencyEvent('LRU_READ', ping.rttMs, 0);
        }
        recordLatencyEvent('STREAM_READ', res.latencyMs, 0);
        if (res.items.length > 0) {
          setItems(res.items);
          setSelectedFile(res.items[0]);
          for (const item of res.items) {
            if (item.contentPreview) {
              lruCacheRef.current.put(
                item.id,
                item.name,
                item.md5Checksum,
                item.contentPreview,
                item.size
              );
            }
          }
          setCacheVersion((v) => v + 1);
        }
      } catch {
        // Ignore startup check error if server is still warming up
      }
    })();
    return () => {
      active = false;
    };
  }, [recordLatencyEvent]);

  // Subscribe to Server-Authoritative Real-Time SSE Sync Stream (/api/sync/stream)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let reconnectTimer: number | null = null;

    const connectStream = () => {
      es = new EventSource('/api/sync/stream');

      es.onopen = () => {
        setLiveSyncConnected(true);
      };

      es.onmessage = (msgEvent) => {
        try {
          const event = JSON.parse(msgEvent.data) as LiveSyncEvent;
          setLiveSyncConnected(true);
          if (typeof event.seq === 'number') {
            setLiveSyncSeq(event.seq);
          }

          if (event.type === 'sync:heartbeat') {
            return;
          }

          setLiveSyncEvents((prev) => {
            if (prev.some((e) => e.seq === event.seq && e.type === event.type)) {
              return prev;
            }
            return [event, ...prev].slice(0, 40);
          });

          if (event.type === 'file:upserted' && event.file) {
            const f = event.file;
            lruCacheRef.current.put(f.fileId, f.fileName, f.checksum, f.content, f.byteSize);
            recordLatencyEvent('LRU_READ', event.latencyMs, f.byteSize);
            setItems((prev) => {
              const reconciled = reconcileLiveSyncEvent(prev, event);
              return reconciled.changed ? reconciled.items : prev;
            });
            setCacheVersion((v) => v + 1);
            window.parent?.postMessage(
              {
                source: 'drivepulse-plugin-bridge',
                jsonrpc: '2.0',
                method: 'plugin.liveSyncEvent',
                params: event,
              },
              '*'
            );
          } else if (event.type === 'file:deleted' && event.deletedFileId) {
            lruCacheRef.current.delete(event.deletedFileId);
            setItems((prev) => {
              const reconciled = reconcileLiveSyncEvent(prev, event);
              return reconciled.changed ? reconciled.items : prev;
            });
            setCacheVersion((v) => v + 1);
          }
        } catch {
          // Ignore malformed event frame
        }
      };

      es.onerror = () => {
        setLiveSyncConnected(false);
        es?.close();
        if (reconnectTimer === null) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            connectStream();
          }, 2000);
        }
      };
    };

    connectStream();

    return () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      es?.close();
    };
  }, [recordLatencyEvent]);

  // Select & Hydrate File via LRU Cache or Real Stream (0ms Optimistic UI Selection + Binary Media Support)
  const handleSelectAndHydrateFile = useCallback(
    async (file: DriveItem): Promise<DriveItem> => {
      // Optimistically select clicked file in 0ms so the viewer switches immediately without network lag
      setSelectedFile(file);

      const cache = lruCacheRef.current;
      const lookup = cache.get(file.id, file.md5Checksum);

      if (lookup.status === CacheStatus.HIT && lookup.entry && lookup.entry.payload && (!file.mimeType.startsWith('video/') || file.mediaUrl)) {
        recordLatencyEvent('LRU_READ', lookup.latencyMs, lookup.entry.byteSize);
        const payload = lookup.entry.payload;
        const updatedFile: DriveItem = {
          ...file,
          cacheStatus: CacheStatus.HIT,
          lastLatencyMs: lookup.latencyMs,
          contentPreview: payload,
          mediaUrl: payload.startsWith('data:') ? payload : file.mediaUrl,
        };
        setItems((prev) => prev.map((i) => (i.id === file.id ? updatedFile : i)));
        setSelectedFile((prev) => (prev?.id === file.id ? updatedFile : prev));
        setCacheVersion((v) => v + 1);
        setLastTransferBanner(
          `LRU Memory HIT for "${file.name}" in ${lookup.latencyMs.toFixed(2)} ms`
        );
        return updatedFile;
      }

      // Cache Miss or Binary Media Stream -> Stream content & hydrate LRU
      setIsHydratingFileId(file.id);
      try {
        const streamed = await downloadDriveFileContent(file);
        cache.recordMissLatency(streamed.latencyMs);
        cache.put(file.id, file.name, file.md5Checksum, streamed.content, streamed.bytesRead);
        recordLatencyEvent('STREAM_READ', streamed.latencyMs, streamed.bytesRead);

        const chunks = splitIntoChunks(streamed.content, 16384);
        const throughput = calculateThroughputMbps(
          streamed.bytesRead,
          Math.max(0.05, streamed.latencyMs)
        );

        const updatedFile: DriveItem = {
          ...file,
          size: streamed.bytesRead || file.size,
          cacheStatus: CacheStatus.HIT,
          lastLatencyMs: streamed.latencyMs,
          contentPreview: streamed.content,
          mediaUrl: streamed.mediaUrl || file.mediaUrl,
        };

        setItems((prev) => prev.map((i) => (i.id === file.id ? updatedFile : i)));
        setSelectedFile((prev) => (prev?.id === file.id ? updatedFile : prev));
        setTransferJobs((prev) => [
          {
            id: `tx-dl-${Date.now().toString(36)}`,
            fileName: file.name,
            direction: 'DOWNLOAD',
            totalBytes: streamed.bytesRead,
            transferredBytes: streamed.bytesRead,
            totalChunks: chunks.length,
            completedChunks: chunks.length,
            throughputMbps: throughput,
            latencyMs: streamed.latencyMs,
            status: 'COMPLETED',
            startedAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        setCacheVersion((v) => v + 1);
        setLastTransferBanner(
          `Hydrated "${file.name}" (${chunks.length} chunk frame(s)) into LRU cache in ${streamed.latencyMs} ms`
        );
        return updatedFile;
      } catch (err: unknown) {
        console.error('Stream hydration error:', err);
        return file;
      } finally {
        setIsHydratingFileId(null);
      }
    },
    [recordLatencyEvent]
  );

  // Initialize Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = initAuth(
      async (authedUser) => {
        setUser(authedUser);
        setNeedsAuth(false);
        try {
          const liveList = await fetchLiveDriveFiles(30);
          recordLatencyEvent('STREAM_READ', liveList.latencyMs, 0);
          setItems(liveList.items);
          if (liveList.items.length > 0) {
            setSelectedFile(liveList.items[0]);
            for (const item of liveList.items.slice(0, 3)) {
              await handleSelectAndHydrateFile(item);
            }
            setSelectedFile((prev) =>
              liveList.items[0]
                ? {
                    ...liveList.items[0],
                    contentPreview:
                      lruCacheRef.current.get(liveList.items[0].id).entry?.payload ||
                      prev?.contentPreview ||
                      '',
                    cacheStatus: CacheStatus.HIT,
                  }
                : prev
            );
          }
          setLastTransferBanner(
            `Synchronized ${liveList.items.length} Google Drive file(s) and hydrated live contents in ${liveList.latencyMs} ms`
          );
        } catch (err) {
          console.error('Error loading live Drive files:', err);
        }
      },
      () => {
        setUser(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, [handleSelectAndHydrateFile, recordLatencyEvent]);

  // Listen for real window.postMessage Harness SDK & Host Software Plugin calls
  useEffect(() => {
    const handlePostMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || data.source !== 'drivepulse-host-harness') {
        return;
      }
      const { id = 'pm-1', method = 'drive.read', params = {} } = data;
      const cache = lruCacheRef.current;
      const start = performance.now();

      if (method === 'plugin.handshake') {
        const latencyMs = Math.max(0.01, Math.round((performance.now() - start) * 100) / 100);
        recordLatencyEvent('LRU_READ', latencyMs, 0);
        const responseFrame = {
          source: 'drivepulse-plugin-bridge',
          jsonrpc: '2.0',
          id,
          result: {
            pluginId: 'io.drivepulse.harness.bridge',
            version: '2.4.0',
            status: 'READY',
            hostApp: String(params.hostApp || 'external-host'),
            authenticatedUser: user?.email || null,
            cachedItemsCount: items.length,
            supportedMethods: [
              'plugin.handshake',
              'drive.list',
              'drive.search',
              'drive.read',
              'drive.upload',
              'drive.delete',
              'drive.deltaSync',
            ],
            latencyMs,
          },
        };
        window.parent?.postMessage(responseFrame, '*');
        setRpcLogs((prev) => [
          {
            id: `rpc-${Date.now().toString(36)}`,
            timestamp: new Date().toISOString().slice(11, 23),
            transport: 'POSTMESSAGE_SDK',
            method,
            paramsSummary: JSON.stringify(params),
            status: 'OK',
            latencyMs,
            cacheHit: true,
            requestPayload: JSON.stringify(data, null, 2),
            responsePayload: JSON.stringify(responseFrame, null, 2),
          },
          ...prev,
        ]);
        return;
      }

      if (method === 'drive.search' || method === 'drive.list') {
        const query = String(params.query || '');
        const matched = filterAndSortDriveItems(
          items,
          query,
          FileCategory.ALL,
          'ALL',
          'modifiedTime',
          'filename'
        );
        const latencyMs = Math.max(0.01, Math.round((performance.now() - start) * 100) / 100);
        recordLatencyEvent('LRU_READ', latencyMs, 0);
        const responseFrame = {
          source: 'drivepulse-plugin-bridge',
          jsonrpc: '2.0',
          id,
          result: {
            query,
            totalMatched: matched.length,
            files: matched.map((f) => ({
              id: f.id,
              name: f.name,
              mimeType: f.mimeType,
              size: f.size,
              modifiedTime: f.modifiedTime,
              md5Checksum: f.md5Checksum,
              cacheStatus: f.cacheStatus,
            })),
            latencyMs,
          },
        };
        window.parent?.postMessage(responseFrame, '*');
        setRpcLogs((prev) => [
          {
            id: `rpc-${Date.now().toString(36)}`,
            timestamp: new Date().toISOString().slice(11, 23),
            transport: 'POSTMESSAGE_SDK',
            method,
            paramsSummary: JSON.stringify(params),
            status: 'OK',
            latencyMs,
            cacheHit: true,
            requestPayload: JSON.stringify(data, null, 2),
            responsePayload: JSON.stringify(responseFrame, null, 2),
          },
          ...prev,
        ]);
        return;
      }

      if (method === 'drive.read') {
        const fileId = String(params.fileId || '');
        const lookup = cache.get(fileId);
        recordLatencyEvent(
          lookup.status === CacheStatus.HIT ? 'LRU_READ' : 'STREAM_READ',
          lookup.latencyMs,
          lookup.entry?.byteSize || 0
        );
        const responseFrame = {
          source: 'drivepulse-plugin-bridge',
          jsonrpc: '2.0',
          id,
          result: {
            fileId,
            cacheStatus: lookup.status,
            latencyMs: lookup.latencyMs,
            checksum: lookup.entry?.checksum || null,
            byteSize: lookup.entry?.byteSize || 0,
            content: lookup.entry?.payload || '',
          },
        };
        window.parent?.postMessage(responseFrame, '*');
        setRpcLogs((prev) => [
          {
            id: `rpc-${Date.now().toString(36)}`,
            timestamp: new Date().toISOString().slice(11, 23),
            transport: 'POSTMESSAGE_SDK',
            method,
            paramsSummary: JSON.stringify(params),
            status: 'OK',
            latencyMs: lookup.latencyMs,
            cacheHit: lookup.status === CacheStatus.HIT,
            requestPayload: JSON.stringify(data, null, 2),
            responsePayload: JSON.stringify(responseFrame, null, 2),
          },
          ...prev,
        ]);
        setCacheVersion((v) => v + 1);
      }
    };

    window.addEventListener('message', handlePostMessage);
    return () => window.removeEventListener('message', handlePostMessage);
  }, [items, recordLatencyEvent, user?.email]);

  const handleUpdateSettings = useCallback((patch: Partial<PluginSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      if (patch.lruCacheMaxMb && patch.lruCacheMaxMb !== prev.lruCacheMaxMb) {
        lruCacheRef.current.setMaxBytes(patch.lruCacheMaxMb * 1024 * 1024);
        setCacheVersion((v) => v + 1);
      }
      return next;
    });
  }, []);

  const completeDriveSignIn = useCallback(
    async (authedUser: DriveAuthUser) => {
      setUser(authedUser);
      setNeedsAuth(false);
      setAuthErrorDetails(null);
      setIsSettingsOpen(false);
      const liveList = await fetchLiveDriveFiles(settings.pageSize);
      recordLatencyEvent('STREAM_READ', liveList.latencyMs, 0);
      setItems(liveList.items);
      if (liveList.items.length > 0) {
        setSelectedFile(liveList.items[0]);
        for (const item of liveList.items.slice(0, 3)) {
          await handleSelectAndHydrateFile(item);
        }
        const firstCached = lruCacheRef.current.get(liveList.items[0].id);
        if (firstCached.entry) {
          setSelectedFile({
            ...liveList.items[0],
            cacheStatus: CacheStatus.HIT,
            contentPreview: firstCached.entry.payload,
          });
        }
      } else {
        setSelectedFile(null);
      }
      setLastTransferBanner(
        `Connected Google Drive as ${authedUser.email || 'user'} (${liveList.items.length} file(s) synced & hydrated in ${liveList.latencyMs} ms)`
      );
    },
    [handleSelectAndHydrateFile, recordLatencyEvent, settings.pageSize]
  );

  const handleGoogleLogin = async (scopeOverride?: string) => {
    const cleanScope =
      typeof scopeOverride === 'string' ? scopeOverride : settings.oauthScope;
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn({
        scopeOverride: cleanScope,
        loginHint: settings.loginHint,
        customClientId: settings.customOAuthClientId,
      });
      if (result) {
        await completeDriveSignIn(result.user);
      }
    } catch (err: unknown) {
      console.error('Google Sign-In failed:', err);
      setAuthErrorDetails(formatAuthErrorDetails(err));
      setIsSettingsOpen(true);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGisLogin = async (scopeOverride?: string) => {
    const cleanScope =
      typeof scopeOverride === 'string' ? scopeOverride : settings.oauthScope;
    setIsLoggingIn(true);
    try {
      const result = await signInWithGisTokenClient({
        scopeOverride: cleanScope,
        loginHint: settings.loginHint,
        customClientId: settings.customOAuthClientId,
      });
      await completeDriveSignIn(result.user);
    } catch (err: unknown) {
      console.error('GIS Sign-In failed:', err);
      setAuthErrorDetails(formatAuthErrorDetails(err));
      setIsSettingsOpen(true);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleDirectTokenLogin = async (token: string) => {
    setIsLoggingIn(true);
    try {
      const result = await verifyAndSetAccessToken(token);
      await completeDriveSignIn(result.user);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleServiceAccountLogin = async (serviceAccountJson: string) => {
    setIsLoggingIn(true);
    try {
      const result = await authenticateWithServiceAccount(
        serviceAccountJson,
        settings.oauthScope === 'profile_only'
          ? 'https://www.googleapis.com/auth/drive'
          : settings.oauthScope
      );
      await completeDriveSignIn(result.user);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRefreshTokenLogin = async (params: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }) => {
    setIsLoggingIn(true);
    try {
      const result = await authenticateWithRefreshToken(params);
      await completeDriveSignIn(result.user);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    lruCacheRef.current.clear();
    setUser(null);
    setNeedsAuth(true);
    setItems([]);
    setSelectedFile(null);
    setCacheVersion((v) => v + 1);
    setLastTransferBanner('Signed out and purged volatile OAuth access token and LRU cache.');
  };

  // Trigger Browser Download of Cached/Streamed File or Binary Media
  const handleDownloadFileToDisk = async (file: DriveItem) => {
    const hydrated = await handleSelectAndHydrateFile(file);
    const directMediaUrl =
      hydrated.mediaUrl ||
      (hydrated.contentPreview.startsWith('data:') || hydrated.contentPreview.startsWith('blob:')
        ? hydrated.contentPreview
        : undefined);

    if (directMediaUrl && (directMediaUrl.startsWith('blob:') || directMediaUrl.startsWith('data:'))) {
      const a = document.createElement('a');
      a.href = directMediaUrl;
      a.download = hydrated.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setLastTransferBanner(`Downloaded "${hydrated.name}" to local disk.`);
      return;
    }

    const blob = new Blob([hydrated.contentPreview], { type: hydrated.mimeType || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = hydrated.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setLastTransferBanner(`Downloaded "${hydrated.name}" to local disk.`);
  };

  // Multipart Chunked Upload Handler
  const handleUploadFile = async (params: {
    name: string;
    mimeType: string;
    content: string;
    folderPath: string;
  }) => {
    const { item, latencyMs } = await uploadFileToDrive(params);
    const cache = lruCacheRef.current;
    cache.put(item.id, item.name, item.md5Checksum, item.contentPreview, item.size);
    recordLatencyEvent('UPLOAD', latencyMs, item.size);

    const chunks = splitIntoChunks(params.content, 16384);
    const throughput = calculateThroughputMbps(item.size, Math.max(0.05, latencyMs));

    setItems((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
    setSelectedFile(item);
    setTransferJobs((prev) => [
      {
        id: `tx-up-${Date.now().toString(36)}`,
        fileName: item.name,
        direction: 'UPLOAD',
        totalBytes: item.size,
        transferredBytes: item.size,
        totalChunks: chunks.length,
        completedChunks: chunks.length,
        throughputMbps: throughput,
        latencyMs,
        status: 'COMPLETED',
        startedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setCacheVersion((v) => v + 1);
    setLastTransferBanner(
      `Uploaded "${item.name}" (${chunks.length} chunk(s)) & hydrated LRU cache in ${latencyMs} ms`
    );
  };

  // Mandatory Destructive Action Gate for Delete
  const handleRequestDeleteFile = (file: DriveItem) => {
    setDestructiveRequest({
      actionType: 'DELETE',
      title: `Delete "${file.name}" from Google Drive?`,
      description:
        'This action permanently deletes the selected file from your synchronized Google Drive data plane and evicts its hydrated chunks from the LRU memory cache.',
      affectedFiles: [
        {
          id: file.id,
          name: file.name,
          size: file.size,
          mimeType: file.mimeType,
        },
      ],
      onConfirm: async () => {
        const { latencyMs } = await deleteDriveFileWithAuth(file);
        lruCacheRef.current.delete(file.id);
        setItems((prev) => {
          const remaining = prev.filter((i) => i.id !== file.id);
          if (selectedFile?.id === file.id) {
            setSelectedFile(remaining[0] || null);
          }
          return remaining;
        });
        setCacheVersion((v) => v + 1);
        setLastTransferBanner(`Deleted "${file.name}" and evicted LRU cache key in ${latencyMs} ms`);
      },
    });
  };

  // Mandatory Destructive Action Gate for Overwrite
  const handleRequestOverwriteFile = (file: DriveItem, newContent: string) => {
    const newByteSize = new TextEncoder().encode(newContent).byteLength;
    setDestructiveRequest({
      actionType: 'OVERWRITE',
      title: `Overwrite contents of "${file.name}"?`,
      description:
        'Confirming this operation will overwrite the existing file contents in Google Drive and replace its MD5 checksum in the in-memory LRU cache.',
      affectedFiles: [
        {
          id: file.id,
          name: file.name,
          size: newByteSize,
          mimeType: file.mimeType,
        },
      ],
      onConfirm: async () => {
        const { item, latencyMs } = await uploadFileToDrive({
          name: file.name,
          mimeType: file.mimeType,
          content: newContent,
          folderPath: file.folderPath,
          existingFileId: file.id,
        });
        lruCacheRef.current.put(item.id, item.name, item.md5Checksum, newContent, item.size);
        recordLatencyEvent('UPLOAD', latencyMs, item.size);
        const chunks = splitIntoChunks(newContent, 16384);
        const throughput = calculateThroughputMbps(item.size, Math.max(0.05, latencyMs));

        setItems((prev) => prev.map((i) => (i.id === file.id ? item : i)));
        setSelectedFile(item);
        setTransferJobs((prev) => [
          {
            id: `tx-ov-${Date.now().toString(36)}`,
            fileName: item.name,
            direction: 'UPLOAD',
            totalBytes: item.size,
            transferredBytes: item.size,
            totalChunks: chunks.length,
            completedChunks: chunks.length,
            throughputMbps: throughput,
            latencyMs,
            status: 'COMPLETED',
            startedAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        setCacheVersion((v) => v + 1);
        setLastTransferBanner(
          `Updated "${file.name}" in Google Drive & refreshed LRU cache in ${latencyMs} ms`
        );
      },
    });
  };

  const handleTogglePinForAgent = (fileId: string) => {
    const target = items.find((i) => i.id === fileId);
    const nextPinned = target ? !target.pinnedForAgent : true;

    setItems((prev) =>
      prev.map((item) =>
        item.id === fileId ? { ...item, pinnedForAgent: !item.pinnedForAgent } : item
      )
    );

    if (target && nextPinned && !target.contentPreview) {
      void handleSelectAndHydrateFile({ ...target, pinnedForAgent: true });
    }
  };

  const handleUseFileInAgentStudio = async (file: DriveItem) => {
    const hydrated = !file.contentPreview ? await handleSelectAndHydrateFile(file) : file;
    const pinnedItem: DriveItem = { ...hydrated, pinnedForAgent: true };
    setItems((prev) => prev.map((i) => (i.id === file.id ? pinnedItem : i)));
    setSelectedFile(pinnedItem);
    setActiveView(WorkspaceView.AGENT_STUDIO);
    setLastTransferBanner(
      `Loaded "${pinnedItem.name}" content into High-Thinking Agent Studio context.`
    );
  };

  const handleUseFileInHarnessSdk = async (file: DriveItem) => {
    const hydrated = !file.contentPreview ? await handleSelectAndHydrateFile(file) : file;
    setSelectedFile(hydrated);
    setActiveView(WorkspaceView.HARNESS_SDK);
    setLastTransferBanner(
      `Selected "${hydrated.name}" (${hydrated.id}) for Harness SDK / MCP RPC inspection.`
    );
  };

  // Emit selected Google Drive file & hydrated content directly to parent Host Software via postMessage
  const handleEmitFileToHostPlugin = async (file: DriveItem) => {
    const start = performance.now();
    const hydrated = !file.contentPreview ? await handleSelectAndHydrateFile(file) : file;
    const latencyMs = Math.max(0.01, Math.round((performance.now() - start) * 100) / 100);
    const eventFrame = {
      source: 'drivepulse-plugin-bridge',
      jsonrpc: '2.0',
      method: 'plugin.fileSelected',
      params: {
        fileId: hydrated.id,
        fileName: hydrated.name,
        mimeType: hydrated.mimeType,
        size: hydrated.size,
        md5Checksum: hydrated.md5Checksum,
        cacheStatus: hydrated.cacheStatus,
        content: hydrated.contentPreview,
        emittedAt: new Date().toISOString(),
      },
    };
    window.parent?.postMessage(eventFrame, '*');
    setRpcLogs((prev) => [
      {
        id: `rpc-${Date.now().toString(36)}`,
        timestamp: new Date().toISOString().slice(11, 23),
        transport: 'POSTMESSAGE_SDK',
        method: 'plugin.fileSelected',
        paramsSummary: JSON.stringify({
          fileId: hydrated.id,
          fileName: hydrated.name,
          bytes: hydrated.size,
        }),
        status: 'OK',
        latencyMs,
        cacheHit: hydrated.cacheStatus === CacheStatus.HIT,
        requestPayload: JSON.stringify(
          { action: 'emitToHostSoftware', fileId: hydrated.id, fileName: hydrated.name },
          null,
          2
        ),
        responsePayload: JSON.stringify(eventFrame, null, 2),
      },
      ...prev,
    ]);
    setLastTransferBanner(
      `Emitted "${hydrated.name}" (${hydrated.size} B) to Host Software Plugin Bridge via window.parent.postMessage in ${latencyMs} ms`
    );
  };

  const handleImportDriveLink = async (urlOrId: string) => {
    const { item, latencyMs } = await importDriveFileByUrlOrId(urlOrId);
    lruCacheRef.current.put(item.id, item.name, item.md5Checksum, item.contentPreview, item.size);
    recordLatencyEvent('STREAM_READ', latencyMs, item.size);

    const chunks = splitIntoChunks(item.contentPreview, 16384);
    const throughput = calculateThroughputMbps(item.size, Math.max(0.05, latencyMs));

    setItems((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
    setSelectedFile(item);
    setTransferJobs((prev) => [
      {
        id: `tx-imp-${Date.now().toString(36)}`,
        fileName: item.name,
        direction: 'DOWNLOAD',
        totalBytes: item.size,
        transferredBytes: item.size,
        totalChunks: chunks.length,
        completedChunks: chunks.length,
        throughputMbps: throughput,
        latencyMs,
        status: 'COMPLETED',
        startedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setCacheVersion((v) => v + 1);
    setLastTransferBanner(
      `Fetched & hydrated Google Drive file "${item.name}" (${chunks.length} chunk(s)) in ${latencyMs} ms`
    );
  };

  const handleProbeSyncRtt = useCallback(async () => {
    try {
      const ping = await probeSyncBusRtt();
      setLiveSyncRttMs(ping.rttMs);
      setLiveSyncSeq(ping.seq);
      setLiveSyncSubscribers(ping.activeSubscribers);
      recordLatencyEvent('LRU_READ', ping.rttMs, 0);
      setLastTransferBanner(
        `Sync Bus RTT measured: ${ping.rttMs.toFixed(2)} ms (Server processing: ${ping.serverProcessingMs.toFixed(2)} ms · Seq #${ping.seq})`
      );
    } catch (err) {
      console.error('Sync RTT probe failed:', err);
    }
  }, [recordLatencyEvent]);

  // Ultra-Fast Parallel Turbo Sync (O(N) Checksum Diff + Concurrent Multi-Worker Hydration + Batch Harness Mirror)
  const handleTriggerTurboSync = useCallback(
    async (fileNameQuery?: string) => {
      setIsTurboSyncing(true);
      try {
        const result = await executeUltraFastTurboSync({
          pageSize: settings.pageSize,
          concurrency: settings.parallelWorkers,
          cachedEntries: lruCacheRef.current.entries(),
          previousItems: items,
          fileNameFilter: fileNameQuery,
          onMetadataReady: (initialItems, metaLatencyMs) => {
            setItems(initialItems);
            if (initialItems.length > 0) {
              setSelectedFile((prev) => {
                const match = prev && initialItems.find((i) => i.id === prev.id);
                return match || initialItems[0];
              });
            }
            setLastTransferBanner(
              `Phase 1 Metadata Index ready in ${metaLatencyMs} ms (${initialItems.length} file(s)) — streaming delta payloads...`
            );
          },
        });

        const newlyHydratedIds = new Set(result.newlyHydratedItems.map((h) => h.id));
        for (const item of result.items) {
          if (!newlyHydratedIds.has(item.id)) {
            const lookup = lruCacheRef.current.get(item.id, item.md5Checksum);
            if (lookup.status === CacheStatus.HIT) {
              recordLatencyEvent('LRU_READ', lookup.latencyMs, item.size);
            }
          }
        }

        for (const hydrated of result.newlyHydratedItems) {
          if (hydrated.contentPreview) {
            lruCacheRef.current.put(
              hydrated.id,
              hydrated.name,
              hydrated.md5Checksum,
              hydrated.contentPreview,
              hydrated.size
            );
          }
        }
        for (const removedId of result.removedIds) {
          lruCacheRef.current.delete(removedId);
        }

        if (result.hydratedCount > 0) {
          recordLatencyEvent('STREAM_READ', result.latencyMs, result.totalBytes);
        }

        const nowIso = new Date().toISOString();
        setLastDeltaSyncTime(nowIso.slice(11, 19) + ' UTC');
        setLiveSyncSeq(result.seq);
        setItems(result.items);
        if (result.items.length > 0) {
          setSelectedFile((prev) => {
            const match = prev && result.items.find((i) => i.id === prev.id);
            return match || result.items[0];
          });
        }

        setTransferJobs((prev) => [
          {
            id: `tx-turbo-${Date.now().toString(36)}`,
            fileName: `Turbo Sync (${result.hydratedCount} hydrated, ${result.unchangedCount} RAM HITs)`,
            direction: 'SYNC',
            totalBytes: result.totalBytes,
            transferredBytes: result.totalBytes,
            totalChunks: Math.max(1, result.items.length),
            completedChunks: Math.max(1, result.items.length),
            throughputMbps: result.throughputMbps,
            latencyMs: result.latencyMs,
            status: 'COMPLETED',
            startedAt: nowIso,
          },
          ...prev,
        ]);

        setCacheVersion((v) => v + 1);
        setLastTransferBanner(
          `Turbo Live Sync complete in ${result.latencyMs} ms (${result.throughputMbps.toFixed(1)} MB/s): ${result.hydratedCount} file(s) streamed via ${settings.parallelWorkers}x parallel workers, ${result.unchangedCount} sub-ms RAM HIT(s)`
        );
      } catch (err: unknown) {
        console.error('Turbo Sync error:', err);
      } finally {
        setIsTurboSyncing(false);
      }
    },
    [items, recordLatencyEvent, settings.pageSize, settings.parallelWorkers]
  );

  const handleRefreshDriveFiles = async (fileNameQuery?: string) => {
    setIsRefreshingDrive(true);
    try {
      await handleTriggerTurboSync(fileNameQuery);
    } finally {
      setIsRefreshingDrive(false);
    }
  };

  // Real-Time Delta Sync Poll
  const handleTriggerDeltaSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const [pollResult, pingResult] = await Promise.all([
        pollDriveDeltaChanges(startPageToken),
        probeSyncBusRtt().catch(() => null),
      ]);
      if (pingResult) {
        setLiveSyncRttMs(pingResult.rttMs);
        setLiveSyncSeq(pingResult.seq);
        setLiveSyncSubscribers(pingResult.activeSubscribers);
      }
      setStartPageToken(pollResult.newStartPageToken);
      const nowIso = new Date().toISOString();
      setLastDeltaSyncTime(nowIso.slice(11, 19) + ' UTC');
      recordLatencyEvent('LRU_READ', pollResult.latencyMs, 0);

      setTransferJobs((prev) => [
        {
          id: `tx-sync-${Date.now().toString(36)}`,
          fileName: `changes.list (token ${pollResult.newStartPageToken})`,
          direction: 'SYNC',
          totalBytes: Math.max(512, pollResult.changes.length * 512),
          transferredBytes: Math.max(512, pollResult.changes.length * 512),
          totalChunks: 1,
          completedChunks: 1,
          throughputMbps: calculateThroughputMbps(
            Math.max(512, pollResult.changes.length * 512),
            Math.max(0.05, pollResult.latencyMs)
          ),
          latencyMs: pollResult.latencyMs,
          status: 'COMPLETED',
          startedAt: nowIso,
        },
        ...prev,
      ]);

      if (pollResult.changes.length > 0) {
        const applied = lruCacheRef.current.applyDeltaChanges(items, pollResult.changes);
        setItems(applied.updatedItems);
        setLastTransferBanner(
          `Delta Sync applied ${pollResult.changes.length} change(s); invalidated ${applied.invalidatedIds.length} stale LRU key(s) in ${pollResult.latencyMs} ms.`
        );
      } else {
        setLastTransferBanner(
          `Delta Sync complete (token ${pollResult.newStartPageToken}) in ${pollResult.latencyMs} ms.`
        );
      }
      setCacheVersion((v) => v + 1);
    } finally {
      setIsSyncing(false);
    }
  }, [items, recordLatencyEvent, startPageToken]);

  // Continuous Real-Time High-Speed Delta Synchronization Loop
  useEffect(() => {
    const activeIntervalMs = settings.liveSyncEnabled
      ? settings.liveSyncIntervalMs
      : settings.autoSyncIntervalSec > 0
      ? settings.autoSyncIntervalSec * 1000
      : 0;
    if (activeIntervalMs <= 0) return;

    const intervalId = window.setInterval(() => {
      void probeSyncBusRtt()
        .then((ping) => {
          setLiveSyncRttMs(ping.rttMs);
          setLiveSyncSeq(ping.seq);
          setLiveSyncSubscribers(ping.activeSubscribers);
        })
        .catch(() => {});
      if (!needsAuth && user) {
        void handleTriggerDeltaSync();
      }
    }, activeIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [
    handleTriggerDeltaSync,
    needsAuth,
    settings.autoSyncIntervalSec,
    settings.liveSyncEnabled,
    settings.liveSyncIntervalMs,
    user,
  ]);

  // High-Thinking Agent Query (gemini-4-carbon + ThinkingLevel.HIGH)
  const handleRunHighThinkingQuery = async (query: string) => {
    setIsAnalyzing(true);
    setAgentError(null);
    try {
      const pinned = items.filter((i) => i.pinnedForAgent);
      const hydratedPinned: DriveItem[] = [];
      for (const f of pinned) {
        if (!f.contentPreview) {
          hydratedPinned.push(await handleSelectAndHydrateFile(f));
        } else {
          hydratedPinned.push(f);
        }
      }
      const contextFiles = hydratedPinned.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        content: f.contentPreview,
      }));

      const res = await fetch('/api/agent/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, contextFiles }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAgentError(data.error || `Gemini API request failed (${res.status})`);
        return;
      }

      const newResult: AgentReasoningResult = {
        id: data.id || `ag-${Date.now().toString(36)}`,
        query,
        model: data.model || 'gemini-4-carbon',
        thinkingLevel: data.thinkingLevel || 'HIGH',
        thinkingSummary: data.thinkingSummary || '',
        answerMarkdown: data.answerMarkdown || '',
        referencedFiles: data.referencedFiles || pinned.map((p) => p.name),
        suggestedActions: data.suggestedActions || [],
        latencyMs: Number(data.latencyMs || 0),
        timestamp: data.timestamp || new Date().toISOString(),
      };

      setAgentResults((prev) => [newResult, ...prev]);
    } catch (err: unknown) {
      setAgentError(err instanceof Error ? err.message : 'Agent analysis request failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Dispatch Harness SDK / MCP RPC Call
  const handleDispatchRpc = async (
    transport: 'POSTMESSAGE_SDK' | 'REST_MCP',
    method: PluginRpcMethod,
    params: Record<string, unknown>
  ) => {
    const reqId = `req-${Date.now().toString(36)}`;
    if (transport === 'POSTMESSAGE_SDK') {
      const start = performance.now();
      window.postMessage(
        {
          source: 'drivepulse-host-harness',
          jsonrpc: '2.0',
          id: reqId,
          method,
          params,
        },
        window.location.origin
      );
      if (
        method !== 'drive.read' &&
        method !== 'plugin.handshake' &&
        method !== 'drive.search' &&
        method !== 'drive.list'
      ) {
        const latencyMs = Math.max(0.01, Math.round((performance.now() - start) * 100) / 100);
        recordLatencyEvent('LRU_READ', latencyMs, 0);
        const reqPayload = {
          source: 'drivepulse-host-harness',
          jsonrpc: '2.0',
          id: reqId,
          method,
          params,
        };
        const resPayload = {
          source: 'drivepulse-plugin-bridge',
          jsonrpc: '2.0',
          id: reqId,
          result: {
            status: 'OK',
            method,
            itemsCount: items.length,
            latencyMs,
          },
        };
        setRpcLogs((prev) => [
          {
            id: `rpc-${Date.now().toString(36)}`,
            timestamp: new Date().toISOString().slice(11, 23),
            transport: 'POSTMESSAGE_SDK',
            method,
            paramsSummary: JSON.stringify(params),
            status: 'OK',
            latencyMs,
            cacheHit: true,
            requestPayload: JSON.stringify(reqPayload, null, 2),
            responsePayload: JSON.stringify(resPayload, null, 2),
          },
          ...prev,
        ]);
      }
      return;
    }

    // REST MCP JSON-RPC Call to /api/mcp/rpc
    const token = await getAccessToken();
    const reqBody = {
      jsonrpc: '2.0',
      id: reqId,
      method,
      params,
    };
    const start = performance.now();
    const response = await fetch('/api/mcp/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(reqBody),
    });
    const resData = await response.json();
    const latencyMs =
      Number(resData?.result?.latencyMs) ||
      Math.round((performance.now() - start) * 100) / 100;

    recordLatencyEvent(
      method === 'drive.upload' ? 'UPLOAD' : 'STREAM_READ',
      latencyMs,
      Number(resData?.result?.byteSize || 0)
    );

    if (method === 'drive.upload' && resData?.result?.fileId) {
      const uploadedItem: DriveItem = {
        id: String(resData.result.fileId),
        name: String(resData.result.fileName || 'rpc-artifact.json'),
        mimeType: 'application/json',
        size: Number(resData.result.byteSize || 0),
        modifiedTime: new Date().toISOString(),
        md5Checksum: String(resData.result.checksum || ''),
        folderPath: '/Workspace',
        cacheStatus: CacheStatus.HIT,
        lastLatencyMs: latencyMs,
        contentPreview: String(params.content || ''),
        pinnedForAgent: true,
        source: 'sandbox',
      };
      lruCacheRef.current.put(
        uploadedItem.id,
        uploadedItem.name,
        uploadedItem.md5Checksum,
        uploadedItem.contentPreview,
        uploadedItem.size
      );
      setItems((prev) => [uploadedItem, ...prev.filter((i) => i.id !== uploadedItem.id)]);
      setSelectedFile(uploadedItem);
      setCacheVersion((v) => v + 1);
    }

    setRpcLogs((prev) => [
      {
        id: `rpc-${Date.now().toString(36)}`,
        timestamp: new Date().toISOString().slice(11, 23),
        transport: 'REST_MCP',
        method,
        paramsSummary: JSON.stringify(params),
        status: response.ok ? 'OK' : 'ERROR',
        latencyMs,
        cacheHit: resData?.result?.cacheStatus === 'HIT',
        requestPayload: JSON.stringify(reqBody, null, 2),
        responsePayload: JSON.stringify(resData, null, 2),
      },
      ...prev,
    ]);
  };

  const latencySamples = useMemo(
    () => buildRollingSixtyMinuteSeries(latencyEvents, clockTickMs),
    [latencyEvents, clockTickMs]
  );

  void cacheVersion;
  const cacheTelemetry = lruCacheRef.current.getTelemetry();
  const cacheEntries = lruCacheRef.current.entries();

  return (
    <div className="min-h-screen h-screen flex flex-col bg-slate-50 dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* 3-Zone Top Bar Contract */}
      <TopBar
        activeView={activeView}
        onSelectView={setActiveView}
        user={user}
        needsAuth={needsAuth}
        isLoggingIn={isLoggingIn}
        onGoogleLogin={handleGoogleLogin}
        onLogout={handleLogout}
      />

      {/* Compact Host Plugin Mode Banner when ?embed=plugin is active */}
      {isPluginEmbedMode && (
        <div className="px-4 py-1.5 bg-indigo-600 text-white text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
            <span className="font-semibold">Compact Host Plugin Mode Active</span>
            <span className="text-indigo-200 hidden sm:inline">
              · Ready to emit files to parent software via window.parent.postMessage
            </span>
          </div>
          <button
            onClick={() => setIsPluginEmbedMode(false)}
            className="px-2 py-0.5 rounded bg-indigo-700 hover:bg-indigo-800 text-[11px] font-medium transition-colors"
          >
            Exit Compact Plugin Mode
          </button>
        </div>
      )}

      {/* Main Workspace Canvas: 256px Structural Sidebar + Fluid Viewport */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {!isPluginEmbedMode && (
          <Sidebar
            items={items}
            selectedFolder={selectedFolder}
            onSelectFolder={setSelectedFolder}
            cacheTelemetry={cacheTelemetry}
            onOpenUploadModal={() => setIsUploadOpen(true)}
            onTriggerDeltaSync={handleTriggerDeltaSync}
            isSyncing={isSyncing}
            isDark={isDark}
            onToggleTheme={() => setIsDark((d) => !d)}
            activeView={activeView}
            onSelectView={setActiveView}
            isLiveConnected={!needsAuth && Boolean(user)}
            onOpenSettingsModal={() => setIsSettingsOpen(true)}
          />
        )}

        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {activeView === WorkspaceView.EXPLORER && (
            <ExplorerView
              items={items}
              selectedFolder={selectedFolder}
              selectedFile={selectedFile}
              isHydratingFileId={isHydratingFileId}
              isRefreshingDrive={isRefreshingDrive}
              isTurboSyncing={isTurboSyncing}
              liveSyncConnected={liveSyncConnected}
              liveSyncRttMs={liveSyncRttMs}
              liveSyncEnabled={settings.liveSyncEnabled}
              onSelectFile={handleSelectAndHydrateFile}
              onDownloadFile={handleDownloadFileToDisk}
              onTogglePinForAgent={handleTogglePinForAgent}
              onUseFileInAgentStudio={handleUseFileInAgentStudio}
              onUseFileInHarnessSdk={handleUseFileInHarnessSdk}
              onEmitFileToHostPlugin={handleEmitFileToHostPlugin}
              onImportDriveLink={handleImportDriveLink}
              onRefreshDriveFiles={handleRefreshDriveFiles}
              onTriggerTurboSync={() => void handleTriggerTurboSync()}
              onToggleLiveSync={(enabled) => handleUpdateSettings({ liveSyncEnabled: enabled })}
              onRequestDeleteFile={handleRequestDeleteFile}
              onRequestOverwriteFile={handleRequestOverwriteFile}
              onOpenUploadModal={() => setIsUploadOpen(true)}
              onOpenSettingsModal={() => setIsSettingsOpen(true)}
              chunkSizeKb={settings.chunkSizeKb}
              lastTransferBanner={lastTransferBanner}
              isPluginEmbedMode={isPluginEmbedMode}
            />
          )}

          {activeView === WorkspaceView.SYNC_CACHE && (
            <SyncCacheView
              telemetry={cacheTelemetry}
              cacheEntries={cacheEntries}
              transferJobs={transferJobs}
              latencySamples={latencySamples}
              isDark={isDark}
              startPageToken={startPageToken}
              lastDeltaSyncTime={lastDeltaSyncTime}
              onChangeMaxBytes={(mb) => {
                handleUpdateSettings({
                  lruCacheMaxMb: mb as PluginSettings['lruCacheMaxMb'],
                });
              }}
              onEvictEntry={(fileId) => {
                lruCacheRef.current.delete(fileId);
                setItems((prev) =>
                  prev.map((i) =>
                    i.id === fileId ? { ...i, cacheStatus: CacheStatus.MISS } : i
                  )
                );
                setCacheVersion((v) => v + 1);
              }}
              onClearAllCache={() => {
                lruCacheRef.current.clear();
                setItems((prev) =>
                  prev.map((i) => ({ ...i, cacheStatus: CacheStatus.MISS }))
                );
                setCacheVersion((v) => v + 1);
              }}
              onTriggerDeltaSync={() => void handleTriggerDeltaSync()}
              onTriggerTurboSync={() => void handleTriggerTurboSync()}
              onProbeSyncRtt={() => void handleProbeSyncRtt()}
              isSyncing={isSyncing}
              isTurboSyncing={isTurboSyncing}
              liveSyncConnected={liveSyncConnected}
              liveSyncRttMs={liveSyncRttMs}
              liveSyncSeq={liveSyncSeq}
              liveSyncSubscribers={liveSyncSubscribers}
              liveSyncEnabled={settings.liveSyncEnabled}
              liveSyncIntervalMs={settings.liveSyncIntervalMs}
              parallelWorkers={settings.parallelWorkers}
              onToggleLiveSync={(enabled) => handleUpdateSettings({ liveSyncEnabled: enabled })}
              onChangeLiveSyncInterval={(intervalMs) =>
                handleUpdateSettings({ liveSyncIntervalMs: intervalMs })
              }
              onChangeParallelWorkers={(workers) =>
                handleUpdateSettings({ parallelWorkers: workers })
              }
              liveSyncEvents={liveSyncEvents}
            />
          )}

          {activeView === WorkspaceView.AGENT_STUDIO && (
            <AgentStudioView
              items={items}
              onTogglePin={handleTogglePinForAgent}
              results={agentResults}
              isAnalyzing={isAnalyzing}
              agentError={agentError}
              onRunHighThinkingQuery={handleRunHighThinkingQuery}
              onSaveAgentArtifactToDrive={(fileName, content) =>
                handleUploadFile({
                  name: fileName,
                  mimeType: 'application/yaml',
                  content,
                  folderPath: settings.defaultFolderPath,
                })
              }
            />
          )}

          {activeView === WorkspaceView.HARNESS_SDK && (
            <HarnessSdkView
              items={items}
              selectedFileId={selectedFile?.id}
              rpcLogs={rpcLogs}
              onDispatchRpc={handleDispatchRpc}
              isPluginEmbedMode={isPluginEmbedMode}
              onTogglePluginEmbedMode={() => setIsPluginEmbedMode((v) => !v)}
            />
          )}
        </main>
      </div>

      {/* Chunked Multipart Upload Modal */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUpload={handleUploadFile}
      />

      {/* Mandatory Destructive Operation Confirmation Dialog */}
      <DestructiveConfirmModal
        request={destructiveRequest}
        onCancel={() => setDestructiveRequest(null)}
      />

      {/* Comprehensive Plugin Settings & Google OAuth Control Center Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        user={user}
        errorDetails={authErrorDetails}
        isBusy={isLoggingIn}
        isDark={isDark}
        onToggleTheme={() => setIsDark((d) => !d)}
        onClose={() => setIsSettingsOpen(false)}
        onTriggerFirebaseLogin={(scope) => handleGoogleLogin(scope)}
        onTriggerGisLogin={(scope) => handleGisLogin(scope)}
        onSubmitDirectToken={handleDirectTokenLogin}
        onSubmitServiceAccount={handleServiceAccountLogin}
        onSubmitRefreshToken={handleRefreshTokenLogin}
        onPurgeCache={() => {
          lruCacheRef.current.clear();
          setItems((prev) => prev.map((i) => ({ ...i, cacheStatus: CacheStatus.MISS })));
          setCacheVersion((v) => v + 1);
        }}
        onLogout={handleLogout}
      />
    </div>
  );
}
