import React, { useState } from 'react';
import {
  CheckCircle2,
  Folder,
  Layers,
  MonitorUp,
  RefreshCw,
  Send,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { CacheTelemetry, DriveItem } from '../types/drive';
import { formatBytesTabular } from '../core/chunkStreamer';
import { AutoUpdaterStatus } from '../hooks/useAutoUpdater';
import { AutoUpdateHistoryEntry } from '../core/autoUpdateEngine';

interface HarnessPluginDockProps {
  isIconCreated: boolean;
  isScreenSharedAtSidebar: boolean;
  onCreatePluginIcon: () => void;
  onToggleSidebarScreenShare: () => void;
  currentVersion: string;
  currentBuildHash: string;
  updateStatus: AutoUpdaterStatus;
  autoUpdateEnabled: boolean;
  updateHistory: AutoUpdateHistoryEntry[];
  onPushSelfUpdate: () => Promise<void>;
  items: DriveItem[];
  selectedFolder: string;
  selectedFile: DriveItem | null;
  onSelectFile: (file: DriveItem) => void;
  onEmitFileToHostPlugin: (file: DriveItem) => void;
  cacheTelemetry: CacheTelemetry;
  liveSyncRttMs: number;
}

export const HarnessPluginDock: React.FC<HarnessPluginDockProps> = ({
  isIconCreated,
  isScreenSharedAtSidebar,
  onCreatePluginIcon,
  onToggleSidebarScreenShare,
  currentVersion,
  currentBuildHash,
  updateStatus,
  autoUpdateEnabled,
  updateHistory,
  onPushSelfUpdate,
  items,
  selectedFolder,
  selectedFile,
  onSelectFile,
  onEmitFileToHostPlugin,
  cacheTelemetry,
  liveSyncRttMs,
}) => {
  const [isPushingUpdate, setIsPushingUpdate] = useState(false);

  if (!isIconCreated && !isScreenSharedAtSidebar) {
    return null;
  }

  const activeFile = selectedFile || items[0] || null;
  const latestUpdate = updateHistory[0] || null;

  const handleSelfUpdateClick = async () => {
    setIsPushingUpdate(true);
    try {
      await onPushSelfUpdate();
    } finally {
      setIsPushingUpdate(false);
    }
  };

  return (
    <div
      aria-label="Host Harness Plugin Icon and Shared Sidebar Screen"
      data-testid="harness-plugin-dock-container"
      className="flex h-full shrink-0 select-none"
    >
      {/* Shared Sidebar Screen Panel inside Host Harness */}
      {isScreenSharedAtSidebar && (
        <aside
          aria-label="DrivePulse Shared Sidebar Screen in Host Harness"
          data-testid="harness-sidebar-screen-panel"
          className="w-80 bg-white dark:bg-[#111827] border-l border-slate-200 dark:border-slate-800 flex flex-col justify-between overflow-hidden shadow-lg"
        >
          {/* Top Header: Plugin Identity + Live Auto-Update Status */}
          <div className="p-3.5 bg-slate-900 text-white border-b border-slate-800 space-y-2.5 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src="/icon.svg"
                  alt="DrivePulse Plugin Icon"
                  className="w-6 h-6 rounded-md shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-xs font-bold tracking-tight truncate flex items-center gap-1.5">
                    <span>DrivePulse Harness Sidebar</span>
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <div className="text-[10px] font-mono text-slate-300 truncate">
                    v{currentVersion} ({currentBuildHash}) · Auto-Update{' '}
                    {autoUpdateEnabled ? 'ON' : 'OFF'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onToggleSidebarScreenShare}
                aria-label="Close shared sidebar screen"
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Live Screen-Share & Autonomous Self-Update Bar */}
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800 text-[11px]">
              <span className="inline-flex items-center gap-1 text-emerald-300 font-mono">
                <MonitorUp className="w-3 h-3" />
                <span>Screen Shared at Sidebar</span>
              </span>

              <button
                type="button"
                disabled={isPushingUpdate}
                data-testid="dock-push-self-update-btn"
                onClick={handleSelfUpdateClick}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold text-[10px] transition-colors cursor-pointer disabled:opacity-50"
                title="Push an OTA update and watch this installed Harness plugin auto-update itself"
              >
                <RefreshCw
                  className={`w-2.5 h-2.5 ${
                    isPushingUpdate || updateStatus === 'AUTO_APPLYING' ? 'animate-spin' : ''
                  }`}
                />
                <span>
                  {isPushingUpdate || updateStatus === 'AUTO_APPLYING'
                    ? 'Self-Updating...'
                    : 'Push Update (Auto-Update)'}
                </span>
              </button>
            </div>

            {(updateStatus === 'JUST_UPDATED' || latestUpdate) && (
              <div
                data-testid="dock-self-update-banner"
                className="px-2.5 py-1.5 rounded-md bg-emerald-950/90 border border-emerald-700/70 text-emerald-200 text-[10px] font-mono flex items-center gap-1.5"
              >
                <Sparkles className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="truncate">
                  {latestUpdate
                    ? `Plugin Self-Updated: v${latestUpdate.fromVersion} → v${latestUpdate.toVersion}`
                    : `Plugin Active on v${currentVersion}`}
                </span>
              </div>
            )}
          </div>

          {/* Middle Body: Mirrored Live Screen Content */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 text-xs">
            {/* Live Telemetry Strip */}
            <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono text-[11px]">
              <div>
                <div className="text-[10px] text-slate-400">Files</div>
                <div className="font-bold text-slate-900 dark:text-slate-100">{items.length}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">LRU Hit</div>
                <div className="font-bold text-emerald-600 dark:text-emerald-400">
                  {cacheTelemetry.hitRatioPercent}%
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">Sync RTT</div>
                <div className="font-bold text-blue-600 dark:text-blue-400">
                  {liveSyncRttMs.toFixed(2)} ms
                </div>
              </div>
            </div>

            {/* Active Shared Directory Scope */}
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center justify-between">
                <span>Shared Directory Scope</span>
                <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400">
                  Live Mirror
                </span>
              </div>
              <div className="px-2.5 py-1.5 rounded-md bg-slate-100 dark:bg-slate-800/80 text-slate-800 dark:text-slate-200 font-mono text-[11px] flex items-center gap-1.5 truncate">
                <Folder className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span className="truncate">
                  {selectedFolder === 'ALL' ? '/All Mounted Directories' : selectedFolder}
                </span>
              </div>
            </div>

            {/* Synchronized Drive Files in Shared Sidebar */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Shared Drive Files ({items.length})
              </div>
              {items.length === 0 ? (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
                  No files mounted yet. Upload or fetch a Google Drive file to stream it in the
                  Harness sidebar.
                </div>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto pr-0.5">
                  {items.map((item) => {
                    const isSelected = activeFile?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelectFile(item)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left text-[11px] transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold border border-blue-200 dark:border-blue-800/70'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <span className="truncate pr-2">{item.name}</span>
                        <span className="font-mono text-[10px] opacity-75 shrink-0">
                          {formatBytesTabular(item.size)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Live Streamed File Preview inside Shared Sidebar Screen */}
            {activeFile && (
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 dark:text-slate-100 truncate">
                      {activeFile.name}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
                      {activeFile.folderPath} · {formatBytesTabular(activeFile.size)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onEmitFileToHostPlugin(activeFile)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold shrink-0 cursor-pointer"
                  >
                    <Send className="w-3 h-3" />
                    <span>Emit to Host</span>
                  </button>
                </div>

                <pre className="p-2.5 rounded-lg bg-slate-950 text-slate-100 font-mono text-[10px] max-h-40 overflow-auto leading-relaxed">
                  {(activeFile.contentPreview || 'Stream ready — click to hydrate content.').slice(
                    0,
                    600
                  )}
                </pre>
              </div>
            )}
          </div>

          {/* Bottom Footer */}
          <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400 shrink-0">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              <span>Plugin Bridge Ready</span>
            </span>
            <span>v{currentVersion}</span>
          </div>
        </aside>
      )}

      {/* Host Harness Activity Bar / Plugin Icon Rail */}
      <div
        aria-label="Host Harness Activity Bar Plugin Icon Rail"
        className="w-12 bg-slate-900 text-slate-200 border-l border-slate-800 flex flex-col items-center justify-between py-3 shrink-0"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="text-[9px] font-mono uppercase tracking-wider text-slate-400 text-center leading-tight px-1">
            Host Dock
          </div>

          {/* The Created DrivePulse Plugin Icon in Host Harness */}
          <button
            type="button"
            onClick={() => {
              if (!isIconCreated) onCreatePluginIcon();
              onToggleSidebarScreenShare();
            }}
            data-testid="harness-dock-plugin-icon"
            title={`DrivePulse Plugin Icon (v${currentVersion}) — Click to ${
              isScreenSharedAtSidebar ? 'hide' : 'share'
            } screen at Harness sidebar`}
            className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
              isScreenSharedAtSidebar
                ? 'bg-blue-600 text-white ring-2 ring-blue-400 shadow-md'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
            }`}
          >
            <img src="/icon.svg" alt="DrivePulse Icon" className="w-5 h-5" />
            {/* Mounted Files Count Badge */}
            <span
              data-testid="harness-dock-icon-badge"
              className="absolute -top-1 -right-1 px-1 min-w-[16px] h-4 rounded-full bg-emerald-500 text-slate-950 font-mono font-bold text-[9px] flex items-center justify-center"
            >
              {items.length}
            </span>
          </button>

          {/* Live Version & Auto-Update Status Pill under Icon */}
          <div
            data-testid="harness-dock-icon-version"
            className="text-[9px] font-mono text-emerald-400 text-center px-1"
          >
            v{currentVersion}
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleSelfUpdateClick}
            disabled={isPushingUpdate}
            title="Trigger OTA self-update for installed Harness plugin"
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-400 flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5" />
          </button>
          <Layers className="w-3.5 h-3.5 text-slate-500" />
        </div>
      </div>
    </div>
  );
};
