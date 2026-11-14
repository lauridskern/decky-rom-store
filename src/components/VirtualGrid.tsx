import { memo, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

interface Props<T> {
  items: T[];
  renderItem: (item: T, index: number, rowIndex: number) => ReactNode;
  scrollRef: React.RefObject<HTMLElement | null>;
  minItemWidth?: number;
  gap?: number;
  overscan?: number;
}

/**
 * A windowed grid: only the rows that are actually on screen are rendered.
 * With a few dozen cards this keeps the Steam client from laying out and
 * painting the whole catalogue every time the list scrolls.
 */
function VirtualGridInner<T>({
  items,
  renderItem,
  scrollRef,
  minItemWidth = 128,
  gap = 10,
  overscan = 1,
}: Props<T>) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [rowHeights, setRowHeights] = useState<number[]>([]);

  // Follow the scroll container. Scroll events are coalesced into a single
  // update per animation frame - reacting to every event made the grid stutter.
  const frameRef = useRef<number | null>(null);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => {
      setViewportHeight(element.clientHeight);
    };
    const onScroll = () => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setScrollTop(element.scrollTop);
      });
    };
    update();
    setScrollTop(element.scrollTop);
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [scrollRef]);

  // Track the width of the grid so we know how many columns fit.
  useLayoutEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = Math.max(1, Math.floor((width + gap) / (minItemWidth + gap)) || 1);

  const rows = useMemo(() => {
    const out: T[][] = [];
    for (let index = 0; index < items.length; index += columns) {
      out.push(items.slice(index, index + columns));
    }
    return out;
  }, [items, columns]);



  const { start, end, topSpace, bottomSpace } = useMemo(() => {
    const estimate = 230;
    const offsets: number[] = [];
    let total = 0;
    for (let index = 0; index < rows.length; index += 1) {
      offsets.push(total);
      total += rowHeights[index] ?? estimate;
    }
    const first = scrollTop - 150;
    const last = scrollTop + viewportHeight + 150;

    let firstRow = 0;
    while (firstRow < rows.length && offsets[firstRow] + (rowHeights[firstRow] ?? estimate) < first) {
      firstRow += 1;
    }
    let lastRow = firstRow;
    while (lastRow < rows.length && offsets[lastRow] < last) {
      lastRow += 1;
    }
    const startRow = Math.max(0, firstRow - overscan);
    const endRow = Math.min(rows.length, lastRow + overscan);

    // The spacers always use the estimate: if the height of the content
    // above the viewport changed while scrolling, the scroll position would
    // jump around.
    const top = startRow * estimate;
    const bottom = Math.max(0, rows.length - endRow) * estimate;
    return { start: startRow, end: endRow, topSpace: top, bottomSpace: bottom };
  }, [rows, rowHeights, scrollTop, viewportHeight, overscan]);

  // Measure the rendered rows. This must only run when the visible rows
  // change - re-creating the observer on every render was a major source of
  // the scroll stutter.
  const visibleStart = useMemo(() => start, [start]);
  const visibleEnd = useMemo(() => end, [end]);
  useLayoutEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setRowHeights((previous) => {
        const next = previous.slice();
        let changed = false;
        for (const entry of entries) {
          const row = Number((entry.target as HTMLElement).dataset.row);
          const height = Math.round(entry.contentRect.height);
          if (!Number.isNaN(row) && next[row] !== height) {
            next[row] = height;
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    });
    element.querySelectorAll<HTMLElement>("[data-row]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [visibleStart, visibleEnd, columns]);

  const renderRow = useCallback(
    (rowIndex: number) => {
      const row = rows[rowIndex];
      if (!row) return null;
      const base = rowIndex * columns;
      // The card is the grid item itself - a display:contents wrapper can
      // stop images inside it from painting.
      return row.map((item, offset) => renderItem(item, base + offset, rowIndex));
    },
    [rows, columns, renderItem],
  );

  const visible: ReactNode[] = [];
  for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
    const content = renderRow(rowIndex);
    if (content) visible.push(...content);
  }

  return (
    <div
      className="rs-grid"
      ref={gridRef}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {topSpace > 0 ? <div style={{ gridColumn: "1 / -1", height: topSpace }} /> : null}
      {visible}
      {bottomSpace > 0 ? <div style={{ gridColumn: "1 / -1", height: bottomSpace }} /> : null}
    </div>
  );
}

const VirtualGrid = memo(VirtualGridInner) as typeof VirtualGridInner;

export default VirtualGrid;
