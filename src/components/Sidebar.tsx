import React from 'react';
import { Folder, HardDrive, Upload, RefreshCw, Sun, Moon, Cpu, Settings } from 'lucide-react';
import { CacheTelemetry, DriveItem, WorkspaceView } from '../types/drive';
import { formatBytesTabular } from '../core/chunkStreamer';

interface SidebarProps {
  items: DriveItem[];
  selectedFolder: string;
  onSelectFolder: (folder: string) => void;
  cacheTelemetry: CacheTelemetry;
  onOpenUploadModal: () => void;
  onTriggerDeltaSync: () => void;
  isSyncing: boolean;
  isDark: boolean;
  onToggleTheme: () => void;
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  isLiveConnected: boolean;
  onOpenSettingsModal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  items,
  selectedFolder,
  onSelectFolder,
  cacheTelemetry,
  onOpenUploadModal,
  onTriggerDeltaSync,
  isSyncing,
  isDark,
  onToggleTheme,
  onSelectView,
  isLiveConnected,
  onOpenSettingsModal,
}) => {
  const folders = Array.from(new Set(items.map((i) => i.folderPath))).sort();
  const usagePercent = Math.min(
    100,
    Math.round((cacheTelemetry.usedBytes / Math.max(1, cacheTelemetry.maxBytes)) * 100)
  );
  const pinnedCount = items.filter((i) => i.pinnedForAgent).length;

  return (
    <aside
      aria-label="Drive Workspace Folders and Cache Controls"
      className="w-64 shrink-0 bg-white dark:bg-[#111827] border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between p-4 select-none"
    >
      <div className="space-y-5">
        {/* Primary Quick Actions */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={onOpenUploadModal}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Chunked Upload to Drive</span>
          </button>

          <button
            type="button"
            onClick={onTriggerDeltaSync}
            disabled={isSyncing}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Polling Delta Changes...' : 'Sync Drive Changes'}</span>
          </button>

          {onOpenSettingsModal && (
            <button
              type="button"
              onClick={onOpenSettingsModal}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Settings &amp; Auth Config</span>
            </button>
          )}
        </div>

        {/* Connection Source Summary (Zero-Pill Unboxed Text) */}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Data Plane Mode
            </span>
            {onOpenSettingsModal && (
              <button
                type="button"
                onClick={onOpenSettingsModal}
                className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Configure
              </button>
            )}
          </div>
          <div className="text-xs text-slate-800 dark:text-slate-200 font-medium">
            {isLiveConnected ? 'Google Drive Live OAuth' : 'Local Harness Sandbox'}
            <span aria-hidden="true" className="mx-1.5 text-slate-400">·</span>
            <span className="font-mono tabular-nums">{items.length} files</span>
          </div>
        </div>

        {/* Folder Hierarchy */}
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-200 px-2">
            Mounted Directories
          </div>
          <button
            type="button"
            onClick={() => {
              onSelectFolder('ALL');
              onSelectView(WorkspaceView.EXPLORER);
            }}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs transition-colors cursor-pointer ${
              selectedFolder === 'ALL'
                ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <span className="flex items-center gap-2 truncate">
              <HardDrive className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">All Drive Files</span>
            </span>
            <span className="font-mono tabular-nums text-[11px] opacity-80">{items.length}</span>
          </button>

          {folders.map((folder) => {
            const count = items.filter((i) => i.folderPath === folder).length;
            const active = selectedFolder === folder;
            return (
              <button
                key={folder}
                type="button"
                onClick={() => {
                  onSelectFolder(folder);
                  onSelectView(WorkspaceView.EXPLORER);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs transition-colors cursor-pointer ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <Folder className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{folder}</span>
                </span>
                <span className="font-mono tabular-nums text-[11px] opacity-80">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Agent Pinned Context Shortcut */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
          <button
            type="button"
            onClick={() => onSelectView(WorkspaceView.AGENT_STUDIO)}
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Agent Context Pinned</span>
            </span>
            <span className="font-mono tabular-nums font-semibold">{pinnedCount}</span>
          </button>
        </div>
      </div>

      {/* Bottom Memory LRU Cache Allocation & Theme Toggle */}
      <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-300">LRU Memory Cache</span>
            <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {cacheTelemetry.hitRatioPercent}% hit
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-150"
              style={{ width: `${Math.max(4, usagePercent)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            <span>{formatBytesTabular(cacheTelemetry.usedBytes)} used</span>
            <span>{formatBytesTabular(cacheTelemetry.maxBytes)} max</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Workspace Theme
          </div>
          <div
            role="group"
            aria-label="Theme Switcher"
            className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800/90 rounded-lg"
          >
            <button
              type="button"
              onClick={() => {
                if (isDark) onToggleTheme();
              }}
              aria-pressed={!isDark}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                !isDark
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              <span>Light</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isDark) onToggleTheme();
              }}
              aria-pressed={isDark}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                isDark
                  ? 'bg-slate-900 text-white shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>Dark</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
