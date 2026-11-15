import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Cpu,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  MonitorUp,
  Moon,
  RefreshCw,
  Settings,
  Sparkles,
  Sun,
  Upload,
} from 'lucide-react';
import { CacheTelemetry, DriveItem, FileCategory, WorkspaceView } from '../types/drive';
import { classifyFileCategory, formatBytesTabular } from '../core/chunkStreamer';
import {
  buildFolderTree,
  collectAllTreeFolderPaths,
  collectAncestorPaths,
  FolderTreeNode,
  matchesFolderHierarchy,
} from '../core/folderTreeEngine';

interface SidebarProps {
  items: DriveItem[];
  selectedFolder: string;
  onSelectFolder: (folder: string) => void;
  selectedFile?: DriveItem | null;
  onSelectFile?: (file: DriveItem) => void;
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
  currentVersion?: string;
  isHarnessIconCreated?: boolean;
  isScreenSharedAtSidebar?: boolean;
  onCreateHarnessPluginIcon?: () => void;
  onToggleShareScreenAtSidebar?: () => void;
}

function renderSmallFileIcon(item: DriveItem) {
  const cat = classifyFileCategory(item.mimeType, item.name);
  if (cat === FileCategory.CODE) {
    return <Code2 className="w-3 h-3 shrink-0 text-indigo-600 dark:text-indigo-400" />;
  }
  if (cat === FileCategory.SPREADSHEETS) {
    return <FileSpreadsheet className="w-3 h-3 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  }
  if (cat === FileCategory.MEDIA) {
    return <ImageIcon className="w-3 h-3 shrink-0 text-purple-600 dark:text-purple-400" />;
  }
  return <FileText className="w-3 h-3 shrink-0 text-slate-500 dark:text-slate-400" />;
}

export const Sidebar: React.FC<SidebarProps> = ({
  items,
  selectedFolder,
  onSelectFolder,
  selectedFile = null,
  onSelectFile,
  cacheTelemetry,
  onOpenUploadModal,
  onTriggerDeltaSync,
  isSyncing,
  isDark,
  onToggleTheme,
  onSelectView,
  isLiveConnected,
  onOpenSettingsModal,
  currentVersion = '2.5.0',
  isHarnessIconCreated = true,
  isScreenSharedAtSidebar = false,
  onCreateHarnessPluginIcon,
  onToggleShareScreenAtSidebar,
}) => {
  const folderTree = useMemo(() => buildFolderTree(items), [items]);
  const allFolderPaths = useMemo(() => collectAllTreeFolderPaths(folderTree), [folderTree]);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(['/Google Drive']));
  const [showFilesInTree, setShowFilesInTree] = useState<boolean>(true);

  // Automatically expand root nodes and ancestors of the currently selected folder or file
  useEffect(() => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      for (const rootNode of folderTree) {
        next.add(rootNode.fullPath);
        for (const child of rootNode.children) {
          next.add(child.fullPath);
        }
      }
      if (selectedFolder && selectedFolder !== 'ALL') {
        for (const ancestor of collectAncestorPaths(selectedFolder)) {
          next.add(ancestor);
        }
      }
      if (selectedFile?.folderPath) {
        for (const ancestor of collectAncestorPaths(selectedFile.folderPath)) {
          next.add(ancestor);
        }
      }
      return next;
    });
  }, [folderTree, selectedFolder, selectedFile?.folderPath]);

  const toggleExpandPath = (fullPath: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) {
        next.delete(fullPath);
      } else {
        next.add(fullPath);
      }
      return next;
    });
  };

  const isAllExpanded =
    allFolderPaths.length > 0 && allFolderPaths.every((p) => expandedPaths.has(p));

  const handleToggleExpandAll = () => {
    if (isAllExpanded) {
      setExpandedPaths(new Set());
    } else {
      setExpandedPaths(new Set(allFolderPaths));
    }
  };

  const usagePercent = Math.min(
    100,
    Math.round((cacheTelemetry.usedBytes / Math.max(1, cacheTelemetry.maxBytes)) * 100)
  );
  const pinnedCount = items.filter((i) => i.pinnedForAgent).length;

  const renderTreeNode = (node: FolderTreeNode): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.fullPath);
    const isExactSelected = selectedFolder === node.fullPath;
    const isAncestorOfSelected =
      selectedFolder !== 'ALL' &&
      !isExactSelected &&
      matchesFolderHierarchy(selectedFolder, node.fullPath);
    const hasExpandableContent =
      node.children.length > 0 || (showFilesInTree && node.files.length > 0);
    const indentPx = Math.min(4, node.depth) * 12;

    return (
      <div
        key={node.fullPath}
        role="treeitem"
        aria-expanded={hasExpandableContent ? isExpanded : undefined}
        aria-selected={isExactSelected}
        data-testid={`tree-folder-${node.fullPath}`}
        className="space-y-0.5"
      >
        <div
          style={{ paddingLeft: `${indentPx + 4}px` }}
          className={`group flex items-center justify-between pr-2 py-1.5 rounded-md text-xs transition-colors ${
            isExactSelected
              ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
              : isAncestorOfSelected
              ? 'bg-slate-100/80 dark:bg-slate-800/50 text-slate-900 dark:text-slate-200 font-medium'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
          }`}
        >
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {hasExpandableContent ? (
              <button
                type="button"
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`}
                data-testid={`tree-toggle-${node.fullPath}`}
                onClick={(e) => toggleExpandPath(node.fullPath, e)}
                className="p-0.5 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700/70 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0 cursor-pointer"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}

            <button
              type="button"
              onClick={() => {
                onSelectFolder(node.fullPath);
                onSelectView(WorkspaceView.EXPLORER);
                if (!isExpanded && hasExpandableContent) {
                  setExpandedPaths((prev) => new Set(prev).add(node.fullPath));
                }
              }}
              title={`${node.fullPath} (${node.totalFileCount} file${node.totalFileCount === 1 ? '' : 's'} · ${formatBytesTabular(node.totalBytes)})`}
              className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer"
            >
              {isExpanded ? (
                <FolderOpen className="w-3.5 h-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
              ) : (
                <Folder className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
              )}
              <span className="truncate">{node.name}</span>
            </button>
          </div>

          <span
            title={`${node.directFileCount} direct, ${node.totalFileCount} total in hierarchy`}
            className="font-mono tabular-nums text-[11px] opacity-80 ml-1.5 shrink-0"
          >
            {node.totalFileCount}
          </span>
        </div>

        {isExpanded && hasExpandableContent && (
          <div
            role="group"
            className="border-l border-slate-200/80 dark:border-slate-800/90 ml-3 space-y-0.5"
          >
            {node.children.map((child) => renderTreeNode(child))}

            {showFilesInTree &&
              node.files.map((file) => {
                const isFileSelected = selectedFile?.id === file.id;
                const fileIndentPx = Math.min(5, node.depth + 1) * 12;
                return (
                  <button
                    key={file.id}
                    type="button"
                    role="treeitem"
                    aria-selected={isFileSelected}
                    data-testid={`tree-file-${file.id}`}
                    style={{ paddingLeft: `${fileIndentPx + 8}px` }}
                    onClick={() => {
                      onSelectFolder(node.fullPath);
                      onSelectFile?.(file);
                      onSelectView(WorkspaceView.EXPLORER);
                    }}
                    title={`${file.name} (${formatBytesTabular(file.size)})`}
                    className={`w-full flex items-center justify-between pr-2 py-1 rounded-md text-[11px] transition-colors cursor-pointer ${
                      isFileSelected
                        ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate min-w-0">
                      {renderSmallFileIcon(file)}
                      <span className="truncate">{file.name}</span>
                    </span>
                    <span className="font-mono tabular-nums text-[10px] opacity-70 ml-1.5 shrink-0">
                      {formatBytesTabular(file.size)}
                    </span>
                  </button>
                );
              })}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      aria-label="Drive Workspace Folders and Cache Controls"
      className="w-64 shrink-0 bg-white dark:bg-[#111827] border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between p-4 select-none overflow-hidden"
    >
      <div className="flex-1 flex flex-col min-h-0 space-y-4">
        {/* Primary Quick Actions */}
        <div className="space-y-2 shrink-0">
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
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5 shrink-0">
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
            <span aria-hidden="true" className="mx-1.5 text-slate-400">
              ·
            </span>
            <span className="font-mono tabular-nums">{items.length} files</span>
          </div>
        </div>

        {/* Hierarchical Directory Tree-View */}
        <div className="flex-1 flex flex-col min-h-0 space-y-1.5">
          <div className="flex items-center justify-between px-1 shrink-0">
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-200">
              Mounted Directories
            </span>
            {allFolderPaths.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="tree-toggle-files-btn"
                  onClick={() => setShowFilesInTree((v) => !v)}
                  className="text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                  title="Toggle showing individual files inside the directory tree"
                >
                  {showFilesInTree ? 'Hide Files' : 'Show Files'}
                </button>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                  ·
                </span>
                <button
                  type="button"
                  data-testid="tree-expand-collapse-all-btn"
                  onClick={handleToggleExpandAll}
                  className="text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  {isAllExpanded ? 'Collapse' : 'Expand All'}
                </button>
              </div>
            )}
          </div>

          <div
            role="tree"
            aria-label="Google Drive Hierarchical Folder Tree"
            data-testid="sidebar-folder-tree"
            className="flex-1 overflow-y-auto pr-1 space-y-0.5"
          >
            <button
              type="button"
              role="treeitem"
              aria-selected={selectedFolder === 'ALL'}
              data-testid="tree-folder-ALL"
              onClick={() => {
                onSelectFolder('ALL');
                onSelectView(WorkspaceView.EXPLORER);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
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

            {folderTree.length === 0 ? (
              <div className="px-2.5 py-2 text-[11px] text-slate-400 dark:text-slate-500">
                Upload or sync Google Drive files to populate nested directories.
              </div>
            ) : (
              folderTree.map((rootNode) => renderTreeNode(rootNode))
            )}
          </div>
        </div>

        {/* Harness Plugin Icon & Sidebar Screen Share Controls */}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5 shrink-0">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <img src="/icon.svg" alt="" className="w-3.5 h-3.5 rounded-xs" />
              <span>Harness Plugin Bridge</span>
            </span>
            <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
              v{currentVersion} · Auto-Update
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="sidebar-create-plugin-icon-btn"
              onClick={onCreateHarnessPluginIcon}
              className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${
                isHarnessIconCreated
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/70'
                  : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
              }`}
              title="Create & register the DrivePulse plugin icon in the connected Harness activity bar"
            >
              <Sparkles className="w-3 h-3 shrink-0" />
              <span className="truncate">
                {isHarnessIconCreated ? 'Icon Created' : 'Create Icon'}
              </span>
            </button>

            <button
              type="button"
              data-testid="sidebar-share-screen-btn"
              onClick={onToggleShareScreenAtSidebar}
              aria-pressed={isScreenSharedAtSidebar}
              className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
                isScreenSharedAtSidebar
                  ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-500'
                  : 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800/70 hover:bg-blue-50 dark:hover:bg-blue-950/40'
              }`}
              title="Share DrivePulse screen at the connected Harness sidebar in real time"
            >
              <MonitorUp className="w-3 h-3 shrink-0" />
              <span className="truncate">
                {isScreenSharedAtSidebar ? 'Sharing Sidebar' : 'Share Sidebar'}
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onSelectView(WorkspaceView.AGENT_STUDIO)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
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
      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3 shrink-0">
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
