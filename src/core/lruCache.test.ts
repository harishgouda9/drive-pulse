import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveLruCache } from './lruCache';
import {
  calculateThroughputMbps,
  classifyFileCategory,
  computeContentStats,
  computeFastChecksum,
  filterAndSortDriveItems,
  formatBytesTabular,
  parseGoogleDriveUrlOrId,
  splitFilenameHighlight,
  splitIntoChunks,
} from './chunkStreamer';
import {
  buildRollingSixtyMinuteSeries,
  computeLatencySummaryStats,
  computePercentile99,
  serializePerformanceExportCsv,
  serializePerformanceExportJson,
} from './latencyMetrics';
import { CacheStatus, DriveItem, FileCategory } from '../types/drive';

test('DriveLruCache stores, retrieves with sub-ms HIT, and tracks hit ratio', () => {
  const cache = new DriveLruCache(10000);
  const miss = cache.get('file-1');
  assert.equal(miss.status, CacheStatus.MISS);
  assert.equal(miss.entry, null);

  cache.put('file-1', 'architecture.md', 'chk-100', '# System Spec', 512);
  const hit = cache.get('file-1', 'chk-100');
  assert.equal(hit.status, CacheStatus.HIT);
  assert.equal(hit.entry?.payload, '# System Spec');
  assert.equal(hit.entry?.hitCount, 1);

  const telemetry = cache.getTelemetry();
  assert.equal(telemetry.hitCount, 1);
  assert.equal(telemetry.missCount, 1);
  assert.equal(telemetry.hitRatioPercent, 50);
});

test('DriveLruCache evicts least-recently-used entries when maxBytes is exceeded', () => {
  const cache = new DriveLruCache(2048);
  cache.put('file-a', 'a.json', 'chk-a', '{"a":1}', 900);
  cache.put('file-b', 'b.json', 'chk-b', '{"b":2}', 900);

  const touchA = cache.get('file-a');
  assert.equal(touchA.status, CacheStatus.HIT);

  cache.put('file-c', 'c.json', 'chk-c', '{"c":3}', 900);

  assert.equal(cache.hasValid('file-a'), true);
  assert.equal(cache.hasValid('file-b'), false);
  assert.equal(cache.hasValid('file-c'), true);
  assert.equal(cache.getTelemetry().evictionCount, 1);
});

test('DriveLruCache invalidates stale checksums on get and delta changes', () => {
  const cache = new DriveLruCache(10000);
  cache.put('file-1', 'config.yaml', 'old-md5', 'port: 3000', 512);

  const staleCheck = cache.get('file-1', 'new-md5');
  assert.equal(staleCheck.status, CacheStatus.STALE);
  assert.equal(staleCheck.entry, null);

  cache.put('file-2', 'schema.sql', 'md5-v1', 'CREATE TABLE t;', 512);
  const initialItems: DriveItem[] = [
    {
      id: 'file-2',
      name: 'schema.sql',
      mimeType: 'application/sql',
      size: 512,
      modifiedTime: '2026-11-12T10:00:00Z',
      md5Checksum: 'md5-v1',
      folderPath: '/Engineering',
      cacheStatus: CacheStatus.HIT,
      lastLatencyMs: 0.3,
      contentPreview: 'CREATE TABLE t;',
      source: 'live_drive',
    },
  ];

  const deltaResult = cache.applyDeltaChanges(initialItems, [
    {
      fileId: 'file-2',
      removed: false,
      timestamp: '2026-11-12T11:00:00Z',
      file: {
        id: 'file-2',
        name: 'schema.sql',
        mimeType: 'application/sql',
        size: 1024,
        modifiedTime: '2026-11-12T11:00:00Z',
        md5Checksum: 'md5-v2',
        contentPreview: 'CREATE TABLE t2;',
      },
    },
  ]);

  assert.deepEqual(deltaResult.invalidatedIds, ['file-2']);
  assert.equal(deltaResult.updatedItems[0].md5Checksum, 'md5-v2');
  assert.equal(deltaResult.updatedItems[0].cacheStatus, CacheStatus.STALE);
});

