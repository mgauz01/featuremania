"use client";

import { useEffect, useState } from "react";

export type UsageEvent = {
  model: string;
  tokens: number;
  cost: number;
  feature: string;
  guardrail_block?: string | null;
};

type RoutingDashboardProps = {
  events?: UsageEvent[];
  pollUrl?: string;
  pollMs?: number;
};

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export default function RoutingDashboard({
  events: initialEvents,
  pollUrl = "/v1/usage",
  pollMs = 5000,
}: RoutingDashboardProps) {
  const seeded = initialEvents !== undefined;
  const [events, setEvents] = useState<UsageEvent[]>(initialEvents ?? []);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!seeded && pollMs > 0);

  useEffect(() => {
    if (pollMs <= 0) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(pollUrl);
        if (!response.ok) {
          throw new Error(`Usage feed returned ${response.status}`);
        }
        const payload: unknown = await response.json();
        const next = Array.isArray(payload)
          ? payload
          : payload && typeof payload === "object" && "events" in payload
            ? (payload as { events: unknown }).events
            : [];
        if (!cancelled && Array.isArray(next)) {
          setEvents(next.filter(isUsageEvent));
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Usage feed unavailable");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, pollMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollMs, pollUrl]);

  return (
    <details className="routing-dashboard-fold">
      <summary>Live routing</summary>
      <section
        className="routing-dashboard"
        aria-label="Live routing dashboard"
        aria-busy={loading}
      >
        {error ? (
          <p className="routing-dashboard-error" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p className="routing-dashboard-loading">Loading usage…</p>
        ) : events.length === 0 ? (
          <p className="routing-dashboard-empty">
            {error ? "Usage feed unavailable. Showing no events." : "No enrichment calls yet."}
          </p>
        ) : (
          <div className="routing-dashboard-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Feature</th>
                  <th scope="col">Tokens</th>
                  <th scope="col">Cost</th>
                  <th scope="col">Guardrail</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event, index) => (
                  <tr key={`${event.model}-${event.feature}-${index}`}>
                    <td>{event.model}</td>
                    <td>{event.feature}</td>
                    <td>{event.tokens}</td>
                    <td>{formatCost(event.cost)}</td>
                    <td>{event.guardrail_block ? event.guardrail_block : "ok"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </details>
  );
}

function isUsageEvent(value: unknown): value is UsageEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const event = value as Record<string, unknown>;
  return (
    typeof event.model === "string" &&
    typeof event.tokens === "number" &&
    typeof event.cost === "number" &&
    typeof event.feature === "string"
  );
}
