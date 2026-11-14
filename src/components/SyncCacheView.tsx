import React, { useState } from 'react';
import {
  Activity,
  Check,
  Download,
  FileText,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Trash2,
  Zap,
} from 'lucide-react';
import { CacheEntry, CacheTelemetry, TransferJob } from '../types/drive';
import { formatBytesTabular } from '../core/chunkStreamer';
import {
  LatencySample,
  serializePerformanceExportCsv,
  serializePerformanceExportJson,
} from '../core/latencyMetrics';
import { LiveSyncEvent } from '../core/liveSyncEngine';
import { LatencyTrendChart } from './LatencyTrendChart';

interface SyncCacheViewProps {
  telemetry: CacheTelemetry;
  cacheEntries: CacheEntry[];
  transferJobs: TransferJob[];
  latencySamples: LatencySample[];
  isDark: boolean;
  startPageToken: string;
  lastDeltaSyncTime: string;
  onChangeMaxBytes: (mb: number) => void;
  onEvictEntry: (fileId: string) => void;
  onClearAllCache: () => void;
  onTriggerDeltaSync: () => void;
  onTriggerTurboSync?: () => void;
  onProbeSyncRtt?: () => void;
  isSyncing: boolean;
  isTurboSyncing?: boolean;
  liveSyncConnected?: boolean;
  liveSyncRttMs?: number;
  liveSyncSeq?: number;
  liveSyncSubscribers?: number;
  liveSyncEnabled?: boolean;
  liveSyncIntervalMs?: 1500 | 3000 | 5000 | 10000;
  parallelWorkers?: 4 | 8 | 16;
  onToggleLiveSync?: (enabled: boolean) => void;
  onChangeLiveSyncInterval?: (intervalMs: 1500 | 3000 | 5000 | 10000) => void;
  onChangeParallelWorkers?: (workers: 4 | 8 | 16) => void;
  liveSyncEvents?: LiveSyncEvent[];
}

