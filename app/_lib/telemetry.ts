import { randomBytes } from 'node:crypto';

/**
 * Deliberately untested, unlike the rest of `app/_lib/` — see CLAUDE.md.
 * `CLAUDE.md` names this project's whole defect class in one line: a
 * plausible wrong number, never a crash. Nothing in this file can produce
 * one — every error is swallowed (`.catch(() => {})` below), the call never
 * blocks a render, and the only consumer of its output is an optional
 * external collector the page itself never reads. Mutation-testing it would
 * mean writing `fetch`-mocking and module-reimport machinery to chase a
 * score for bugs that, if they existed, wouldn't be this project's kind of
 * bug — measuring process rather than product, the thing the README says
 * v0.1 over-invested in. Left inside the `mutate` glob anyway, so its low
 * score is visible rather than quietly excluded.
 *
 * Spans for the reserved `service.name=sluice` workload
 * `observability/README.md` already describes, over the identical transport
 * `observability/hooks/session-outcome.ts` uses: raw OTLP/HTTP JSON over
 * `fetch()`, zero dependencies — no SDK to keep in step with a beta trace
 * shape, no npm install before the product's own stack is chosen.
 *
 * Differs from that hook in one way: `emitSpan` never awaits its own
 * network call. The hook is a short-lived CLI process that would otherwise
 * exit before the request lands; `app/page.tsx` runs inside Next's
 * long-lived server process, so a genuinely fire-and-forget call never adds
 * the collector's latency to a page render, and a dead collector — the
 * normal case when `observability/` isn't running — costs nothing. Errors
 * are swallowed here: nothing about telemetry may be the reason a page
 * fails to render.
 */

const ENDPOINT = process.env.SLUICE_OTLP_HTTP_ENDPOINT ?? 'http://localhost:4318';
const EXPORT_TIMEOUT_MS = 2000;

/** One `traceId`, shared by every span emitted for a single page view — so "what happened during this visit" is one trace, not several unrelated ones. */
export interface Trace {
  readonly traceId: string;
}

export function newTrace(): Trace {
  return { traceId: randomBytes(16).toString('hex') };
}

type AttrValue = string | number | boolean;

function attrValue(value: AttrValue): Record<string, unknown> {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
}

export function emitSpan(trace: Trace, name: string, attrs: Record<string, AttrValue> = {}): void {
  const nowNs = String(BigInt(Date.now()) * 1_000_000n);
  const body = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'sluice' } }] },
        scopeSpans: [
          {
            scope: { name: 'sluice.page' },
            spans: [
              {
                traceId: trace.traceId,
                spanId: randomBytes(8).toString('hex'),
                name,
                kind: 1,
                startTimeUnixNano: nowNs,
                endTimeUnixNano: nowNs,
                attributes: Object.entries(attrs).map(([key, value]) => ({ key, value: attrValue(value) })),
              },
            ],
          },
        ],
      },
    ],
  };

  fetch(`${ENDPOINT}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
  }).catch(() => {
    // A dead collector is the normal case when observability/ isn't running.
  });
}