test('chunkStreamer splits payloads deterministically and computes throughput', () => {
  const payload = 'A'.repeat(1024) + 'B'.repeat(512);
  const chunks = splitIntoChunks(payload, 512);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].byteLength, 512);
  assert.equal(chunks[2].byteLength, 512);
  assert.notEqual(chunks[0].checksum, chunks[2].checksum);
  assert.equal(computeFastChecksum('hello'), computeFastChecksum('hello'));

  const mbps = calculateThroughputMbps(10 * 1024 * 1024, 50);
  assert.equal(mbps, 200);
  assert.equal(formatBytesTabular(1536), '1.5 KB');
});

test('filterAndSortDriveItems filters by category, folder, and query accurately', () => {
  const items: DriveItem[] = [
    {
      id: '1',
      name: 'harness-config.json',
      mimeType: 'application/json',
      size: 2048,
      modifiedTime: '2026-11-12T08:00:00Z',
      md5Checksum: 'c1',
      folderPath: '/Harness/Config',
      cacheStatus: CacheStatus.HIT,
      lastLatencyMs: 0.3,
      contentPreview: '{"bridge": "mcp"}',
      source: 'live_drive',
    },
    {
      id: '2',
      name: 'q4-metrics.csv',
      mimeType: 'text/csv',
      size: 8192,
      modifiedTime: '2026-11-12T09:00:00Z',
      md5Checksum: 'c2',
      folderPath: '/Analytics',
      cacheStatus: CacheStatus.MISS,
      lastLatencyMs: 14.2,
      contentPreview: 'latency,throughput',
      source: 'live_drive',
    },
  ];

  assert.equal(classifyFileCategory('application/json', 'harness-config.json'), FileCategory.CODE);
  assert.equal(classifyFileCategory('text/csv', 'q4-metrics.csv'), FileCategory.SPREADSHEETS);

  const codeOnly = filterAndSortDriveItems(items, '', FileCategory.CODE, 'ALL', 'name');
  assert.equal(codeOnly.length, 1);
  assert.equal(codeOnly[0].id, '1');

  // Real-time filename-only search matches filename and ignores content-only matches
  const byFileNameOnly = filterAndSortDriveItems(
    items,
    'q4-metrics',
    FileCategory.ALL,
    'ALL',
    'name',
    'filename'
  );
  assert.equal(byFileNameOnly.length, 1);
  assert.equal(byFileNameOnly[0].name, 'q4-metrics.csv');

  const contentTermInFilenameMode = filterAndSortDriveItems(
    items,
    'throughput',
    FileCategory.ALL,
    'ALL',
    'name',
    'filename'
  );
  assert.equal(contentTermInFilenameMode.length, 0);

  const contentTermInAllMode = filterAndSortDriveItems(
    items,
    'throughput',
    FileCategory.ALL,
    'ALL',
    'name',
    'all'
  );
  assert.equal(contentTermInAllMode.length, 1);

  const segments = splitFilenameHighlight('harness-config.json', 'config');
  assert.deepEqual(segments, [
    { text: 'harness-', matched: false },
    { text: 'config', matched: true },
    { text: '.json', matched: false },
  ]);
});

