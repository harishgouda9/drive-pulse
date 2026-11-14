export interface VirtualWindowSlice {
  startIndex: number;
  endIndex: number;
  offsetTopPx: number;
  totalHeightPx: number;
  visibleCount: number;
  totalItems: number;
  percentScrolled: number;
}

export interface VirtualLineItem {
  lineNumber: number;
  text: string;
  matched: boolean;
}

/**
 * Splits a text payload into an array of lines in O(N) time while preserving empty lines.
 */
export function splitTextIntoLines(content: string): string[] {
  if (!content) return [''];
  return content.split(/\r\n|\r|\n/);
}

/**
 * Computes the virtualized window slice for a fixed-row-height scrolling container.
 * Guarantees O(1) DOM node count regardless of total line count (e.g. 50,000+ lines).
 */
export function computeVirtualWindow(params: {
  totalItems: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscan?: number;
}): VirtualWindowSlice {
  const totalItems = Math.max(0, Math.floor(params.totalItems));
  const rowHeight = Math.max(16, params.rowHeight);
  const viewportHeight = Math.max(rowHeight, params.viewportHeight);
  const overscan = Math.max(0, params.overscan ?? 8);
  const safeScrollTop = Math.max(0, params.scrollTop);

  const totalHeightPx = totalItems * rowHeight;

  if (totalItems === 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      offsetTopPx: 0,
      totalHeightPx: 0,
      visibleCount: 0,
      totalItems: 0,
      percentScrolled: 0,
    };
  }

  const rawFirstVisible = Math.floor(safeScrollTop / rowHeight);
  const visibleRows = Math.ceil(viewportHeight / rowHeight);

  const startIndex = Math.max(0, Math.min(totalItems - 1, rawFirstVisible - overscan));
  const endIndex = Math.max(
    startIndex,
    Math.min(totalItems, rawFirstVisible + visibleRows + overscan)
  );

  const offsetTopPx = startIndex * rowHeight;
  const maxScroll = Math.max(1, totalHeightPx - viewportHeight);
  const percentScrolled =
    totalHeightPx <= viewportHeight
      ? 100
      : Math.min(100, Math.max(0, Math.round((safeScrollTop / maxScroll) * 100)));

  return {
    startIndex,
    endIndex,
    offsetTopPx,
    totalHeightPx,
    visibleCount: endIndex - startIndex,
    totalItems,
    percentScrolled,
  };
}

/**
 * Builds indexed line items with optional case-insensitive search matching.
 */
export function buildVirtualLineItems(
  content: string,
  searchQuery: string = '',
  filterMatchingOnly: boolean = false
): {
  allLinesCount: number;
  matchedCount: number;
  items: VirtualLineItem[];
} {
  const rawLines = splitTextIntoLines(content);
  const cleanQuery = searchQuery.trim().toLowerCase();

  let matchedCount = 0;
  const items: VirtualLineItem[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i];
    const matched = cleanQuery.length > 0 && text.toLowerCase().includes(cleanQuery);
    if (matched) {
      matchedCount++;
    }
    if (!filterMatchingOnly || !cleanQuery || matched) {
      items.push({
        lineNumber: i + 1,
        text,
        matched,
      });
    }
  }

  return {
    allLinesCount: rawLines.length,
    matchedCount,
    items,
  };
}

/**
 * Computes the target scrollTop pixel offset to center a 1-indexed line number inside the viewport.
 */
export function computeScrollTopForLine(params: {
  lineNumber: number;
  totalLines: number;
  rowHeight: number;
  viewportHeight: number;
}): number {
  const clampedLine = Math.max(1, Math.min(Math.max(1, params.totalLines), Math.floor(params.lineNumber)));
  const targetTop = (clampedLine - 1) * params.rowHeight;
  const centeredTop = targetTop - Math.max(0, (params.viewportHeight - params.rowHeight) / 2);
  const maxScroll = Math.max(0, params.totalLines * params.rowHeight - params.viewportHeight);
  return Math.max(0, Math.min(maxScroll, Math.round(centeredTop)));
}
