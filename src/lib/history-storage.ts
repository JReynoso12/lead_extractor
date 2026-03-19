import type { CleanLead } from "@/types/leads";

export type SearchHistoryEntry = {
  id: string;
  category: string;
  location: string;
  dateISO: string; // ISO string
  provider: string;
  requestedLimit: number | null;
  totalExtracted: number;
  totalCleaned: number;
  leads: CleanLead[];
  warning?: string | null;
};

const SEARCH_HISTORY_STORAGE_KEY = "lead_extractor_search_history_v1";
const LAST_SEARCH_STORAGE_KEY = "lead_extractor_last_search_v1";
const USAGE_COUNT_STORAGE_KEY = "lead_extractor_usage_count_v1";

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function createSearchId(): string {
  // Stable enough for localStorage-only usage.
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadSearchHistory(): SearchHistoryEntry[] {
  if (typeof window === "undefined") return [];
  const parsed = safeJsonParse<SearchHistoryEntry[]>(
    window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY),
  );
  if (!parsed || !Array.isArray(parsed)) return [];

  return parsed
    .filter((x) => x && typeof x.id === "string")
    .sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
}

export function saveSearchToHistory(entry: SearchHistoryEntry) {
  if (typeof window === "undefined") return;

  const history = loadSearchHistory();
  const next = [entry, ...history].slice(0, 15); // keep recent searches only
  window.localStorage.setItem(
    SEARCH_HISTORY_STORAGE_KEY,
    JSON.stringify(next),
  );
  window.localStorage.setItem(
    LAST_SEARCH_STORAGE_KEY,
    JSON.stringify({
      id: entry.id,
      category: entry.category,
      location: entry.location,
    }),
  );

  const currentUsage = Number(
    window.localStorage.getItem(USAGE_COUNT_STORAGE_KEY) ?? "0",
  );
  const nextUsage = Number.isFinite(currentUsage) ? currentUsage + 1 : 1;
  window.localStorage.setItem(
    USAGE_COUNT_STORAGE_KEY,
    String(nextUsage),
  );
}

export function loadLastSearch(): {
  id: string;
  category: string;
  location: string;
} | null {
  if (typeof window === "undefined") return null;
  const parsed = safeJsonParse<{ id: string; category: string; location: string }>(
    window.localStorage.getItem(LAST_SEARCH_STORAGE_KEY),
  );
  if (!parsed?.id) return null;
  return parsed;
}

export function loadSearchById(id: string): SearchHistoryEntry | null {
  if (typeof window === "undefined") return null;
  const history = loadSearchHistory();
  return history.find((x) => x.id === id) ?? null;
}

export function deleteSearchFromHistory(id: string) {
  if (typeof window === "undefined") return;
  const history = loadSearchHistory();
  const next = history.filter((x) => x.id !== id);
  window.localStorage.setItem(
    SEARCH_HISTORY_STORAGE_KEY,
    JSON.stringify(next),
  );

  const lastRaw = window.localStorage.getItem(LAST_SEARCH_STORAGE_KEY);
  const lastParsed = safeJsonParse<{ id: string }>(lastRaw);
  if (lastParsed?.id === id) {
    window.localStorage.removeItem(LAST_SEARCH_STORAGE_KEY);
  }
}

export function loadUsageCount(): number {
  if (typeof window === "undefined") return 0;
  const current = Number(window.localStorage.getItem(USAGE_COUNT_STORAGE_KEY) ?? "0");
  return Number.isFinite(current) ? current : 0;
}

