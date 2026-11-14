import { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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
function VirtualGrid<T>({
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

  // Follow the scroll container.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => {
      setScrollTop(element.scrollTop);
      setViewportHeight(element.clientHeight);
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
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

  // Measure the rendered rows.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => observer.disconnect();
  });

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

  const renderRow = useCallback(
    (rowIndex: number) => {
      const row = rows[rowIndex];
      if (!row) return null;
      const base = rowIndex * columns;
      return row.map((item, offset) => (
        <div key={base + offset} style={{ display: "contents" }}>
          {renderItem(item, base + offset, rowIndex)}
        </div>
      ));
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

export default VirtualGrid;
