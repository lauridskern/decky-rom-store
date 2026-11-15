/** A one-shot performance sample, used by the diagnostics panel. */
export interface PerfSample {
  fps: number;
  frameMs: number;
  worstMs: number;
  nodes: number;
  images: number;
  heapMB: number | null;
}

interface HeapInfo {
  usedJSHeapSize: number;
}

/**
 * Measures the client for a moment: how often it manages to paint, how much
 * DOM the plugin has produced and how much JavaScript memory it is holding.
 *
 * This exists so a "it gets laggy after a while" report can be turned into
 * numbers instead of a guess.
 */
export async function measurePerformance(durationMs = 1500): Promise<PerfSample> {
  const frames: number[] = [];
  await new Promise<void>((resolve) => {
    let last = performance.now();
    const started = last;
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      if (now - started < durationMs) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });

  const deltas = frames.filter((value) => value > 0).sort((a, b) => a - b);
  const median = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 0;
  const worst = deltas.length ? deltas[deltas.length - 1] : 0;
  const heap = (performance as unknown as { memory?: HeapInfo }).memory;

  return {
    fps: median > 0 ? Math.round(1000 / median) : 0,
    frameMs: Math.round(median * 10) / 10,
    worstMs: Math.round(worst * 10) / 10,
    nodes: document.getElementsByTagName("*").length,
    images: document.images.length,
    heapMB: heap ? Math.round((heap.usedJSHeapSize / (1024 * 1024)) * 10) / 10 : null,
  };
}