export const SyncCacheView: React.FC<SyncCacheViewProps> = ({
  telemetry,
  cacheEntries,
  transferJobs,
  latencySamples,
  isDark,
  startPageToken,
  lastDeltaSyncTime,
  onChangeMaxBytes,
  onEvictEntry,
  onClearAllCache,
  onTriggerDeltaSync,
  onTriggerTurboSync,
  onProbeSyncRtt,
  isSyncing,
  isTurboSyncing = false,
  liveSyncConnected = true,
  liveSyncRttMs = 0.42,
  liveSyncSeq = 1,
  liveSyncSubscribers = 1,
  liveSyncEnabled = true,
  liveSyncIntervalMs = 3000,
  parallelWorkers = 8,
  onToggleLiveSync,
  onChangeLiveSyncInterval,
  onChangeParallelWorkers,
  liveSyncEvents = [],
}) => {
  const [exportFormat, setExportFormat] = useState<'JSON' | 'CSV'>('JSON');
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [lastExportedPreview, setLastExportedPreview] = useState<{
    format: 'JSON' | 'CSV';
    fileName: string;
    payload: string;
  } | null>(null);

  const currentMaxMb = Math.round(telemetry.maxBytes / (1024 * 1024));
  const memoryOptionsMb = [32, 64, 128, 256, 512];

  const handleExportPerformanceReport = (formatOverride?: 'JSON' | 'CSV') => {
    const targetFormat = formatOverride || exportFormat;
    const nowIso = new Date().toISOString();
    const safeTimestamp = nowIso.replace(/[:.]/g, '-');

    const payload =
      targetFormat === 'JSON'
        ? serializePerformanceExportJson({
            exportedAt: nowIso,
            startPageToken,
            telemetry,
            latencySeries: latencySamples,
            transferJobs,
          })
        : serializePerformanceExportCsv({
            latencySeries: latencySamples,
            transferJobs,
          });

    const mimeType =
      targetFormat === 'JSON' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8';
    const ext = targetFormat === 'JSON' ? 'json' : 'csv';
    const fileName = `drivepulse-telemetry-${safeTimestamp}.${ext}`;

    const blob = new Blob([payload], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setLastExportedPreview({
      format: targetFormat,
      fileName,
      payload,
    });
    setExportStatus(
      `Exported ${latencySamples.length}m latency series & ${transferJobs.length} transfer log(s) as ${targetFormat}`
    );
    setTimeout(() => setExportStatus(null), 4000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50 dark:bg-[#0B0F19]">
      {/* Header, Real-Time Export Controls & Delta / Turbo Sync Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-bold font-display text-slate-900 dark:text-slate-100">
              Ultra-Low-Latency Live Sync & In-Memory LRU Matrix
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-semibold border ${
                liveSyncConnected
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  liveSyncConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              />
              {liveSyncConnected ? 'SSE STREAM LIVE' : 'RECONNECTING'} · {liveSyncRttMs.toFixed(2)} ms RTT · Seq #{liveSyncSeq}
            </span>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums flex flex-wrap items-center gap-x-2">
            <span>Drive Delta Token: {startPageToken || 'Unissued'}</span>
            <span aria-hidden="true">·</span>
            <span>Last Poll: {lastDeltaSyncTime}</span>
            <span aria-hidden="true">·</span>
            <span>Active Harness Peers: {liveSyncSubscribers}</span>
            {exportStatus && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-sans font-medium inline-flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  {exportStatus}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Format Selector + Export Button */}
          <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-0.5">
            <label htmlFor="export-format-select" className="sr-only">
              Export Format
            </label>
            <select
              id="export-format-select"
              aria-label="Export Format"
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as 'JSON' | 'CSV')}
              className="px-2.5 py-1.5 text-xs font-mono font-semibold bg-transparent text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="JSON">JSON</option>
              <option value="CSV">CSV</option>
            </select>
            <button
              type="button"
              onClick={() => handleExportPerformanceReport()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Export {exportFormat} Report</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onTriggerDeltaSync}
            disabled={isSyncing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Polling changes.list...' : 'Run Delta Sync Poll'}</span>
          </button>

          {onTriggerTurboSync && (
            <button
              type="button"
              onClick={onTriggerTurboSync}
              disabled={isTurboSyncing}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Zap className={`w-3.5 h-3.5 ${isTurboSyncing ? 'animate-bounce' : ''}`} />
              <span>
                {isTurboSyncing
                  ? `Turbo Syncing (${parallelWorkers}x Parallel)...`
                  : `Turbo Sync Now (${parallelWorkers}x Parallel)`}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Ultra-Fast Bidirectional Live Sync Control Strip (Google Drive <-> Harness) */}
      <div className="p-4 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/60 flex items-center justify-center shrink-0">
            <Radio className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>Real-Time Bidirectional Live Sync Engine (Google Drive ↔ Harness MCP)</span>
              <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded border border-blue-200 dark:border-blue-800/50">
                O(N) Checksum Diff + {parallelWorkers}x Concurrent Streams
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Unchanged files resolve in &lt;0.1 ms from RAM with zero network transfer; modified or new files stream in parallel and broadcast via SSE &amp; PostMessage.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {onToggleLiveSync && (
            <button
              type="button"
              onClick={() => onToggleLiveSync(!liveSyncEnabled)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                liveSyncEnabled
                  ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-500'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
              }`}
            >
              {liveSyncEnabled ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>Continuous Live Sync: ON</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Continuous Live Sync: PAUSED</span>
                </>
              )}
            </button>
          )}

          {onChangeLiveSyncInterval && (
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="live-sync-cadence-select"
                className="text-[11px] font-medium text-slate-500 dark:text-slate-400"
              >
                Cadence:
              </label>
              <select
                id="live-sync-cadence-select"
                value={liveSyncIntervalMs}
                onChange={(e) =>
                  onChangeLiveSyncInterval(
                    Number(e.target.value) as 1500 | 3000 | 5000 | 10000
                  )
                }
                className="px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
              >
                <option value={1500}>1.5s Ultra-Fast</option>
                <option value={3000}>3.0s Turbo</option>
                <option value={5000}>5.0s Real-Time</option>
                <option value={10000}>10.0s Standard</option>
              </select>
            </div>
          )}

          {onChangeParallelWorkers && (
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="parallel-workers-select"
                className="text-[11px] font-medium text-slate-500 dark:text-slate-400"
              >
                Workers:
              </label>
              <select
                id="parallel-workers-select"
                value={parallelWorkers}
                onChange={(e) =>
                  onChangeParallelWorkers(Number(e.target.value) as 4 | 8 | 16)
                }
                className="px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
              >
                <option value={4}>4x Parallel</option>
                <option value={8}>8x Parallel</option>
                <option value={16}>16x Parallel</option>
              </select>
            </div>
          )}

          {onProbeSyncRtt && (
            <button
              type="button"
              onClick={onProbeSyncRtt}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              title="Measure real-time sub-millisecond ping RTT to the Harness sync bus"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Measure Ping RTT</span>
            </button>
          )}
        </div>
      </div>

      {/* 4-Column Quantitative Telemetry Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="text-xs text-slate-500 dark:text-slate-400">LRU Cache Hit Ratio</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
            {telemetry.hitRatioPercent.toFixed(1)}%
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
            <span>{telemetry.hitCount} hits</span>
            <span aria-hidden="true" className="mx-1.5">·</span>
            <span>{telemetry.missCount} misses</span>
          </div>
        </div>

        <div className="p-4 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="text-xs text-slate-500 dark:text-slate-400">Volatile Memory Footprint</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
            {formatBytesTabular(telemetry.usedBytes)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
            <span>{telemetry.totalEntries} hydrated objects</span>
            <span aria-hidden="true" className="mx-1.5">·</span>
            <span>{telemetry.evictionCount} evictions</span>
          </div>
        </div>

        <div className="p-4 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="text-xs text-slate-500 dark:text-slate-400">Measured Avg Hit Latency</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
            {telemetry.avgHitLatencyMs.toFixed(2)} ms
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
            <span>
              Avg stream miss: {telemetry.avgMissLatencyMs.toFixed(2)} ms · Bus RTT: {liveSyncRttMs.toFixed(2)} ms
            </span>
          </div>
        </div>

        <div className="p-4 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="flex items-center justify-between">
            <label
              htmlFor="lru-budget-select"
              className="text-xs text-slate-500 dark:text-slate-400"
            >
              LRU Memory Ceiling
            </label>
            <span className="text-xs font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
              {currentMaxMb} MB
            </span>
          </div>
          <div className="mt-2">
            <select
              id="lru-budget-select"
              value={currentMaxMb}
              onChange={(e) => onChangeMaxBytes(Number(e.target.value))}
              className="w-full px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
            >
              {memoryOptionsMb.map((mb) => (
                <option key={mb} value={mb}>
                  {mb} MB Volatile Allocation
                </option>
              ))}
            </select>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
            Zero disk persistence (RAM only)
          </div>
        </div>
      </div>

      {/* D3.js 60-Minute P99 Read & Upload Latency Line Chart */}
      <LatencyTrendChart samples={latencySamples} isDark={isDark} />

      {/* Live Exported File Inspector (when an export is triggered) */}
      {lastExportedPreview && (
        <div
          data-testid="exported-report-preview"
          className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Latest Exported Telemetry Artifact: {lastExportedPreview.fileName}</span>
            </div>
            <button
              type="button"
              onClick={() => setLastExportedPreview(null)}
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
            >
              Dismiss Preview
            </button>
          </div>
          <pre className="p-3 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg max-h-48 overflow-y-auto text-slate-800 dark:text-slate-200">
            {lastExportedPreview.payload}
          </pre>
        </div>
      )}

      {/* Real-Time Server-Authoritative Live Sync Event Stream */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold font-display text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Live Bidirectional Sync Event Stream ({liveSyncEvents.length})</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Real-time SSE &amp; delta events pushed between Google Drive, Harness MCP, and connected host clients.
            </p>
          </div>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            Endpoint: GET /api/sync/stream
          </span>
        </div>

        {liveSyncEvents.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            Waiting for live sync events. Click &ldquo;Turbo Sync Now&rdquo; or upload/modify a file to observe real-time delta propagation.
          </div>
        ) : (
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/50">
                  <th className="py-2 pl-6 pr-3">Seq</th>
                  <th className="py-2 px-3">Event Type</th>
                  <th className="py-2 px-3">Origin</th>
                  <th className="py-2 px-3">Target / Summary</th>
                  <th className="py-2 px-3 text-right">Latency</th>
                  <th className="py-2 pl-3 pr-6 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70 text-xs font-mono tabular-nums">
                {liveSyncEvents.slice(0, 20).map((ev, idx) => (
                  <tr
                    key={`${ev.seq}-${ev.type}-${idx}`}
                    className="h-9 hover:bg-slate-50 dark:hover:bg-slate-900/40"
                  >
                    <td className="py-1.5 pl-6 pr-3 text-blue-600 dark:text-blue-400 font-semibold">
                      #{ev.seq}
                    </td>
                    <td className="py-1.5 px-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          ev.type === 'sync:turbo_complete'
                            ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                            : ev.type === 'file:deleted'
                            ? 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                            : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {ev.type}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-slate-600 dark:text-slate-400">{ev.origin}</td>
                    <td className="py-1.5 px-3 font-sans text-slate-900 dark:text-slate-100 truncate max-w-[320px]">
                      {ev.file
                        ? `${ev.file.fileName} (${formatBytesTabular(ev.file.byteSize)} · md5:${ev.file.checksum.slice(0, 8)})`
                        : ev.summary
                        ? `${ev.summary.hydratedCount} hydrated, ${ev.summary.unchangedHits} RAM HITs (${ev.summary.throughputMbps.toFixed(1)} MB/s)`
                        : ev.deletedFileId
                        ? `Deleted ID: ${ev.deletedFileId}`
                        : 'Stream initialized'}
                    </td>
                    <td className="py-1.5 px-3 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                      {ev.latencyMs.toFixed(2)} ms
                    </td>
                    <td className="py-1.5 pl-3 pr-6 text-right text-slate-500 dark:text-slate-400">
                      {ev.timestamp.slice(11, 23)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Hydrated LRU Cache Keys Table */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold font-display text-slate-900 dark:text-slate-100">
              Hydrated In-Memory LRU Keys (Most Recently Accessed First)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Entries are keyed by Google Drive fileId and verified against ETag/MD5 checksums on every delta poll.
            </p>
          </div>
          {cacheEntries.length > 0 && (
            <button
              type="button"
              onClick={onClearAllCache}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-slate-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Purge All Memory Keys</span>
            </button>
          )}
        </div>

        {cacheEntries.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No files currently hydrated in the LRU cache. Upload a file or sign in with Google Drive and select a file to hydrate memory.
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/50">
                <th className="py-2.5 pl-6 pr-3">Cache Key</th>
                <th className="py-2.5 px-3">File Name</th>
                <th className="py-2.5 px-3">MD5 Checksum</th>
                <th className="py-2.5 px-3 text-right">Byte Size</th>
                <th className="py-2.5 px-3 text-right">Hit Count</th>
                <th className="py-2.5 pl-3 pr-6 text-right">Evict</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70 text-xs font-mono tabular-nums">
              {cacheEntries.map((entry) => (
                <tr key={entry.key} className="h-10 hover:bg-slate-50 dark:hover:bg-slate-900/40">
                  <td className="py-2 pl-6 pr-3 text-blue-600 dark:text-blue-400">{entry.key}</td>
                  <td className="py-2 px-3 font-sans font-medium text-slate-900 dark:text-slate-100">
                    {entry.fileName}
                  </td>
                  <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{entry.checksum}</td>
                  <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300">
                    {formatBytesTabular(entry.byteSize)}
                  </td>
                  <td className="py-2 px-3 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                    {entry.hitCount}
                  </td>
                  <td className="py-2 pl-3 pr-6 text-right">
                    <button
                      type="button"
                      onClick={() => onEvictEntry(entry.fileId)}
                      aria-label={`Evict ${entry.fileName} from cache`}
                      className="px-2.5 py-1 text-[11px] font-sans font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:text-red-600 dark:hover:text-red-400 rounded-md transition-colors cursor-pointer"
                    >
                      Evict
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Real-Time Chunked Transfer Stream Ledger */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold font-display text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>Real-Time Chunked Transfer Stream Ledger ({transferJobs.length})</span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleExportPerformanceReport('JSON')}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
            >
              Download JSON
            </button>
            <button
              type="button"
              onClick={() => handleExportPerformanceReport('CSV')}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
            >
              Download CSV
            </button>
          </div>
        </div>

        {transferJobs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No transfer operations executed in this session yet. Upload, read, or sync a file to record live transfer telemetry.
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/50">
                <th className="py-2.5 pl-6 pr-3">Direction</th>
                <th className="py-2.5 px-3">File Artifact</th>
                <th className="py-2.5 px-3 text-right">Payload</th>
                <th className="py-2.5 px-3 text-right">Chunks</th>
                <th className="py-2.5 px-3 text-right">Throughput</th>
                <th className="py-2.5 pl-3 pr-6 text-right">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70 text-xs font-mono tabular-nums">
              {transferJobs.map((job) => (
                <tr key={job.id} className="h-10">
                  <td className="py-2 pl-6 pr-3 font-semibold text-slate-700 dark:text-slate-300">
                    {job.direction}
                  </td>
                  <td className="py-2 px-3 font-sans font-medium text-slate-900 dark:text-slate-100">
                    {job.fileName}
                  </td>
                  <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-300">
                    {formatBytesTabular(job.totalBytes)}
                  </td>
                  <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-300">
                    {job.completedChunks}/{job.totalChunks}
                  </td>
                  <td className="py-2 px-3 text-right text-blue-600 dark:text-blue-400 font-semibold">
                    {job.throughputMbps.toFixed(1)} MB/s
                  </td>
                  <td className="py-2 pl-3 pr-6 text-right text-emerald-600 dark:text-emerald-400">
                    {job.latencyMs.toFixed(2)} ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
