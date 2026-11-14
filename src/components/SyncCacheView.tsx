import React, { useState } from 'react';
import { RefreshCw, Trash2, Zap, Download, FileText, Check } from 'lucide-react';
import { CacheEntry, CacheTelemetry, TransferJob } from '../types/drive';
import { formatBytesTabular } from '../core/chunkStreamer';
import {
  LatencySample,
  serializePerformanceExportCsv,
  serializePerformanceExportJson,
} from '../core/latencyMetrics';
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
  isSyncing: boolean;
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
  isSyncing,
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
      {/* Header, Real-Time Export Controls & Delta Sync Action */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-lg font-bold font-display text-slate-900 dark:text-slate-100">
            In-Memory LRU Cache & Delta Synchronization Matrix
          </h1>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums flex flex-wrap items-center gap-x-2">
            <span>Drive Delta Token: {startPageToken || 'Unissued'}</span>
            <span aria-hidden="true">·</span>
            <span>Last Poll: {lastDeltaSyncTime}</span>
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
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Polling changes.list...' : 'Run Delta Sync Poll'}</span>
          </button>
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
              Avg stream miss: {telemetry.avgMissLatencyMs.toFixed(2)} ms
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