test('latencyMetrics aggregates real events into 60-minute P99 series and exports valid JSON and CSV', () => {
  const now = Date.UTC(2026, 10, 12, 23, 30, 10);
  const events = [
    { timestampMs: now - 5000, kind: 'LRU_READ' as const, latencyMs: 0.25, bytes: 1024 },
    { timestampMs: now - 3000, kind: 'LRU_READ' as const, latencyMs: 0.42, bytes: 2048 },
    { timestampMs: now - 2000, kind: 'STREAM_READ' as const, latencyMs: 14.8, bytes: 8192 },
    { timestampMs: now - 1000, kind: 'UPLOAD' as const, latencyMs: 21.5, bytes: 4096 },
  ];

  assert.equal(computePercentile99([0.25, 0.42]), 0.42);

  const series = buildRollingSixtyMinuteSeries(events, now);
  assert.equal(series.length, 60);
  assert.equal(series[0].minuteOffset, -59);
  assert.equal(series[59].minuteOffset, 0);
  assert.equal(series[59].lruReadP99Ms, 0.42);
  assert.equal(series[59].streamReadP99Ms, 14.8);
  assert.equal(series[59].uploadP99Ms, 21.5);
  assert.equal(series[59].opsCount, 4);

  const summary = computeLatencySummaryStats(series);
  assert.equal(summary.totalOperations60m, 4);
  assert.equal(summary.peakUploadP99Ms, 21.5);

  const cache = new DriveLruCache(1024 * 1024);
  const jobs = [
    {
      id: 'tx-real-1',
      fileName: 'metrics.json',
      direction: 'UPLOAD' as const,
      totalBytes: 4096,
      transferredBytes: 4096,
      totalChunks: 1,
      completedChunks: 1,
      throughputMbps: 182.4,
      latencyMs: 21.5,
      status: 'COMPLETED' as const,
      startedAt: '2026-11-12T23:30:09.000Z',
    },
  ];

  const jsonExport = serializePerformanceExportJson({
    exportedAt: '2026-11-12T23:30:10.000Z',
    startPageToken: '10492',
    telemetry: cache.getTelemetry(),
    latencySeries: series,
    transferJobs: jobs,
  });
  const parsedJson = JSON.parse(jsonExport);
  assert.equal(parsedJson.latencySeries60m.length, 60);
  assert.equal(parsedJson.transferJobLogs.length, 1);
  assert.equal(parsedJson.transferJobLogs[0].fileName, 'metrics.json');

  const csvExport = serializePerformanceExportCsv({
    latencySeries: series,
    transferJobs: jobs,
  });
  assert.equal(csvExport.includes('LATENCY_BUCKET_60M'), true);
  assert.equal(csvExport.includes('TRANSFER_JOB_LOG'), true);
  assert.equal(csvExport.includes('metrics.json'), true);
});

test('parseGoogleDriveUrlOrId and computeContentStats parse Drive links and compute exact content metrics', () => {
  const docParsed = parseGoogleDriveUrlOrId(
    'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456/edit'
  );
  assert.deepEqual(docParsed, {
    fileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456',
    resourceType: 'document',
  });

  const sheetParsed = parseGoogleDriveUrlOrId(
    'https://docs.google.com/spreadsheets/d/1SheetId9876543210abcdef/edit#gid=0'
  );
  assert.deepEqual(sheetParsed, {
    fileId: '1SheetId9876543210abcdef',
    resourceType: 'spreadsheet',
  });

  const fileParsed = parseGoogleDriveUrlOrId(
    'https://drive.google.com/file/d/1DriveFileId112233445566/view?usp=sharing'
  );
  assert.deepEqual(fileParsed, {
    fileId: '1DriveFileId112233445566',
    resourceType: 'file',
  });

  const stats = computeContentStats('line one\nline two has four');
  assert.equal(stats.lineCount, 2);
  assert.equal(stats.wordCount, 6);
  assert.equal(stats.byteCount, 26);
});

