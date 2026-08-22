/**
 * Rounds up to a "clean" step (1, 2, or 5 × a power of ten) for a Y-axis
 * tick — the dataviz skill's own rule, shared by every SVG chart under
 * `_components/` rather than reimplemented per chart.
 */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 5, 10];
  const step = steps.find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

/**
 * Layout constants for the hover tooltip every SVG chart under
 * `_components/` draws as a `<foreignObject>` — same box, same "how much
 * room does N lines of figures need," shared rather than re-picked per
 * chart.
 */
export const TOOLTIP_WIDTH = 200;
export const TOOLTIP_LINE_HEIGHT = 20;
export const TOOLTIP_GAP = 10; // between the mark (bar/point) and the tooltip box

/** `title` line + one row per figure + the padding `.tooltip-box` itself carries. */
export function tooltipHeight(figureRows: number): number {
  return 34 + figureRows * TOOLTIP_LINE_HEIGHT;
}
