"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import {
  deleteSearchFromHistory,
  loadSearchHistory,
  type SearchHistoryEntry,
} from "@/lib/history-storage";

export default function HistoryPage() {
  const [history, setHistory] = useState<SearchHistoryEntry[]>(() =>
    loadSearchHistory(),
  );

  const hasHistory = history.length > 0;

  const displayed = useMemo(() => history.slice(0, 20), [history]);

  function onDelete(id: string) {
    deleteSearchFromHistory(id);
    setHistory(loadSearchHistory());
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="mt-1 text-sm text-ui-muted">Past searches and saved results.</p>
        </div>

        <Link
          href="/extract"
          className="ui-button-secondary inline-flex h-11 items-center justify-center px-5"
        >
          Back to extract
        </Link>
      </div>

      <div className="ui-surface p-5">
        {hasHistory ? (
          <div className="space-y-3">
            {displayed.map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border border-ui-border bg-ui-surface p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="text-sm font-semibold text-ui-text">{entry.category}</div>
                  <div className="text-sm text-ui-muted">{entry.location}</div>
                  <div className="mt-1 text-xs text-ui-muted">
                    {new Date(entry.dateISO).toLocaleString()}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/extract?searchId=${encodeURIComponent(entry.id)}`}
                    className="ui-button-secondary inline-flex h-10 items-center justify-center px-4"
                  >
                    View results again
                  </Link>
                  <button
                    type="button"
                    onClick={() => onDelete(entry.id)}
                    className="ui-button-secondary inline-flex h-10 items-center justify-center px-4"
                    aria-label="Delete search"
                  >
                    <Trash2 size={16} className="text-ui-muted" />
                    <span className="ml-2">Delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-ui-border bg-ui-subtle p-5 text-sm text-ui-muted">
            No searches yet
          </div>
        )}
      </div>
    </div>
  );
}

