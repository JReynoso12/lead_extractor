"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, LayoutGrid, Users } from "lucide-react";
import {
  loadSearchHistory,
  loadUsageCount,
  type SearchHistoryEntry,
} from "@/lib/history-storage";

export default function DashboardPage() {
  const [usageCount] = useState(() => loadUsageCount());
  const [history] = useState<SearchHistoryEntry[]>(() => loadSearchHistory());

  const totalLeadsExtracted = useMemo(() => {
    return history.reduce((sum, entry) => sum + (entry.totalCleaned ?? 0), 0);
  }, [history]);

  const recent = history.slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-ui-muted">
            Stats and recent extraction activity (stored locally).
          </p>
        </div>

        <Link href="/extract" className="ui-button-primary inline-flex h-11 items-center justify-center gap-2 px-5">
          New Extraction
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="ui-surface p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-ui-subtle border border-ui-border p-2 text-ui-primary">
              <LayoutGrid size={18} />
            </div>
            <div>
              <div className="text-xs font-semibold text-ui-muted">Total searches</div>
              <div className="mt-1 text-2xl font-semibold text-ui-text">{usageCount || history.length}</div>
            </div>
          </div>
        </div>

        <div className="ui-surface p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-ui-subtle border border-ui-border p-2 text-ui-primary">
              <Users size={18} />
            </div>
            <div>
              <div className="text-xs font-semibold text-ui-muted">Total leads extracted</div>
              <div className="mt-1 text-2xl font-semibold text-ui-text">{totalLeadsExtracted}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="ui-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Recent activity</h2>
          <div className="text-xs text-ui-muted">Last {Math.min(5, history.length)} runs</div>
        </div>

        {recent.length === 0 ? (
          <div className="mt-4 rounded-xl border border-ui-border bg-ui-subtle p-4 text-sm text-ui-muted">
            No searches yet
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {recent.map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border border-ui-border bg-ui-surface p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="text-sm font-semibold text-ui-text">{entry.category}</div>
                  <div className="text-sm text-ui-muted">{entry.location}</div>
                  <div className="mt-1 text-xs text-ui-muted">
                    <span className="inline-flex items-center gap-2">
                      <CalendarClock size={12} /> {new Date(entry.dateISO).toLocaleString()}
                    </span>
                  </div>
                </div>
                <Link
                  href={`/extract?searchId=${encodeURIComponent(entry.id)}`}
                  className="ui-button-secondary inline-flex h-10 items-center justify-center px-4"
                >
                  View results again
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

