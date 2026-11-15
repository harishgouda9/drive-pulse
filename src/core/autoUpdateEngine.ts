export type UpdateChannel = 'stable' | 'rapid' | 'canary';

export interface SoftwareReleaseManifest {
  version: string;
  buildHash: string;
  channel: UpdateChannel;
  publishedAt: string;
  changelog: string[];
  critical: boolean;
  autoApplyDelayMs: number;
  targets: Array<'desktop_pwa' | 'harness_plugin' | 'mcp_agent' | 'web_client'>;
}

export interface UpdateEvaluationResult {
  updateAvailable: boolean;
  reason: 'NEW_SEMVER' | 'NEW_BUILD_HASH' | 'UP_TO_DATE';
  currentVersion: string;
  targetVersion: string;
  currentBuildHash: string;
  targetBuildHash: string;
  shouldAutoApplyDesktop: boolean;
  shouldAutoNotifyHarness: boolean;
  countdownMs: number;
}

export interface AutoUpdateHistoryEntry {
  id: string;
  fromVersion: string;
  toVersion: string;
  buildHash: string;
  channel: UpdateChannel;
  appliedAt: string;
  mode: 'AUTO_OTA_HOTSWAP' | 'MANUAL_TRIGGER' | 'HARNESS_RPC_PUSH';
  targetsUpdated: string[];
  changelog: string[];
}

/**
 * Parses and compares two semantic version strings (e.g. "2.5.1" vs "2.5.0").
 * Returns 1 if vA > vB, -1 if vA < vB, or 0 if equal.
 */
export function compareSemver(vA: string, vB: string): number {
  const cleanA = String(vA || '0.0.0')
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const cleanB = String(vB || '0.0.0')
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < 3; i++) {
    const partA = cleanA[i] || 0;
    const partB = cleanB[i] || 0;
    if (partA > partB) return 1;
    if (partA < partB) return -1;
  }
  return 0;
}

/**
 * Increments the patch number of a semantic version string (e.g. "2.5.0" -> "2.5.1").
 */
