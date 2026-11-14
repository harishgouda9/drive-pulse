import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { LatencySample, computeLatencySummaryStats } from '../core/latencyMetrics';

interface LatencyTrendChartProps {
  samples: LatencySample[];
  isDark: boolean;
}

type SeriesFilter = 'ALL' | 'READ' | 'UPLOAD';
type WindowRange = 60 | 30 | 15;

export const LatencyTrendChart: React.FC<LatencyTrendChartProps> = ({ samples, isDark }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [seriesFilter, setSeriesFilter] = useState<SeriesFilter>('ALL');
  const [windowMinutes, setWindowMinutes] = useState<WindowRange>(60);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const visibleSamples = useMemo(() => {
    const cutoff = -windowMinutes;
    return samples.filter((s) => s.minuteOffset >= cutoff);
  }, [samples, windowMinutes]);

  const summary = useMemo(() => computeLatencySummaryStats(visibleSamples), [visibleSamples]);

  const activePoint =
    hoveredIndex !== null && visibleSamples[hoveredIndex]
      ? visibleSamples[hoveredIndex]
      : visibleSamples[visibleSamples.length - 1] || null;

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || visibleSamples.length === 0) return;

    const width = 1040;
    const height = 240;
    const margin = { top: 16, right: 18, bottom: 28, left: 42 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');

    // Area gradient for Upload P99
    const uploadGrad = defs
      .append('linearGradient')
      .attr('id', 'd3-upload-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    uploadGrad
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', isDark ? '#f59e0b' : '#d97706')
      .attr('stop-opacity', isDark ? 0.22 : 0.14);
    uploadGrad
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', isDark ? '#f59e0b' : '#d97706')
      .attr('stop-opacity', 0.0);

    // Area gradient for Stream Read P99
    const streamGrad = defs
      .append('linearGradient')
      .attr('id', 'd3-stream-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    streamGrad
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', isDark ? '#3b82f6' : '#2563eb')
      .attr('stop-opacity', isDark ? 0.24 : 0.16);
    streamGrad
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', isDark ? '#3b82f6' : '#2563eb')
      .attr('stop-opacity', 0.0);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleLinear()
      .domain([visibleSamples[0].minuteOffset, 0])
      .range([0, innerWidth]);

    const maxY =
      seriesFilter === 'READ'
        ? (d3.max(visibleSamples, (d) => d.streamReadP99Ms) ?? 20) * 1.18
        : (d3.max(visibleSamples, (d) => Math.max(d.uploadP99Ms, d.streamReadP99Ms)) ?? 28) * 1.15;

    const yScale = d3.scaleLinear().domain([0, Math.max(5, maxY)]).nice().range([innerHeight, 0]);

    const gridColor = isDark ? '#1e293b' : '#e2e8f0';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    // Horizontal Y grid lines
    const yTicks = yScale.ticks(5);
    g.selectAll('.y-grid')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('class', 'y-grid')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', gridColor)
      .attr('stroke-dasharray', '3,3')
      .attr('stroke-width', 1);

    // Y-axis labels (ms)
    g.selectAll('.y-label')
      .data(yTicks)
      .enter()
      .append('text')
      .attr('class', 'y-label')
      .attr('x', -10)
      .attr('y', (d) => yScale(d) + 4)
      .attr('text-anchor', 'end')
      .attr('fill', textColor)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '10px')
      .text((d) => `${d}ms`);

    // X-axis labels (-60m ... Now)
    const xTicks = xScale.ticks(6);
    g.selectAll('.x-label')
      .data(xTicks)
      .enter()
      .append('text')
      .attr('class', 'x-label')
      .attr('x', (d) => xScale(d))
      .attr('y', innerHeight + 22)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '10px')
      .text((d) => (d === 0 ? 'Now' : `${d}m`));

    // Upload P99 Series
    if (seriesFilter === 'ALL' || seriesFilter === 'UPLOAD') {
      const uploadArea = d3
        .area<LatencySample>()
        .x((d) => xScale(d.minuteOffset))
        .y0(innerHeight)
        .y1((d) => yScale(d.uploadP99Ms))
        .curve(d3.curveMonotoneX);

      const uploadLine = d3
        .line<LatencySample>()
        .x((d) => xScale(d.minuteOffset))
        .y((d) => yScale(d.uploadP99Ms))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(visibleSamples)
        .attr('fill', 'url(#d3-upload-grad)')
        .attr('d', uploadArea);

      g.append('path')
        .datum(visibleSamples)
        .attr('fill', 'none')
        .attr('stroke', isDark ? '#f59e0b' : '#d97706')
        .attr('stroke-width', 2)
        .attr('d', uploadLine);
    }

    // Cold/Delta Stream Read P99 Series
    if (seriesFilter === 'ALL' || seriesFilter === 'READ') {
      const streamArea = d3
        .area<LatencySample>()
        .x((d) => xScale(d.minuteOffset))
        .y0(innerHeight)
        .y1((d) => yScale(d.streamReadP99Ms))
        .curve(d3.curveMonotoneX);

      const streamLine = d3
        .line<LatencySample>()
        .x((d) => xScale(d.minuteOffset))
        .y((d) => yScale(d.streamReadP99Ms))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(visibleSamples)
        .attr('fill', 'url(#d3-stream-grad)')
        .attr('d', streamArea);

      g.append('path')
        .datum(visibleSamples)
        .attr('fill', 'none')
        .attr('stroke', isDark ? '#3b82f6' : '#2563eb')
        .attr('stroke-width', 2)
        .attr('d', streamLine);

      // LRU Volatile Memory Hit P99 Series (sub-millisecond baseline)
      const lruLine = d3
        .line<LatencySample>()
        .x((d) => xScale(d.minuteOffset))
        .y((d) => yScale(d.lruReadP99Ms))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(visibleSamples)
        .attr('fill', 'none')
        .attr('stroke', isDark ? '#10b981' : '#16a34a')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,2')
        .attr('d', lruLine);
    }

    // Active / Hovered Crosshair & Dots
    if (activePoint) {
      const cx = xScale(activePoint.minuteOffset);
      g.append('line')
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('y1', 0)
        .attr('y2', innerHeight)
        .attr('stroke', isDark ? '#475569' : '#94a3b8')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '2,2');

      if (seriesFilter === 'ALL' || seriesFilter === 'UPLOAD') {
        g.append('circle')
          .attr('cx', cx)
          .attr('cy', yScale(activePoint.uploadP99Ms))
          .attr('r', 4)
          .attr('fill', isDark ? '#f59e0b' : '#d97706')
          .attr('stroke', isDark ? '#0B0F19' : '#ffffff')
          .attr('stroke-width', 1.5);
      }

      if (seriesFilter === 'ALL' || seriesFilter === 'READ') {
        g.append('circle')
          .attr('cx', cx)
          .attr('cy', yScale(activePoint.streamReadP99Ms))
          .attr('r', 4)
          .attr('fill', isDark ? '#3b82f6' : '#2563eb')
          .attr('stroke', isDark ? '#0B0F19' : '#ffffff')
          .attr('stroke-width', 1.5);

        g.append('circle')
          .attr('cx', cx)
          .attr('cy', yScale(activePoint.lruReadP99Ms))
          .attr('r', 3.5)
          .attr('fill', isDark ? '#10b981' : '#16a34a')
          .attr('stroke', isDark ? '#0B0F19' : '#ffffff')
          .attr('stroke-width', 1.5);
      }
    }
  }, [visibleSamples, seriesFilter, isDark, activePoint]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || visibleSamples.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (relX - 42) / Math.max(1, rect.width - 60)));
    const idx = Math.min(
      visibleSamples.length - 1,
      Math.max(0, Math.round(ratio * (visibleSamples.length - 1)))
    );
    setHoveredIndex(idx);
  };

  return (
    <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
      {/* Top Header & Interactive Controls */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold font-display text-slate-900 dark:text-slate-100">
            P99 Read & Upload Latency Trends (Last {windowMinutes} Minutes)
          </h2>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Avg LRU Read P99: {summary.avgLruReadP99Ms.toFixed(2)} ms</span>
            <span aria-hidden="true">·</span>
            <span>Avg Stream Read P99: {summary.avgStreamReadP99Ms.toFixed(1)} ms</span>
            <span aria-hidden="true">·</span>
            <span>Avg Chunk Upload P99: {summary.avgUploadP99Ms.toFixed(1)} ms</span>
            <span aria-hidden="true">·</span>
            <span>{summary.totalOperations60m.toLocaleString()} total ops</span>
          </div>
        </div>

        {/* Interactive Series Filter & Time Window Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Filter latency series"
            className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg"
          >
            {(
              [
                { id: 'ALL', label: 'All Operations' },
                { id: 'READ', label: 'Reads Only' },
                { id: 'UPLOAD', label: 'Uploads Only' },
              ] as Array<{ id: SeriesFilter; label: string }>
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setSeriesFilter(btn.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  seriesFilter === btn.id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          <div
            role="group"
            aria-label="Select time window"
            className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg font-mono"
          >
            {([60, 30, 15] as WindowRange[]).map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => {
                  setWindowMinutes(mins);
                  setHoveredIndex(null);
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  windowMinutes === mins
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {mins}m
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live Hovered Sample Telemetry Readout Strip */}
      {activePoint && (
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs font-mono tabular-nums">
          <div className="text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-white">
              Window Sample: {activePoint.timestampLabel} UTC
            </span>
            <span aria-hidden="true" className="mx-1.5">·</span>
            <span>
              {activePoint.minuteOffset === 0 ? 'Current Minute' : `${activePoint.minuteOffset}m ago`}
            </span>
            <span aria-hidden="true" className="mx-1.5">·</span>
            <span>{activePoint.opsCount} ops/min</span>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
              LRU Read P99: {activePoint.lruReadP99Ms.toFixed(2)} ms
            </span>
            <span className="text-blue-600 dark:text-blue-400 font-semibold">
              Stream Read P99: {activePoint.streamReadP99Ms.toFixed(1)} ms
            </span>
            <span className="text-amber-600 dark:text-amber-400 font-semibold">
              Chunk Upload P99: {activePoint.uploadP99Ms.toFixed(1)} ms
            </span>
          </div>
        </div>
      )}

      {/* D3.js SVG Line Chart Canvas */}
      <div className="w-full overflow-hidden">
        <svg
          ref={svgRef}
          data-testid="d3-latency-chart"
          viewBox="0 0 1040 240"
          role="img"
          aria-label="D3.js line chart of P99 read and upload latency over the last 60 minutes"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredIndex(null)}
          className="w-full h-auto select-none cursor-crosshair block"
        />
      </div>
    </div>
  );
};
