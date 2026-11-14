import { CacheTelemetry, TransferJob } from '../types/drive';

export type OperationLatencyKind = 'LRU_READ' | 'STREAM_READ' | 'UPLOAD';

export interface RecordedLatencyEvent {
  timestampMs: number;
  kind: OperationLatencyKind;
  latencyMs: number;
  bytes: number;
}

export interface LatencySample {
  minuteOffset: number; // -59 to 0
  timestampLabel: string; // HH:MM
  timestampIso: string;
  timestampMs: number;
  lruReadP99Ms: number;
  streamReadP99Ms: number;
  uploadP99Ms: number;
  opsCount: number;
}

export interface LatencySeriesSummary {
  avgLruReadP99Ms: number;
  avgStreamReadP99Ms: number;
  avgUploadP99Ms: number;
  peakUploadP99Ms: number;
  minLruReadP99Ms: number;
  totalOperations60m: number;
}

export function computePercentile99(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.99 * sorted.length) - 1));
  return Math.round(sorted[index] * 100) / 100;
}

export function buildRollingSixtyMinuteSeries(
  events: RecordedLatencyEvent[],
  nowMs: number = Date.now()
): LatencySample[] {
  const currentMinuteFloor = Math.floor(nowMs / 60000) * 60000;
  const samples: LatencySample[] = [];

  for (let i = 59; i >= 0; i--) {
    const bucketStart = currentMinuteFloor - i * 60000;
    const bucketEnd = bucketStart + 60000;
    const d = new Date(bucketStart);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');

    const bucketEvents = events.filter(
      (ev) => ev.timestampMs >= bucketStart && ev.timestampMs < bucketEnd
    );

    const lruLatencies = bucketEvents
      .filter((ev) => ev.kind === 'LRU_READ')
      .map((ev) => ev.latencyMs);
    const streamLatencies = bucketEvents
      .filter((ev) => ev.kind === 'STREAM_READ')
      .map((ev) => ev.latencyMs);
    const uploadLatencies = bucketEvents
      .filter((ev) => ev.kind === 'UPLOAD')
      .map((ev) => ev.latencyMs);

    samples.push({
      minuteOffset: i === 0 ? 0 : -i,
      timestampLabel: `${hh}:${mm}`,
      timestampIso: d.toISOString(),
      timestampMs: bucketStart,
      lruReadP99Ms: computePercentile99(lruLatencies),
      streamReadP99Ms: computePercentile99(streamLatencies),
      uploadP99Ms: computePercentile99(uploadLatencies),
      opsCount: bucketEvents.length,
    });
  }

  return samples;
}

export function computeLatencySummaryStats(samples: LatencySample[]): LatencySeriesSummary {
  if (samples.length === 0) {
    return {
      avgLruReadP99Ms: 0,
      avgStreamReadP99Ms: 0,
      avgUploadP99Ms: 0,
      peakUploadP99Ms: 0,
      minLruReadP99Ms: 0,
      totalOperations60m: 0,
    };
  }

  const activeLru = samples.filter((s) => s.lruReadP99Ms > 0);
  const activeStream = samples.filter((s) => s.streamReadP99Ms > 0);
  const activeUpload = samples.filter((s) => s.uploadP99Ms > 0);

  const avgLru =
    activeLru.length === 0
      ? 0
      : activeLru.reduce((acc, s) => acc + s.lruReadP99Ms, 0) / activeLru.length;
  const avgStream =
    activeStream.length === 0
      ? 0
      : activeStream.reduce((acc, s) => acc + s.streamReadP99Ms, 0) / activeStream.length;
  const avgUpload =
    activeUpload.length === 0
      ? 0
      : activeUpload.reduce((acc, s) => acc + s.uploadP99Ms, 0) / activeUpload.length;

  const peakUpload = samples.reduce((max, s) => (s.uploadP99Ms > max ? s.uploadP99Ms : max), 0);
  const minLru =
    activeLru.length === 0
      ? 0
      : activeLru.reduce((min, s) => (s.lruReadP99Ms < min ? s.lruReadP99Ms : min), Infinity);
  const totalOps = samples.reduce((sum, s) => sum + s.opsCount, 0);

  return {
    avgLruReadP99Ms: Math.round(avgLru * 100) / 100,
    avgStreamReadP99Ms: Math.round(avgStream * 10) / 10,
    avgUploadP99Ms: Math.round(avgUpload * 10) / 10,
    peakUploadP99Ms: Math.round(peakUpload * 10) / 10,
    minLruReadP99Ms: Math.round(minLru * 100) / 100,
    totalOperations60m: totalOps,
  };
}

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function serializePerformanceExportJson(params: {
  exportedAt: string;
  startPageToken: string;
  telemetry: CacheTelemetry;
  latencySeries: LatencySample[];
  transferJobs: TransferJob[];
}): string {
  const summary = computeLatencySummaryStats(params.latencySeries);
  return JSON.stringify(
    {
      schemaVersion: '1.0',
      exportedAt: params.exportedAt,
      driveDeltaPageToken: params.startPageToken,
      cacheTelemetry: params.telemetry,
      latencySummary60m: summary,
      latencySeries60m: params.latencySeries,
      transferJobLogs: params.transferJobs,
    },
    null,
    2
  );
}

export function serializePerformanceExportCsv(params: {
  latencySeries: LatencySample[];
  transferJobs: TransferJob[];
}): string {
  const lines: string[] = [];

  // Section 1: 60-Minute P99 Latency Series
  lines.push(
    [
      'record_type',
      'minute_offset',
      'timestamp_iso',
      'timestamp_label',
      'lru_read_p99_ms',
      'stream_read_p99_ms',
      'upload_p99_ms',
      'ops_count',
      'transfer_id',
      'file_name',
      'direction',
      'total_bytes',
      'chunks',
      'throughput_mbps',
      'transfer_latency_ms',
      'status',
    ].join(',')
  );

  for (const sample of params.latencySeries) {
    lines.push(
      [
        'LATENCY_BUCKET_60M',
        sample.minuteOffset,
        escapeCsvCell(sample.timestampIso),
        escapeCsvCell(sample.timestampLabel),
        sample.lruReadP99Ms,
        sample.streamReadP99Ms,
        sample.uploadP99Ms,
        sample.opsCount,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ].join(',')
    );
  }

  // Section 2: Real-Time Transfer Job Logs
  for (const job of params.transferJobs) {
    lines.push(
      [
        'TRANSFER_JOB_LOG',
        '',
        escapeCsvCell(job.startedAt),
        '',
        '',
        '',
        '',
        '',
        escapeCsvCell(job.id),
        escapeCsvCell(job.fileName),
        escapeCsvCell(job.direction),
        job.totalBytes,
        `${job.completedChunks}/${job.totalChunks}`,
        job.throughputMbps,
        job.latencyMs,
        escapeCsvCell(job.status),
      ].join(',')
    );
  }

  return lines.join('\n');
}
