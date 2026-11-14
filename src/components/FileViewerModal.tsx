import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Download,
  ExternalLink,
  Copy,
  Check,
  Save,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Terminal,
  Share2,
  Zap,
  Image as ImageIcon,
  Film,
  Music,
  FileSpreadsheet,
  FileCode,
  FileText,
  Search,
  Edit3,
  ListFilter,
  Hash,
} from 'lucide-react';
import { CacheStatus, DriveItem } from '../types/drive';
import {
  buildGoogleDriveEmbedUrl,
  computeContentStats,
  detectViewerKind,
  formatBytesTabular,
  parseCsvPreviewRows,
  splitFilenameHighlight,
  upgradeDriveThumbnailUrl,
} from '../core/chunkStreamer';
import {
  buildVirtualLineItems,
  computeScrollTopForLine,
  computeVirtualWindow,
} from '../core/virtualScrollEngine';

interface FileContentRendererProps {
  file: DriveItem;
  isHydrating: boolean;
  onHydrate: (file: DriveItem) => void;
  onRequestOverwriteFile: (file: DriveItem, newContent: string) => void;
  onOpenFullScreen?: () => void;
  isFullScreenModal?: boolean;
  onToggleModalMaximize?: () => void;
  isModalMaximized?: boolean;
}

export const FileContentRenderer: React.FC<FileContentRendererProps> = ({
  file,
  isHydrating,
  onHydrate,
  onRequestOverwriteFile,
  isFullScreenModal = false,
  onToggleModalMaximize,
  isModalMaximized = false,
}) => {
  const viewerKind = detectViewerKind(file.mimeType, file.name, file.contentPreview);

  // Self-contained full-screen toggle state for the file preview component
  const [isLocalFullScreen, setIsLocalFullScreen] = useState<boolean>(false);
  const isEffectiveFullScreen = isFullScreenModal ? isModalMaximized : isLocalFullScreen;

  // Text / Code Virtualized Scrolling & Editing State
  const [textViewMode, setTextViewMode] = useState<'virtual' | 'edit'>('virtual');
  const [editingContent, setEditingContent] = useState<string | null>(null);
  const [lineSearchQuery, setLineSearchQuery] = useState<string>('');
  const [filterMatchingLinesOnly, setFilterMatchingLinesOnly] = useState<boolean>(false);
  const [jumpLineInput, setJumpLineInput] = useState<string>('');
  const [fontSizePx, setFontSizePx] = useState<number>(isFullScreenModal ? 14 : 13);
  const [wordWrap, setWordWrap] = useState<boolean>(false);

  // Virtual Scroll Viewport Measurements (Text & CSV)
  const virtualViewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState<number>(0);
  const [viewportHeight, setViewportHeight] = useState<number>(480);

  // Image Viewer State
  const [imageZoom, setImageZoom] = useState<number>(1);
  const [imageRotation, setImageRotation] = useState<number>(0);
  const [imageBgStyle, setImageBgStyle] = useState<'dark' | 'grid' | 'light'>('dark');

  // CSV & Video State
  const [csvMode, setCsvMode] = useState<'table' | 'raw'>('table');
  const [videoEmbedMode, setVideoEmbedMode] = useState<boolean>(false);

  useEffect(() => {
    setEditingContent(null);
    setImageZoom(1);
    setImageRotation(0);
    setVideoEmbedMode(false);
    setScrollTop(0);
    setLineSearchQuery('');
    setJumpLineInput('');
    if (virtualViewportRef.current) {
      virtualViewportRef.current.scrollTop = 0;
    }
  }, [file.id]);

  // Escape key exits local full-screen preview
  useEffect(() => {
    if (!isLocalFullScreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsLocalFullScreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLocalFullScreen]);

  // Measure virtualized scroll container height via ResizeObserver
  useEffect(() => {
    const el = virtualViewportRef.current;
    if (!el) return;

    const updateHeight = () => {
      if (el.clientHeight > 0) {
        setViewportHeight(el.clientHeight);
      }
    };
    updateHeight();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateHeight);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, [viewerKind, textViewMode, csvMode, isLocalFullScreen, isFullScreenModal]);

  const handleToggleFullScreen = () => {
    if (isFullScreenModal && onToggleModalMaximize) {
      onToggleModalMaximize();
    } else {
      setIsLocalFullScreen((prev) => !prev);
    }
  };

  // Resolved media source URL for images, videos, audio, and PDFs
  const resolvedMediaUrl =
    file.mediaUrl ||
    (file.contentPreview.startsWith('data:') || file.contentPreview.startsWith('blob:')
      ? file.contentPreview
      : undefined) ||
    upgradeDriveThumbnailUrl(file.thumbnailLink) ||
    file.webContentLink;

  const isSvgText =
    (file.mimeType.includes('svg') || file.name.toLowerCase().endsWith('.svg')) &&
    file.contentPreview.trim().startsWith('<svg');

  const svgDataUrl = isSvgText
    ? `data:image/svg+xml;utf8,${encodeURIComponent(file.contentPreview)}`
    : undefined;

  const activeImageSrc = svgDataUrl || resolvedMediaUrl;
  const driveEmbedUrl = buildGoogleDriveEmbedUrl(file.id, file.source);

  const activeText = editingContent !== null ? editingContent : file.contentPreview;
  const rowHeightPx = fontSizePx + 11;

  const virtualLineData = useMemo(
    () => buildVirtualLineItems(activeText, lineSearchQuery, filterMatchingLinesOnly),
    [activeText, lineSearchQuery, filterMatchingLinesOnly]
  );

  const virtualWindow = useMemo(
    () =>
      computeVirtualWindow({
        totalItems: virtualLineData.items.length,
        scrollTop,
        viewportHeight,
        rowHeight: rowHeightPx,
        overscan: 10,
      }),
    [virtualLineData.items.length, scrollTop, viewportHeight, rowHeightPx]
  );

  const visibleLines = useMemo(
    () => virtualLineData.items.slice(virtualWindow.startIndex, virtualWindow.endIndex),
    [virtualLineData.items, virtualWindow.startIndex, virtualWindow.endIndex]
  );

  const handleJumpToLine = (e: React.FormEvent) => {
    e.preventDefault();
    const targetLine = Number(jumpLineInput);
    if (!Number.isFinite(targetLine) || targetLine < 1 || !virtualViewportRef.current) return;
    const nextScrollTop = computeScrollTopForLine({
      lineNumber: targetLine,
      totalLines: virtualLineData.items.length,
      rowHeight: rowHeightPx,
      viewportHeight,
    });
    virtualViewportRef.current.scrollTop = nextScrollTop;
    setScrollTop(nextScrollTop);
  };

  const renderFullScreenToggleBtn = (variant: 'dark' | 'light' = 'light') => (
    <button
      type="button"
      onClick={handleToggleFullScreen}
      data-testid="preview-fullscreen-toggle"
      aria-label={isEffectiveFullScreen ? 'Exit full-screen preview' : 'Toggle full-screen preview'}
      aria-pressed={isEffectiveFullScreen}
      title={
        isEffectiveFullScreen
          ? 'Exit Full-Screen Preview (Esc)'
          : 'Expand Preview to Full-Screen for Maximum Readability'
      }
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
        isEffectiveFullScreen
          ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-xs'
          : variant === 'dark'
          ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-xs'
          : 'bg-blue-600 hover:bg-blue-500 text-white shadow-xs'
      }`}
    >
      {isEffectiveFullScreen ? (
        <>
          <Minimize2 className="w-3.5 h-3.5" />
          <span>Exit Full-Screen</span>
        </>
      ) : (
        <>
          <Maximize2 className="w-3.5 h-3.5" />
          <span>Full-Screen</span>
        </>
      )}
    </button>
  );

  const wrapWithFullScreenContainer = (node: React.ReactNode) => {
    if (!isLocalFullScreen) return node;
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-xs"
          onClick={() => setIsLocalFullScreen(false)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Full-screen preview of ${file.name}`}
          className="fixed inset-2 sm:inset-5 z-50 flex flex-col bg-white dark:bg-[#0B0F19] rounded-2xl shadow-2xl ring-1 ring-slate-300 dark:ring-slate-700 overflow-hidden"
        >
          {/* Dedicated Top Strip when Local Full-Screen is Active */}
          <div className="px-4 py-2.5 bg-slate-900 text-white flex items-center justify-between gap-3 border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="px-2 py-0.5 text-[10px] font-mono uppercase font-bold bg-blue-600/30 text-blue-300 border border-blue-500/40 rounded">
                Full-Screen Preview
              </span>
              <span className="font-bold font-display text-sm truncate">{file.name}</span>
              <span className="text-xs font-mono text-slate-400 hidden sm:inline">
                · {file.mimeType} · {formatBytesTabular(file.size)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsLocalFullScreen(false)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Close Full-Screen (Esc)</span>
            </button>
          </div>
          <div className="flex-1 flex flex-col min-h-0 p-3 overflow-hidden">{node}</div>
        </div>
      </>
    );
  };

  // 1. IMAGE VIEWER (PNG, JPEG, WEBP, GIF, SVG)
  if (viewerKind === 'image') {
    const bgCanvasClass =
      imageBgStyle === 'light'
        ? 'bg-slate-100'
        : imageBgStyle === 'grid'
        ? 'bg-slate-900 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px]'
        : 'bg-slate-950';

    return wrapWithFullScreenContainer(
      <div className="flex flex-col flex-1 min-h-0 bg-slate-900/95 rounded-xl border border-slate-800 overflow-hidden">
        {/* Image Viewer Control Strip */}
        <div className="px-3.5 py-2 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 shrink-0">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-semibold text-white">High-Resolution Image Asset Canvas</span>
            <span className="text-slate-400 font-mono">
              · {Math.round(imageZoom * 100)}% · {imageRotation}°
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center bg-slate-800 rounded p-0.5 mr-1">
              {(['dark', 'grid', 'light'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setImageBgStyle(mode)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono capitalize cursor-pointer ${
                    imageBgStyle === mode
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setImageZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))}
              title="Zoom Out"
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setImageZoom(1);
                setImageRotation(0);
              }}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-slate-200 cursor-pointer"
            >
              100% Fit
            </button>
            <button
              type="button"
              onClick={() => setImageZoom(2)}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-slate-200 cursor-pointer"
            >
              200%
            </button>
            <button
              type="button"
              onClick={() => setImageZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
              title="Zoom In"
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setImageRotation((r) => (r + 90) % 360)}
              title="Rotate 90°"
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>

            {renderFullScreenToggleBtn('dark')}
          </div>
        </div>

        {/* Scrollable & Pannable Image Viewport */}
        <div
          data-testid="image-scroll-container"
          className={`flex-1 flex items-center justify-center overflow-auto p-6 ${bgCanvasClass} ${
            isLocalFullScreen || isFullScreenModal ? 'min-h-[72vh]' : 'min-h-[420px]'
          }`}
        >
          {activeImageSrc ? (
            <img
              src={activeImageSrc}
              alt={file.name}
              style={{
                transform: `scale(${imageZoom}) rotate(${imageRotation}deg)`,
                transition: 'transform 150ms ease-out',
              }}
              className="max-w-full max-h-full object-contain rounded shadow-2xl select-none"
            />
          ) : file.source === 'live_drive' ? (
            <iframe
              title={`Google Drive Image Preview: ${file.name}`}
              src={driveEmbedUrl}
              className="w-full h-full min-h-[420px] rounded border-0 bg-slate-950"
              allow="autoplay"
            />
          ) : (
            <div className="text-center space-y-3">
              <p className="text-xs text-slate-400">
                {isHydrating
                  ? `Streaming binary image "${file.name}" from Google Drive...`
                  : 'Image stream not yet hydrated into memory.'}
              </p>
              <button
                type="button"
                onClick={() => onHydrate(file)}
                disabled={isHydrating}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg cursor-pointer"
              >
                {isHydrating ? 'Streaming Image...' : 'Stream Image Now'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. VIDEO VIEWER (MP4, WebM, MOV, MKV, AVI)
  if (viewerKind === 'video') {
    const canPlayNativeBlob =
      Boolean(resolvedMediaUrl) &&
      (resolvedMediaUrl?.startsWith('blob:') ||
        resolvedMediaUrl?.startsWith('data:video/') ||
        Boolean(file.webContentLink));

    return wrapWithFullScreenContainer(
      <div className="flex flex-col flex-1 min-h-0 bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
        <div className="px-3.5 py-2 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 shrink-0">
          <div className="flex items-center gap-2">
            <Film className="w-3.5 h-3.5 text-purple-400" />
            <span className="font-semibold text-white">Universal Video Stream Player</span>
            <span className="text-slate-400 font-mono">· {file.mimeType}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {file.source === 'live_drive' && (
              <button
                type="button"
                onClick={() => setVideoEmbedMode((v) => !v)}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-200 cursor-pointer"
              >
                {videoEmbedMode ? 'Use Native HTML5 Player' : 'Use Google Drive Theater Player'}
              </button>
            )}
            {renderFullScreenToggleBtn('dark')}
          </div>
        </div>

        <div
          className={`flex-1 flex items-center justify-center p-4 bg-black ${
            isLocalFullScreen || isFullScreenModal ? 'min-h-[72vh]' : 'min-h-[420px]'
          }`}
        >
          {!videoEmbedMode && canPlayNativeBlob && resolvedMediaUrl ? (
            <video
              key={resolvedMediaUrl}
              src={resolvedMediaUrl}
              controls
              autoPlay={false}
              playsInline
              poster={upgradeDriveThumbnailUrl(file.thumbnailLink)}
              className="w-full max-h-[75vh] rounded-lg shadow-2xl bg-black"
            />
          ) : file.source === 'live_drive' ? (
            <iframe
              title={`Google Drive Video Player: ${file.name}`}
              src={driveEmbedUrl}
              className="w-full h-full min-h-[420px] rounded-lg border-0 bg-black"
              allow="autoplay; fullscreen"
            />
          ) : (
            <div className="text-center space-y-3 p-6">
              <p className="text-xs text-slate-300">
                {isHydrating
                  ? `Streaming video payload "${file.name}"...`
                  : 'Click below to hydrate the video stream for playback.'}
              </p>
              <button
                type="button"
                onClick={() => onHydrate(file)}
                disabled={isHydrating}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg cursor-pointer"
              >
                {isHydrating ? 'Streaming Video...' : 'Load Video Stream'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 3. AUDIO VIEWER (MP3, WAV, OGG, M4A)
  if (viewerKind === 'audio') {
    return wrapWithFullScreenContainer(
      <div className="flex flex-col flex-1 min-h-[280px] bg-slate-900 rounded-xl border border-slate-800 p-6 items-center justify-center gap-4">
        <div className="w-full flex justify-end">{renderFullScreenToggleBtn('dark')}</div>
        <div className="w-12 h-12 rounded-full bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
          <Music className="w-6 h-6" />
        </div>
        <div className="text-center">
          <div className="text-sm font-bold text-white">{file.name}</div>
          <div className="text-xs text-slate-400 font-mono mt-0.5">
            {file.mimeType} · {formatBytesTabular(file.size)}
          </div>
        </div>
        {resolvedMediaUrl ? (
          <audio src={resolvedMediaUrl} controls className="w-full max-w-md" />
        ) : (
          <button
            type="button"
            onClick={() => onHydrate(file)}
            disabled={isHydrating}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg cursor-pointer"
          >
            {isHydrating ? 'Streaming Audio...' : 'Stream Audio File'}
          </button>
        )}
      </div>
    );
  }

  // 4. PDF & GOOGLE DOCS / PRESENTATIONS VIEWER
  if (viewerKind === 'pdf') {
    const hasBlobOrDataPdf =
      Boolean(resolvedMediaUrl) &&
      (resolvedMediaUrl?.startsWith('blob:') || resolvedMediaUrl?.startsWith('data:application/pdf'));

    return wrapWithFullScreenContainer(
      <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-3.5 py-2 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-red-500" />
            <span>PDF Document Viewer</span>
          </span>
          {renderFullScreenToggleBtn('light')}
        </div>
        <div
          className={`flex-1 ${
            isLocalFullScreen || isFullScreenModal ? 'min-h-[74vh]' : 'min-h-[440px]'
          }`}
        >
          {hasBlobOrDataPdf && resolvedMediaUrl ? (
            <iframe
              title={`PDF Viewer: ${file.name}`}
              src={resolvedMediaUrl}
              className="w-full h-full min-h-[440px] border-0"
            />
          ) : file.source === 'live_drive' ? (
            <iframe
              title={`Google Drive PDF Preview: ${file.name}`}
              src={driveEmbedUrl}
              className="w-full h-full min-h-[440px] border-0"
            />
          ) : (
            <pre className="p-4 text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap overflow-auto">
              {file.contentPreview || 'Click "Hydrate Content Stream" to load PDF document.'}
            </pre>
          )}
        </div>
      </div>
    );
  }

  // 5. VIRTUALIZED SPREADSHEET / CSV DATA GRID VIEWER + RAW EDITOR
  if (viewerKind === 'csv' && file.contentPreview.trim()) {
    const rows = parseCsvPreviewRows(file.contentPreview, 5000);
    const headerRow = rows[0] || [];
    const bodyRows = rows.slice(1);
    const csvRowHeight = 30;
    const csvVirtual = computeVirtualWindow({
      totalItems: bodyRows.length,
      scrollTop,
      viewportHeight,
      rowHeight: csvRowHeight,
      overscan: 12,
    });
    const visibleCsvRows = bodyRows.slice(csvVirtual.startIndex, csvVirtual.endIndex);

    return wrapWithFullScreenContainer(
      <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-3.5 py-2 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              Virtualized Spreadsheet Grid ({bodyRows.length} data rows)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCsvMode('table')}
              className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                csvMode === 'table'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              Virtualized Grid
            </button>
            <button
              type="button"
              onClick={() => setCsvMode('raw')}
              className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                csvMode === 'raw'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              Raw CSV Editor
            </button>
            {renderFullScreenToggleBtn('light')}
          </div>
        </div>

        {csvMode === 'table' && headerRow.length > 0 ? (
          <div
            ref={virtualViewportRef}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            data-testid="virtual-scroll-container"
            className={`flex-1 overflow-auto ${
              isLocalFullScreen || isFullScreenModal ? 'max-h-[76vh]' : 'max-h-[460px]'
            }`}
          >
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10">
                  <th className="py-2 px-3 text-slate-400 font-semibold w-12">#</th>
                  {headerRow.map((col, cIdx) => (
                    <th
                      key={cIdx}
                      className="py-2 px-3 font-bold text-slate-800 dark:text-slate-200 border-l border-slate-200/70 dark:border-slate-800"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                {csvVirtual.offsetTopPx > 0 && (
                  <tr style={{ height: `${csvVirtual.offsetTopPx}px` }} aria-hidden="true">
                    <td colSpan={headerRow.length + 1} />
                  </tr>
                )}
                {visibleCsvRows.map((row, idx) => {
                  const absoluteRowIdx = csvVirtual.startIndex + idx;
                  return (
                    <tr
                      key={absoluteRowIdx}
                      style={{ height: `${csvRowHeight}px` }}
                      className="hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition-colors"
                    >
                      <td className="py-1 px-3 text-slate-400 tabular-nums">
                        {absoluteRowIdx + 1}
                      </td>
                      {headerRow.map((_, cIdx) => (
                        <td
                          key={cIdx}
                          className="py-1 px-3 text-slate-700 dark:text-slate-300 border-l border-slate-200/50 dark:border-slate-800/60 whitespace-nowrap"
                        >
                          {row[cIdx] ?? ''}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {csvVirtual.totalHeightPx - csvVirtual.offsetTopPx - visibleCsvRows.length * csvRowHeight >
                  0 && (
                  <tr
                    style={{
                      height: `${
                        csvVirtual.totalHeightPx -
                        csvVirtual.offsetTopPx -
                        visibleCsvRows.length * csvRowHeight
                      }px`,
                    }}
                    aria-hidden="true"
                  >
                    <td colSpan={headerRow.length + 1} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-3 flex-1 flex flex-col">
            <textarea
              id={isFullScreenModal ? 'modal-content-editor' : 'inspector-content-editor'}
              rows={isLocalFullScreen || isFullScreenModal ? 26 : 16}
              value={editingContent !== null ? editingContent : file.contentPreview}
              onChange={(e) => setEditingContent(e.target.value)}
              className="w-full flex-1 p-3.5 text-xs font-mono leading-relaxed bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none"
            />
          </div>
        )}
      </div>
    );
  }

  // 6. VIRTUALIZED SCROLLING CODE, JSON, YAML, MARKDOWN & LARGE TEXT VIEWER + RAW EDITOR
  return wrapWithFullScreenContainer(
    <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      {/* Primary Control Bar */}
      <div className="px-3.5 py-2 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex items-center gap-2">
          <FileCode className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            {textViewMode === 'virtual'
              ? 'Virtualized File Stream Viewport'
              : 'Editable File Stream (Confirmation Gate)'}
          </span>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            · {virtualLineData.allLinesCount.toLocaleString()} line(s)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {editingContent !== null && editingContent !== file.contentPreview && (
            <button
              type="button"
              onClick={() => onRequestOverwriteFile(file, editingContent)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 rounded-md transition-colors cursor-pointer"
            >
              <Save className="w-3 h-3" />
              <span>Sync Overwrite to Drive</span>
            </button>
          )}

          {/* Switch between Virtualized Reader and Raw Textarea Editor */}
          <div
            role="group"
            aria-label="Preview Render Mode"
            className="flex items-center p-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md"
          >
            <button
              type="button"
              onClick={() => setTextViewMode('virtual')}
              aria-pressed={textViewMode === 'virtual'}
              className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                textViewMode === 'virtual'
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              Virtual Scroll
            </button>
            <button
              type="button"
              onClick={() => setTextViewMode('edit')}
              aria-pressed={textViewMode === 'edit'}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                textViewMode === 'edit'
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <Edit3 className="w-3 h-3" />
              <span>Edit Raw</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setWordWrap((w) => !w)}
            className="px-2 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-slate-700 dark:text-slate-300 cursor-pointer"
          >
            {wordWrap ? 'Wrap: ON' : 'Wrap: OFF'}
          </button>

          <button
            type="button"
            onClick={() => setFontSizePx((s) => (s >= 18 ? 12 : s + 2))}
            title="Cycle Font Size for Readability"
            className="px-2 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-slate-700 dark:text-slate-300 cursor-pointer"
          >
            {fontSizePx}px
          </button>

          {renderFullScreenToggleBtn('light')}
        </div>
      </div>

      {/* Secondary Virtual Navigation & Line Search Strip (shown in Virtual Scroll mode) */}
      {textViewMode === 'virtual' && (
        <div className="px-3.5 py-1.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px]">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={lineSearchQuery}
                onChange={(e) => {
                  setLineSearchQuery(e.target.value);
                  setScrollTop(0);
                  if (virtualViewportRef.current) {
                    virtualViewportRef.current.scrollTop = 0;
                  }
                }}
                placeholder="Find in file lines..."
                aria-label="Search lines inside file preview"
                className="w-full pl-8 pr-2.5 py-1 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
              />
            </div>

            {lineSearchQuery.trim() && (
              <>
                <button
                  type="button"
                  onClick={() => setFilterMatchingLinesOnly((f) => !f)}
                  aria-pressed={filterMatchingLinesOnly}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border cursor-pointer ${
                    filterMatchingLinesOnly
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-800'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <ListFilter className="w-3 h-3" />
                  <span>Filter Matches ({virtualLineData.matchedCount})</span>
                </button>
              </>
            )}

            <form onSubmit={handleJumpToLine} className="inline-flex items-center gap-1">
              <div className="relative w-28">
                <Hash className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, virtualLineData.items.length)}
                  value={jumpLineInput}
                  onChange={(e) => setJumpLineInput(e.target.value)}
                  placeholder="Line #"
                  aria-label="Jump to line number"
                  className="w-full pl-6 pr-2 py-1 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
                />
              </div>
              <button
                type="submit"
                className="px-2 py-1 text-[11px] font-semibold bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded cursor-pointer"
              >
                Go
              </button>
            </form>
          </div>

          <div
            data-testid="virtual-window-telemetry"
            className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400"
          >
            <span>
              Lines {virtualLineData.items.length > 0 ? virtualWindow.startIndex + 1 : 0}–
              {virtualWindow.endIndex} of {virtualLineData.items.length.toLocaleString()}
            </span>
            <span aria-hidden="true" className="mx-1.5">
              ·
            </span>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
              {visibleLines.length} DOM rows
            </span>
            <span aria-hidden="true" className="mx-1.5">
              ·
            </span>
            <span>{virtualWindow.percentScrolled}%</span>
          </div>
        </div>
      )}

      {/* Main Content Stage: Virtualized Scrolling Container OR Raw Textarea Editor */}
      {textViewMode === 'virtual' ? (
        <div
          ref={virtualViewportRef}
          role="region"
          aria-label="Virtualized file content viewport"
          data-testid="virtual-scroll-container"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          onDoubleClick={() => setTextViewMode('edit')}
          title="Double-click any line to switch to Edit Raw mode"
          className={`flex-1 overflow-y-auto overflow-x-auto bg-white dark:bg-slate-950 font-mono select-text ${
            isLocalFullScreen || isFullScreenModal
              ? 'min-h-[68vh] max-h-[78vh]'
              : 'min-h-[380px] max-h-[520px]'
          }`}
        >
          {!activeText && isHydrating ? (
            <div className="p-8 text-center text-xs text-slate-500 font-mono">
              Streaming live file content from Google Drive...
            </div>
          ) : (
            <div
              style={{
                height: `${Math.max(virtualWindow.totalHeightPx, viewportHeight)}px`,
                position: 'relative',
              }}
            >
              <div
                style={{
                  transform: `translateY(${virtualWindow.offsetTopPx}px)`,
                }}
              >
                {visibleLines.map((lineItem) => {
                  const segments = lineSearchQuery.trim()
                    ? splitFilenameHighlight(lineItem.text, lineSearchQuery)
                    : [{ text: lineItem.text, matched: false }];

                  return (
                    <div
                      key={lineItem.lineNumber}
                      style={{
                        height: `${rowHeightPx}px`,
                        fontSize: `${fontSizePx}px`,
                        lineHeight: `${rowHeightPx}px`,
                      }}
                      className={`flex items-center px-3 border-b border-slate-100/60 dark:border-slate-900/50 ${
                        lineItem.matched
                          ? 'bg-amber-50/90 dark:bg-amber-950/35'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'
                      }`}
                    >
                      <span className="w-12 shrink-0 pr-3 text-right select-none text-[11px] font-mono tabular-nums text-slate-400 dark:text-slate-600 border-r border-slate-200/70 dark:border-slate-800/80">
                        {lineItem.lineNumber}
                      </span>
                      <span
                        className={`pl-3 text-slate-800 dark:text-slate-200 ${
                          wordWrap ? 'truncate' : 'whitespace-pre'
                        }`}
                      >
                        {segments.map((seg, sIdx) =>
                          seg.matched ? (
                            <mark
                              key={sIdx}
                              className="bg-amber-300/90 dark:bg-amber-500/40 text-slate-950 dark:text-amber-100 rounded-xs px-0.5"
                            >
                              {seg.text}
                            </mark>
                          ) : (
                            <span key={sIdx}>{seg.text || ' '}</span>
                          )
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <textarea
          id={isFullScreenModal ? 'modal-content-editor' : 'inspector-content-editor'}
          rows={isLocalFullScreen || isFullScreenModal ? 26 : 18}
          value={activeText}
          onChange={(e) => setEditingContent(e.target.value)}
          style={{ fontSize: `${fontSizePx}px` }}
          placeholder={
            isHydrating
              ? 'Streaming live file content from Google Drive...'
              : 'Click "Hydrate Content Stream" to stream the live file content from Google Drive...'
          }
          className={`w-full flex-1 p-4 font-mono leading-relaxed bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none ${
            isLocalFullScreen || isFullScreenModal ? 'min-h-[68vh]' : 'min-h-[380px]'
          } ${wordWrap ? 'whitespace-pre-wrap' : 'whitespace-pre overflow-x-auto'}`}
        />
      )}
    </div>
  );
};

interface FileViewerModalProps {
  file: DriveItem | null;
  items: DriveItem[];
  isHydratingFileId: string | null;
  onClose: () => void;
  onSelectFile: (file: DriveItem) => void;
  onDownloadFile: (file: DriveItem) => void;
  onRequestOverwriteFile: (file: DriveItem, newContent: string) => void;
  onUseFileInAgentStudio?: (file: DriveItem) => void;
  onUseFileInHarnessSdk?: (file: DriveItem) => void;
  onEmitFileToHostPlugin?: (file: DriveItem) => void;
}

export const FileViewerModal: React.FC<FileViewerModalProps> = ({
  file,
  items,
  isHydratingFileId,
  onClose,
  onSelectFile,
  onDownloadFile,
  onRequestOverwriteFile,
  onUseFileInAgentStudio,
  onUseFileInHarnessSdk,
  onEmitFileToHostPlugin,
}) => {
  const [isZenMaximized, setIsZenMaximized] = useState(false);
  const [copied, setCopied] = useState(false);

  const currentIndex = file ? items.findIndex((i) => i.id === file.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < items.length - 1;

  useEffect(() => {
    if (!file) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditor =
        target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT');
      if (e.key === 'Escape') {
        onClose();
      } else if (!inEditor && e.key === 'ArrowLeft' && hasPrev) {
        onSelectFile(items[currentIndex - 1]);
      } else if (!inEditor && e.key === 'ArrowRight' && hasNext) {
        onSelectFile(items[currentIndex + 1]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, file, hasNext, hasPrev, items, onClose, onSelectFile]);

  if (!file) return null;

  const stats = computeContentStats(file.contentPreview);

  const handleCopy = () => {
    navigator.clipboard?.writeText(file.contentPreview);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="full-viewer-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-2 sm:p-4"
    >
      <div
        className={`flex flex-col bg-white dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden transition-all ${
          isZenMaximized
            ? 'w-screen h-screen rounded-none'
            : 'w-[96vw] max-w-[1600px] h-[92vh] rounded-2xl'
        }`}
      >
        {/* Top Modal Header */}
        <div className="px-5 py-3.5 bg-white dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!hasPrev}
                onClick={() => hasPrev && onSelectFile(items[currentIndex - 1])}
                title="Previous File (Left Arrow)"
                className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-35 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={!hasNext}
                onClick={() => hasNext && onSelectFile(items[currentIndex + 1])}
                title="Next File (Right Arrow)"
                className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-35 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="min-w-0">
              <h2
                id="full-viewer-modal-title"
                className="text-base font-bold font-display text-slate-900 dark:text-slate-100 truncate"
              >
                {file.name}
              </h2>
              <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5">
                <span>{file.folderPath}</span>
                <span>·</span>
                <span>{file.mimeType}</span>
                <span>·</span>
                <span>{formatBytesTabular(file.size)}</span>
                <span>·</span>
                <span>{stats.lineCount} lines</span>
                <span>·</span>
                <span>{file.lastLatencyMs.toFixed(2)} ms read</span>
                <span>·</span>
                <span
                  className={
                    file.cacheStatus === CacheStatus.HIT
                      ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                      : 'text-amber-500'
                  }
                >
                  {file.cacheStatus}
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {onEmitFileToHostPlugin && (
              <button
                type="button"
                onClick={() => onEmitFileToHostPlugin(file)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Emit to Host Plugin</span>
              </button>
            )}

            {onUseFileInAgentStudio && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onUseFileInAgentStudio(file);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg cursor-pointer"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Use in Agent Studio</span>
              </button>
            )}

            {onUseFileInHarnessSdk && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onUseFileInHarnessSdk(file);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Harness SDK</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onSelectFile(file)}
              disabled={isHydratingFileId === file.id}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>{isHydratingFileId === file.id ? 'Streaming...' : 'Re-Stream'}</span>
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => onDownloadFile(file)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>

            {file.webViewLink && (
              <a
                href={file.webViewLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 rounded-lg hover:underline"
              >
                <span>Drive</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <button
              type="button"
              onClick={() => setIsZenMaximized((m) => !m)}
              title={isZenMaximized ? 'Restore Window Size' : 'Maximize 100% Full Screen'}
              className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
            >
              {isZenMaximized ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close full-screen file viewer"
              className="p-2 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Universal Content Stage */}
        <div className="flex-1 flex flex-col min-h-0 p-4 overflow-y-auto">
          <FileContentRenderer
            file={file}
            isHydrating={isHydratingFileId === file.id}
            onHydrate={onSelectFile}
            onRequestOverwriteFile={onRequestOverwriteFile}
            isFullScreenModal={true}
            onToggleModalMaximize={() => setIsZenMaximized((m) => !m)}
            isModalMaximized={isZenMaximized}
          />
        </div>
      </div>
    </div>
  );
};
