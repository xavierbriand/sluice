import { formatEur, formatEurExplicitSign, type Cents } from '@/core/money.ts';

/**
 * A headline number, not a column: proportional figures, not `.num`
 * (tabular) — `tabular-nums` gives every digit the width of a `0`, which
 * looks loose at display sizes and is reserved for columns that must align
 * vertically (the dataviz skill's own rule for stat-tile values).
 */
export interface StatTileProps {
  readonly label: string;
  readonly value: Cents;
  /** A CSS colour, e.g. `'var(--series-1)'` — identity for the label, never for the value text itself. */
  readonly seriesColor?: string;
  readonly sub?: string;
  /**
   * Renders with an explicit sign (`+512,00 €`/`-512,00 €`) instead of
   * accounting notation — for a figure like drift, where positive and
   * negative are two different directions to read, not a shortfall to
   * parenthesise. No colour is implied by the sign either way: the domain
   * layer names no good/bad threshold for a value like this, so the tile
   * doesn't invent one.
   */
  readonly signed?: boolean;
}

export function StatTile({ label, value, seriesColor, sub, signed }: StatTileProps) {
  const text = signed === true ? formatEurExplicitSign(value) : formatEur(value);
  return (
    <div className="stat-tile">
      <span className="stat-tile-label">
        {seriesColor !== undefined && <span className="swatch" style={{ background: seriesColor }} />}
        {label}
      </span>
      <span className="stat-tile-value">{text}</span>
      {sub !== undefined && <span className="stat-tile-sub">{sub}</span>}
    </div>
  );
}