test('liveSyncEngine computes O(N) checksum diff plans, runs concurrent worker pools, and reconciles events idempotently', async () => {
  const {
    computeSyncDiffPlan,
    reconcileLiveSyncEvent,
    runConcurrentPool,
  } = await import('./liveSyncEngine');

  const cache = new DriveLruCache(1024 * 1024);
  cache.put('f-unchanged', 'unchanged.yaml', 'md5-1', 'pipeline: v1', 12);
  cache.put('f-stale', 'stale.yaml', 'md5-old', 'pipeline: old', 13);

  const remoteItems: DriveItem[] = [
    {
      id: 'f-unchanged',
      name: 'unchanged.yaml',
      mimeType: 'application/yaml',
      size: 12,
      modifiedTime: '2026-11-14T08:00:00Z',
      md5Checksum: 'md5-1',
      folderPath: '/Google Drive',
      cacheStatus: CacheStatus.MISS,
      lastLatencyMs: 1.2,
      contentPreview: '',
      source: 'live_drive',
    },
    {
      id: 'f-stale',
      name: 'stale.yaml',
      mimeType: 'application/yaml',
      size: 100,
      modifiedTime: '2026-11-14T08:05:00Z',
      md5Checksum: 'md5-new',
      folderPath: '/Google Drive',
      cacheStatus: CacheStatus.MISS,
      lastLatencyMs: 1.2,
      contentPreview: '',
      source: 'live_drive',
    },
    {
      id: 'f-new',
      name: 'new.json',
      mimeType: 'application/json',
      size: 250,
      modifiedTime: '2026-11-14T08:10:00Z',
      md5Checksum: 'md5-fresh',
      folderPath: '/Google Drive',
      cacheStatus: CacheStatus.MISS,
      lastLatencyMs: 1.2,
      contentPreview: '',
      source: 'live_drive',
    },
  ];

  const plan = computeSyncDiffPlan(remoteItems, cache.entries(), [
    ...remoteItems,
    {
      id: 'f-deleted',
      name: 'deleted.txt',
      mimeType: 'text/plain',
      size: 10,
      modifiedTime: '2026-11-14T07:00:00Z',
      md5Checksum: 'md5-del',
      folderPath: '/Google Drive',
      cacheStatus: CacheStatus.HIT,
      lastLatencyMs: 0.1,
      contentPreview: 'gone',
      source: 'live_drive',
    },
  ]);

  assert.equal(plan.unchangedHits.length, 1);
  assert.equal(plan.unchangedHits[0].id, 'f-unchanged');
  assert.equal(plan.unchangedHits[0].contentPreview, 'pipeline: v1');
  assert.equal(plan.toHydrate.length, 2);
  assert.equal(plan.estimatedBytesToTransfer, 350);
  assert.deepEqual(plan.removedIds, ['f-deleted']);

  const poolOut = await runConcurrentPool([10, 20, 30, 40, 50], 3, async (val, idx) => val + idx);
  assert.deepEqual(poolOut, [10, 21, 32, 43, 54]);

  const upserted = reconcileLiveSyncEvent(plan.unchangedHits, {
    seq: 1,
    type: 'file:upserted',
    timestamp: '2026-11-14T08:15:00Z',
    latencyMs: 0.35,
    origin: 'HARNESS_RPC',
    file: {
      fileId: 'f-new',
      fileName: 'new.json',
      mimeType: 'application/json',
      byteSize: 15,
      checksum: 'md5-fresh',
      content: '{"status":"ok"}',
      folderPath: '/Harness',
      modifiedTime: '2026-11-14T08:15:00Z',
      source: 'harness_rpc',
    },
  });
  assert.equal(upserted.changed, true);
  assert.equal(upserted.items.length, 2);

  // Applying the exact same event a second time is a no-op (idempotent)
  const duplicateUpsert = reconcileLiveSyncEvent(upserted.items, {
    seq: 1,
    type: 'file:upserted',
    timestamp: '2026-11-14T08:15:00Z',
    latencyMs: 0.35,
    origin: 'HARNESS_RPC',
    file: {
      fileId: 'f-new',
      fileName: 'new.json',
      mimeType: 'application/json',
      byteSize: 15,
      checksum: 'md5-fresh',
      content: '{"status":"ok"}',
      folderPath: '/Harness',
      modifiedTime: '2026-11-14T08:15:00Z',
      source: 'harness_rpc',
    },
  });
  assert.equal(duplicateUpsert.changed, false);
});




