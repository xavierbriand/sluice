/**
 * Rounds up to a "clean" step (1, 2, or 5 × a power of ten) for a Y-axis
 * tick — the dataviz skill's own rule, shared by every SVG chart under
 * `_components/` rather than reimplemented per chart.
 */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 5, 10];
  // `?? 10` can never run: by construction of `magnitude`,
  // `10 * magnitude > value` always holds (that is what `Math.floor` on the
  // log means), so `steps` — which ends in `10` — always finds a match
  // before `.find` runs out. Verified by sweep, including exact powers of
  // ten where floating-point `Math.log10` could in principle round the
  // wrong way: zero fallback hits across every exponent -10..15 crossed
  // with 10,000 multiples, plus every exact power of ten up to 10^20.
  const step = steps.find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}