export function bumpPatchVersion(version: string, bumpType: 'patch' | 'minor' = 'patch'): string {
  const parts = String(version || '2.5.0')
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((n) => parseInt(n, 10) || 0);

  const major = parts[0] || 2;
  const minor = parts[1] ?? 5;
  const patch = parts[2] ?? 0;

  if (bumpType === 'minor') {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Evaluates whether an incoming server release manifest requires an automatic desktop
 * and/or connected Harness plugin hot-swap update.
 */
export function evaluateUpdateDecision(params: {
  currentVersion: string;
  currentBuildHash: string;
  remoteRelease: SoftwareReleaseManifest;
  autoUpdateEnabled: boolean;
  autoUpdateHarnessPlugin: boolean;
}): UpdateEvaluationResult {
  const semverCmp = compareSemver(params.remoteRelease.version, params.currentVersion);
  const hashChanged =
    Boolean(params.remoteRelease.buildHash) &&
    Boolean(params.currentBuildHash) &&
    params.remoteRelease.buildHash !== params.currentBuildHash;

  if (semverCmp > 0) {
    return {
      updateAvailable: true,
      reason: 'NEW_SEMVER',
      currentVersion: params.currentVersion,
      targetVersion: params.remoteRelease.version,
      currentBuildHash: params.currentBuildHash,
      targetBuildHash: params.remoteRelease.buildHash,
      shouldAutoApplyDesktop: params.autoUpdateEnabled,
      shouldAutoNotifyHarness: params.autoUpdateHarnessPlugin,
      countdownMs: params.remoteRelease.critical
        ? 500
        : Math.max(500, params.remoteRelease.autoApplyDelayMs || 1500),
    };
  }

  if (semverCmp === 0 && hashChanged) {
    return {
      updateAvailable: true,
      reason: 'NEW_BUILD_HASH',
      currentVersion: params.currentVersion,
      targetVersion: params.remoteRelease.version,
      currentBuildHash: params.currentBuildHash,
      targetBuildHash: params.remoteRelease.buildHash,
      shouldAutoApplyDesktop: params.autoUpdateEnabled,
      shouldAutoNotifyHarness: params.autoUpdateHarnessPlugin,
      countdownMs: params.remoteRelease.critical
        ? 500
        : Math.max(500, params.remoteRelease.autoApplyDelayMs || 1500),
    };
  }

  return {
    updateAvailable: false,
    reason: 'UP_TO_DATE',
    currentVersion: params.currentVersion,
    targetVersion: params.remoteRelease.version,
    currentBuildHash: params.currentBuildHash,
    targetBuildHash: params.remoteRelease.buildHash,
    shouldAutoApplyDesktop: false,
    shouldAutoNotifyHarness: false,
    countdownMs: 0,
  };
}

/**
 * Constructs the standardized JSON-RPC 2.0 postMessage payload sent to connected
 * Harness / Host Software instances when an update is detected or auto-applied.
 */
export function buildHarnessUpdatePostMessage(
  release: SoftwareReleaseManifest,
  previousVersion: string,
  status: 'UPDATE_AVAILABLE' | 'AUTO_UPDATING' | 'AUTO_APPLIED'
) {
  return {
    source: 'drivepulse-plugin-bridge',
    jsonrpc: '2.0',
    method: 'plugin.autoUpdate',
    params: {
      pluginId: 'io.drivepulse.harness.bridge',
      status,
      previousVersion,
      version: release.version,
      buildHash: release.buildHash,
      channel: release.channel,
      critical: release.critical,
      publishedAt: release.publishedAt,
      changelog: release.changelog,
      targets: release.targets,
      emittedAt: new Date().toISOString(),
    },
  };
}

export interface HarnessPluginIconDescriptor {
  pluginId: string;
  title: string;
  tooltip: string;
  iconUrl: string;
  position: 'activity-bar-left' | 'sidebar-dock-right' | 'top-toolbar';
  badgeCount: number;
  version: string;
  buildHash: string;
  autoUpdateEnabled: boolean;
  screenShareActive: boolean;
  sidebarWidthPx: number;
  embedSidebarUrl: string;
  registeredAt: string;
}

export interface HarnessSidebarScreenPayload {
  pluginId: string;
  version: string;
  buildHash: string;
  autoUpdateStatus: string;
  activeView: string;
  selectedFolder: string;
  totalFiles: number;
  cacheHitRatioPercent: number;
  usedCacheBytes: number;
  liveSyncRttMs: number;
  activeFile: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    folderPath: string;
    cacheStatus: string;
    contentSnippet: string;
  } | null;
  emittedAt: string;
}

/**
 * Builds the JSON-RPC 2.0 frame that registers/creates the DrivePulse Plugin Icon
 * inside a connected Host Harness's activity bar or dock.
 */
export function buildHarnessRegisterIconFrame(params: {
  version: string;
  buildHash: string;
  badgeCount: number;
  autoUpdateEnabled: boolean;
  screenShareActive: boolean;
  position?: 'activity-bar-left' | 'sidebar-dock-right' | 'top-toolbar';
  originUrl?: string;
}): {
  source: 'drivepulse-plugin-bridge';
  jsonrpc: '2.0';
  method: 'plugin.registerIcon';
  params: HarnessPluginIconDescriptor;
} {
  const origin = (params.originUrl || '').replace(/\/$/, '');
  return {
    source: 'drivepulse-plugin-bridge',
    jsonrpc: '2.0',
    method: 'plugin.registerIcon',
    params: {
      pluginId: 'io.drivepulse.harness.bridge',
      title: 'DrivePulse',
      tooltip: `DrivePulse Google Drive Bridge (v${params.version} · Auto-Update ${
        params.autoUpdateEnabled ? 'ON' : 'OFF'
      })`,
      iconUrl: `${origin}/icon.svg`,
      position: params.position || 'sidebar-dock-right',
      badgeCount: Math.max(0, params.badgeCount),
      version: params.version,
      buildHash: params.buildHash,
      autoUpdateEnabled: params.autoUpdateEnabled,
      screenShareActive: params.screenShareActive,
      sidebarWidthPx: 380,
      embedSidebarUrl: `${origin}/?embed=plugin&dock=sidebar`,
      registeredAt: new Date().toISOString(),
    },
  };
}

/**
 * Builds the JSON-RPC 2.0 frame that shares/streams the live DrivePulse screen state
 * into the connected Host Harness sidebar.
 */
export function buildHarnessShareScreenFrame(payload: HarnessSidebarScreenPayload) {
  return {
    source: 'drivepulse-plugin-bridge',
    jsonrpc: '2.0',
    method: 'plugin.shareScreen',
    params: payload,
  };
}