test('detectViewerKind, isBinaryMediaMime, upgradeDriveThumbnailUrl, and parseCsvPreviewRows handle images, videos, PDFs, and spreadsheets', async () => {
  const {
    detectViewerKind,
    isBinaryMediaMime,
    upgradeDriveThumbnailUrl,
    parseCsvPreviewRows,
    buildGoogleDriveEmbedUrl,
  } = await import('./chunkStreamer');

  assert.equal(detectViewerKind('image/png', 'diagram.png'), 'image');
  assert.equal(detectViewerKind('video/mp4', 'demo.mp4'), 'video');
  assert.equal(detectViewerKind('audio/mpeg', 'track.mp3'), 'audio');
  assert.equal(detectViewerKind('application/pdf', 'spec.pdf'), 'pdf');
  assert.equal(detectViewerKind('text/csv', 'metrics.csv'), 'csv');
  assert.equal(detectViewerKind('application/json', 'config.json'), 'code_text');

  assert.equal(isBinaryMediaMime('image/jpeg', 'photo.jpg'), true);
  assert.equal(isBinaryMediaMime('video/webm', 'clip.webm'), true);
  assert.equal(isBinaryMediaMime('image/svg+xml', 'icon.svg'), false);
  assert.equal(isBinaryMediaMime('text/plain', 'readme.txt'), false);

  assert.equal(
    upgradeDriveThumbnailUrl('https://lh3.googleusercontent.com/abc=s220'),
    'https://lh3.googleusercontent.com/abc=s1600'
  );
  assert.equal(
    buildGoogleDriveEmbedUrl('1DriveFileId123'),
    'https://drive.google.com/file/d/1DriveFileId123/preview'
  );

  const csvRows = parseCsvPreviewRows('service,latency_ms,status\nbridge,0.35,"OK"\n', 10);
  assert.deepEqual(csvRows, [
    ['service', 'latency_ms', 'status'],
    ['bridge', '0.35', 'OK'],
  ]);
});

test('virtualScrollEngine computes O(1) virtualized window slices, filters matching lines, and centers jump-to-line offsets', async () => {
  const {
    buildVirtualLineItems,
    computeScrollTopForLine,
    computeVirtualWindow,
    splitTextIntoLines,
  } = await import('./virtualScrollEngine');

  const sampleText = Array.from({ length: 10000 }, (_, i) =>
    i % 100 === 0 ? `[ERROR] Line ${i + 1}: Timeout threshold exceeded` : `[INFO] Line ${i + 1}: OK`
  ).join('\n');

  const lines = splitTextIntoLines(sampleText);
  assert.equal(lines.length, 10000);

  // At scrollTop = 0 with viewport = 480px and rowHeight = 24px (20 visible rows + 8 overscan = 28 rows)
  const initialWindow = computeVirtualWindow({
    totalItems: lines.length,
    scrollTop: 0,
    viewportHeight: 480,
    rowHeight: 24,
    overscan: 8,
  });
  assert.equal(initialWindow.startIndex, 0);
  assert.equal(initialWindow.endIndex, 28);
  assert.equal(initialWindow.visibleCount, 28);
  assert.equal(initialWindow.offsetTopPx, 0);
  assert.equal(initialWindow.totalHeightPx, 240000);
  assert.equal(initialWindow.percentScrolled, 0);

  // Mid-scroll at scrollTop = 120,000px (line 5,000)
  const midWindow = computeVirtualWindow({
    totalItems: lines.length,
    scrollTop: 120000,
    viewportHeight: 480,
    rowHeight: 24,
    overscan: 8,
  });
  assert.equal(midWindow.startIndex, 5000 - 8);
  assert.equal(midWindow.endIndex, 5000 + 20 + 8);
  assert.equal(midWindow.offsetTopPx, (5000 - 8) * 24);
  assert.equal(midWindow.visibleCount, 36);

  // Filtering matching lines only
  const filtered = buildVirtualLineItems(sampleText, 'ERROR', true);
  assert.equal(filtered.allLinesCount, 10000);
  assert.equal(filtered.matchedCount, 100);
  assert.equal(filtered.items.length, 100);
  assert.equal(filtered.items[0].lineNumber, 1);
  assert.equal(filtered.items[1].lineNumber, 101);

  // Jump to line 500 centers line 500 in a 480px viewport
  const targetScroll = computeScrollTopForLine({
    lineNumber: 500,
    totalLines: 10000,
    rowHeight: 24,
    viewportHeight: 480,
  });
  assert.equal(targetScroll, (500 - 1) * 24 - (480 - 24) / 2);
});
