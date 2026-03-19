"use client";

import {
  Check,
  Copy,
  Download,
  Loader2,
  Search,
  Star,
  StarOff,
  Sparkles,
} from "lucide-react";
import type { CleanLead } from "@/types/leads";
import {
  createSearchId,
  loadLastSearch,
  loadSearchById,
  loadSearchHistory,
  saveSearchToHistory,
} from "@/lib/history-storage";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type Lead = CleanLead;

type LeadResponse = {
  business_category: string;
  location: string;
  provider: string;
  requested_limit: number | null;
  total_extracted: number;
  total_cleaned: number;
  leads: Lead[];
  warning?: string | null;
};

type ProgressStep = "input" | "extract" | "review" | "download";
type SortKey = "business_name" | "address" | "phone" | "email" | "website";

const EXPORTED_LEADS_STORAGE_KEY = "exported_lead_keys_v1";
const FAVORITES_STORAGE_KEY = "lead_extractor_favorite_lead_keys_v1";

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

function websiteHost(website: string): string {
  return website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
    .toLowerCase();
}

function getLeadKey(lead: Lead): string {
  // Keep this key aligned with `getDedupKey()` in `src/lib/lead-cleaner.ts`.
  const name = lead.business_name.trim().toLowerCase();
  const address = lead.address.trim().toLowerCase();
  const phone = normalizePhone(lead.phone);
  const host = websiteHost(lead.website);
  return `${name}|${address}|${host}|${phone}`;
}

function loadExportedLeadKeys(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(EXPORTED_LEADS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((x) => String(x)));
  } catch {
    return new Set();
  }
}

function persistExportedLeadKeys(keys: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      EXPORTED_LEADS_STORAGE_KEY,
      JSON.stringify(Array.from(keys)),
    );
  } catch {
    // If localStorage is blocked/unavailable, we just won't persist across runs.
  }
}

function markLeadsAsExported(leads: Lead[]) {
  const keys = loadExportedLeadKeys();
  for (const lead of leads) {
    if (!lead.business_name || !lead.address) continue;
    keys.add(getLeadKey(lead));
  }
  persistExportedLeadKeys(keys);
}

function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function loadFavoriteLeadKeys(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((x) => String(x)));
  } catch {
    return new Set();
  }
}

function persistFavoriteLeadKeys(keys: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      safeJsonStringify(Array.from(keys)) ?? "[]",
    );
  } catch {
    // ignore
  }
}

function safeClipboardWrite(text: string) {
  const fallbackCopy = () => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.left = "-1000px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
    } catch {
      // Ignore
    }
    document.body.removeChild(textarea);
  };

  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(fallbackCopy);
      return;
    }
  } catch {
    // Ignore and fall back below.
  }

  fallbackCopy();
}

function StepStatus({
  step,
  label,
  flowStep,
  error,
  loading,
}: {
  step: ProgressStep;
  label: string;
  flowStep: ProgressStep;
  error: string;
  loading: boolean;
}) {
  const stepOrder: Record<ProgressStep, number> = {
    input: 0,
    extract: 1,
    review: 2,
    download: 3,
  };

  const currentIdx = stepOrder[flowStep];
  const stepIdx = stepOrder[step];

  const isLoading = loading && flowStep === step;
  const isDone = !error && stepIdx < currentIdx;
  const isActive = flowStep === step && step !== "input";
  const shouldShowCheck = !error && (isDone || (stepIdx === currentIdx && step !== "input"));

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-white ${
          isDone
            ? "bg-emerald-600"
            : isLoading || isActive
              ? "bg-ui-primary"
              : "bg-slate-400"
        }`}
      >
        {isLoading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : shouldShowCheck ? (
          <Check size={14} />
        ) : (
          <span className="text-xs">•</span>
        )}
      </span>
      {label}
    </div>
  );
}

export default function ExtractPage() {
  const searchParams = useSearchParams();
  const searchIdFromQuery = searchParams.get("searchId");

  const [businessCategory, setBusinessCategory] = useState("");
  const [location, setLocation] = useState("");
  const [maxResults, setMaxResults] = useState(100);

  const [loading, setLoading] = useState(false);
  const [flowStep, setFlowStep] = useState<ProgressStep>("input");
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<LeadResponse | null>(null);

  const [formErrors, setFormErrors] = useState<{
    businessCategory?: string;
    location?: string;
  }>({});

  // Results UX (search, sorting, filtering, pagination)
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyWithEmail, setOnlyWithEmail] = useState(false);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("business_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  // Table selection UX
  const [selectedLeadKeys, setSelectedLeadKeys] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  // Favorites UX
  const [favoriteLeadKeys, setFavoriteLeadKeys] = useState<Set<string>>(
    new Set(),
  );

  // Landing/history UX
  const [recentSearches, setRecentSearches] = useState<
    Array<{ id: string; category: string; location: string; dateISO: string }>
  >([]);

  const [recentSearchSelectedId, setRecentSearchSelectedId] = useState<string>("");

  const [feedback, setFeedback] = useState<string | null>(null);

  function setTimedFeedback(message: string) {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 2500);
  }

  // Initialize favorites + recent searches + (optional) load history result.
  useEffect(() => {
    setFavoriteLeadKeys(loadFavoriteLeadKeys());

    const history = loadSearchHistory();
    setRecentSearches(
      history.slice(0, 6).map((x) => ({
        id: x.id,
        category: x.category,
        location: x.location,
        dateISO: x.dateISO,
      })),
    );

    const last = loadLastSearch();
    if (last) {
      setBusinessCategory(last.category);
      setLocation(last.location);
      setRecentSearchSelectedId(last.id);
    }

    if (searchIdFromQuery) {
      const entry = loadSearchById(searchIdFromQuery);
      if (entry) {
        setBusinessCategory(entry.category);
        setLocation(entry.location);
        setMaxResults(entry.requestedLimit ?? 100);

        const stored: LeadResponse = {
          business_category: entry.category,
          location: entry.location,
          provider: entry.provider,
          requested_limit: entry.requestedLimit,
          total_extracted: entry.totalExtracted,
          total_cleaned: entry.totalCleaned,
          leads: entry.leads,
          warning: entry.warning ?? null,
        };

        setResult(stored);
        setFlowStep("review");
        setProgressPct(100);
        setLoading(false);
        setError("");
        setSearchQuery("");
        setOnlyWithEmail(false);
        setOnlyFavorites(false);
        setSortKey("business_name");
        setSortDir("asc");
        setPageSize(10);
        setCurrentPage(1);
        setSelectedLeadKeys(new Set());
        setRecentSearchSelectedId(entry.id);
      }
    }
  }, [searchIdFromQuery]);

  const filteredLeads = useMemo(() => {
    if (!result) return [];
    let leads = result.leads;

    if (onlyWithEmail) {
      leads = leads.filter((lead) => Boolean(lead.email));
    }

    if (onlyFavorites && favoriteLeadKeys.size > 0) {
      leads = leads.filter((lead) => favoriteLeadKeys.has(getLeadKey(lead)));
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      leads = leads.filter((lead) => {
        const haystack = [
          lead.business_name,
          lead.address,
          lead.phone,
          lead.email,
          lead.website,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return leads;
  }, [favoriteLeadKeys, onlyFavorites, onlyWithEmail, result, searchQuery]);

  const sortedLeads = useMemo(() => {
    const leads = [...filteredLeads];
    leads.sort((a, b) => {
      const av = (a[sortKey] || "").toString().toLowerCase();
      const bv = (b[sortKey] || "").toString().toLowerCase();
      const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return leads;
  }, [filteredLeads, sortDir, sortKey]);

  const leadsFound = sortedLeads.length;
  const pageCount = Math.max(1, Math.ceil(leadsFound / pageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [onlyWithEmail, onlyFavorites, searchQuery, sortKey, sortDir, pageSize, result]);

  const pagedLeads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedLeads.slice(start, start + pageSize);
  }, [currentPage, pageSize, sortedLeads]);

  const leadsForActions = filteredLeads;

  const filteredLeadKeysSet = useMemo(() => {
    const set = new Set<string>();
    for (const lead of filteredLeads) set.add(getLeadKey(lead));
    return set;
  }, [filteredLeads]);

  useEffect(() => {
    // Prune selection when filters/search change.
    setSelectedLeadKeys((prev) => {
      const next = new Set<string>();
      for (const key of prev) if (filteredLeadKeysSet.has(key)) next.add(key);
      return next;
    });
  }, [filteredLeadKeysSet]);

  const selectedLeads = useMemo(() => {
    if (selectedLeadKeys.size === 0) return [];
    return filteredLeads.filter((lead) => selectedLeadKeys.has(getLeadKey(lead)));
  }, [filteredLeads, selectedLeadKeys]);

  const selectedCount = selectedLeads.length;
  const isAllSelected = filteredLeadKeysSet.size > 0 && selectedCount === filteredLeadKeysSet.size;

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = selectedCount > 0 && !isAllSelected;
  }, [isAllSelected, selectedCount]);

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir("asc");
  }

  const avgScore = useMemo(() => {
    if (leadsForActions.length === 0) return 0;
    const scoreTotal = leadsForActions.reduce((sum, lead) => {
      let score = 50;
      if (lead.website) score += 15;
      if (lead.phone) score += 15;
      if (lead.email) score += 20;
      return sum + score;
    }, 0);
    return Math.round(scoreTotal / leadsForActions.length);
  }, [leadsForActions]);

  const emailCountSelected = selectedLeads.filter((lead) => Boolean(lead.email)).length;
  const phoneCountSelected = selectedLeads.filter((lead) => Boolean(lead.phone)).length;

  function toggleFavorite(lead: Lead) {
    const key = getLeadKey(lead);
    setFavoriteLeadKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistFavoriteLeadKeys(next);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: {
      businessCategory?: string;
      location?: string;
    } = {};

    if (!businessCategory.trim()) nextErrors.businessCategory = "Please enter a category";
    if (!location.trim()) nextErrors.location = "Please enter a location";

    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    setFlowStep("extract");
    setProgressPct(10);
    setError("");
    setResult(null);
    setSearchQuery("");
    setOnlyWithEmail(false);
    setOnlyFavorites(false);
    setSortKey("business_name");
    setSortDir("asc");
    setPageSize(10);
    setCurrentPage(1);
    setSelectedLeadKeys(new Set());

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 90000);
    const progressTimers = [
      window.setTimeout(() => setProgressPct(30), 1000),
      window.setTimeout(() => setProgressPct(60), 2200),
      window.setTimeout(() => setProgressPct(90), 3600),
    ];

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          business_category: businessCategory,
          location,
          max_results: maxResults,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to extract and clean leads.");
      }

      const incoming = data as LeadResponse;
      const exportedKeys = loadExportedLeadKeys();
      const filteredLeadsToSave = incoming.leads.filter((lead) => !exportedKeys.has(getLeadKey(lead)));

      const stored: LeadResponse = {
        ...incoming,
        total_cleaned: filteredLeadsToSave.length,
        leads: filteredLeadsToSave,
      };

      setResult(stored);
      setFlowStep("review");
      setProgressPct(100);

      // Persist search history so `/history` and "view results again" work without a DB.
      const entryId = createSearchId();
      saveSearchToHistory({
        id: entryId,
        category: businessCategory,
        location,
        dateISO: new Date().toISOString(),
        provider: stored.provider,
        requestedLimit: stored.requested_limit,
        totalExtracted: stored.total_extracted,
        totalCleaned: stored.total_cleaned,
        leads: stored.leads,
        warning: stored.warning ?? null,
      });

      setRecentSearches(
        loadSearchHistory()
          .slice(0, 6)
          .map((x) => ({ id: x.id, category: x.category, location: x.location, dateISO: x.dateISO })),
      );

      // Clear any prior selection; new results are "fresh".
      setSelectedLeadKeys(new Set());
    } catch (err) {
      const message = (() => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return "Request timed out. Try again.";
        }
        if (err instanceof Error) return err.message;
        return "Something went wrong. Try again.";
      })();
      setError(message);
    } finally {
      window.clearTimeout(timeoutId);
      for (const t of progressTimers) window.clearTimeout(t);
      setLoading(false);
      setProgressPct((p) => (p < 100 ? p : 100));
    }
  }

  function downloadCsv(leads: Lead[]) {
    if (leads.length === 0) return;
    const headers = ["Business Name", "Address", "Phone Number", "Email", "Website"];
    const rows = leads.map((lead) => [
      lead.business_name,
      lead.address,
      lead.phone,
      lead.email,
      lead.website,
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        row
          .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
          .join(","),
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "cleaned_leads.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    markLeadsAsExported(leads);
    setFlowStep("download");
    setTimedFeedback("Downloaded successfully");
  }

  function copyEmails(leads: Lead[]) {
    if (leads.length === 0) return;
    const emails = leads.map((lead) => lead.email.trim()).filter(Boolean).join("\n");
    safeClipboardWrite(emails);
    markLeadsAsExported(leads);
    setFlowStep("download");
    setTimedFeedback("Copied successfully");
  }

  function copyPhones(leads: Lead[]) {
    if (leads.length === 0) return;
    const phones = leads.map((lead) => lead.phone.trim()).filter(Boolean).join("\n");
    safeClipboardWrite(phones);
    markLeadsAsExported(leads);
    setFlowStep("download");
    setTimedFeedback("Copied successfully");
  }

  function copyAllData(leads: Lead[]) {
    if (leads.length === 0) return;

    const headers = ["Business Name", "Address", "Phone Number", "Email", "Website"];
    const rows = leads.map((lead) => [
      lead.business_name,
      lead.address,
      lead.phone,
      lead.email,
      lead.website,
    ]);

    const tsv = [
      headers.join("\t"),
      ...rows.map((row) => row.map((cell) => String(cell ?? "").replaceAll("\t", " ")).join("\t")),
    ].join("\n");

    safeClipboardWrite(tsv);
    markLeadsAsExported(leads);
    setFlowStep("download");
    setTimedFeedback("Copied successfully");
  }

  function copySingleRowData(lead: Lead) {
    const row = [
      lead.business_name,
      lead.address,
      lead.phone,
      lead.email,
      lead.website,
    ].map((x) => String(x ?? "").replaceAll("\t", " ")).join("\t");

    safeClipboardWrite(row);
    markLeadsAsExported([lead]);
    setFlowStep("download");
    setTimedFeedback("Copied lead successfully");
  }

  function handleSelectAll() {
    if (isAllSelected) {
      setSelectedLeadKeys(new Set());
      return;
    }
    const next = new Set<string>();
    for (const key of filteredLeadKeysSet) next.add(key);
    setSelectedLeadKeys(next);
  }

  const providerLabel = result?.provider === "openstreetmap" ? "OpenStreetMap" : "Google Maps";

  return (
    <div className="space-y-6">
      <div className="ui-surface p-6 sm:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-ui-subtle px-3 py-1 text-xs font-semibold text-ui-text">
              <Sparkles size={14} /> No login required
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
              Extract Leads
            </h1>
            <p className="mt-2 text-sm text-ui-muted">
              Enter a business category + location, then review and export the results.
            </p>
          </div>

          <div className="rounded-xl border border-ui-border bg-ui-surface p-4 text-sm text-ui-muted w-full md:w-[320px]">
            <div className="font-semibold text-ui-text">Recent searches</div>
            <div className="mt-2">
              <select
                className="ui-input h-10"
                value={recentSearchSelectedId}
                onChange={(e) => {
                  const chosenId = e.target.value;
                  setRecentSearchSelectedId(chosenId);
                  if (!chosenId) return;
                  const entry = loadSearchById(chosenId);
                  if (!entry) return;
                  setBusinessCategory(entry.category);
                  setLocation(entry.location);
                  setMaxResults(entry.requestedLimit ?? 100);
                  setSelectedLeadKeys(new Set());
                  setResult(null);
                  setFlowStep("input");
                  setProgressPct(0);
                  setError("");
                }}
              >
                <option value="">Auto-fill last search</option>
                {recentSearches.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.category} • {x.location}
                  </option>
                ))}
              </select>
              <div className="mt-2 text-xs">
                Tip: switch categories quickly without retyping.
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 grid gap-4 md:grid-cols-12">
          <label className="md:col-span-5">
            <span className="mb-2 block text-sm font-medium text-ui-text">
              Business category
            </span>
            <input
              autoFocus
              value={businessCategory}
              onChange={(e) => setBusinessCategory(e.target.value)}
              placeholder="e.g. Restaurants"
              className="ui-input h-11"
              disabled={loading}
              aria-invalid={Boolean(formErrors.businessCategory)}
            />
            {formErrors.businessCategory ? (
              <p className="mt-1 text-xs text-red-700">{formErrors.businessCategory}</p>
            ) : null}
          </label>

          <label className="md:col-span-5">
            <span className="mb-2 block text-sm font-medium text-ui-text">
              Location
            </span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. London"
              className="ui-input h-11"
              disabled={loading}
              aria-invalid={Boolean(formErrors.location)}
            />
            {formErrors.location ? (
              <p className="mt-1 text-xs text-red-700">{formErrors.location}</p>
            ) : null}
          </label>

          <label className="md:col-span-2">
            <span className="mb-2 block text-sm font-medium text-ui-text">
              Max leads
            </span>
            <input
              type="number"
              min={1}
              max={100}
              value={maxResults}
              onChange={(e) =>
                setMaxResults(
                  Number.isNaN(Number(e.target.value))
                    ? 1
                    : Math.min(100, Math.max(1, Number(e.target.value))),
                )
              }
              className="ui-input h-11"
              disabled={loading}
            />
          </label>

          <div className="md:col-span-2 md:self-end">
            <button
              type="submit"
              disabled={loading}
              className="ui-button-primary inline-flex h-11 w-full items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              {loading ? "Extracting..." : "Extract Leads Now"}
            </button>
          </div>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-ui-muted">
            <StepStatus step="input" label="Step 1: Input" flowStep={flowStep} error={error} loading={loading} />
            <div className="h-px w-8 bg-ui-border" />
            <StepStatus step="extract" label="Step 2: Extract" flowStep={flowStep} error={error} loading={loading} />
            <div className="h-px w-8 bg-ui-border" />
            <StepStatus step="review" label="Step 3: Review" flowStep={flowStep} error={error} loading={loading} />
            <div className="h-px w-8 bg-ui-border" />
            <StepStatus step="download" label="Step 4: Export" flowStep={flowStep} error={error} loading={loading} />
          </div>

          {loading ? (
            <div className="flex items-center gap-3 text-sm text-ui-muted">
              <span className="font-semibold text-ui-text">{progressPct}%</span>
            </div>
          ) : null}
        </div>
      </div>

      {result && !loading && !error && flowStep === "review" ? (
        <div className="ui-surface p-4 text-sm text-ui-muted">
          <span className="font-semibold text-ui-text">Extraction complete.</span>{" "}
          {result.leads.length} leads ready for review.
        </div>
      ) : null}

      {feedback ? (
        <div className="ui-surface border border-ui-border px-4 py-3 text-sm">
          <div className="font-semibold text-ui-text">{feedback}</div>
        </div>
      ) : null}

      {error ? (
        <section className="ui-surface border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">Something went wrong. Try again.</p>
          <p className="mt-1">{error}</p>
        </section>
      ) : null}

      {!result && !loading && !error ? (
        <section className="ui-surface p-5 text-sm text-ui-muted">
          Start by extracting your first leads.
        </section>
      ) : null}

      {loading && !result ? (
        <section className="space-y-4">
          <div className="ui-surface p-4 text-sm text-ui-muted">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-ui-primary" />
                <span className="font-semibold text-ui-text">
                  Extracting leads... please wait
                </span>
              </div>
              <span className="font-semibold text-ui-text">{progressPct}%</span>
            </div>
            <div className="mt-2 text-xs">Scraping + verifying contact details.</div>
          </div>

          <div className="ui-surface overflow-hidden">
            <div className="overflow-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-ui-subtle text-ui-muted">
                  <tr>
                    <th className="sticky top-0 z-10 px-4 py-3 font-semibold bg-ui-subtle">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="sticky top-0 z-10 px-4 py-3 font-semibold bg-ui-subtle">
                      Business Name
                    </th>
                    <th className="sticky top-0 z-10 px-4 py-3 font-semibold bg-ui-subtle">
                      Address
                    </th>
                    <th className="sticky top-0 z-10 px-4 py-3 font-semibold bg-ui-subtle">
                      Phone
                    </th>
                    <th className="sticky top-0 z-10 px-4 py-3 font-semibold bg-ui-subtle">
                      Email
                    </th>
                    <th className="sticky top-0 z-10 px-4 py-3 font-semibold bg-ui-subtle">
                      Website
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-t border-ui-border">
                      <td className="px-4 py-3">
                        <div className="h-4 w-5 animate-pulse rounded bg-ui-subtle" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 w-40 animate-pulse rounded bg-ui-subtle" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 w-64 animate-pulse rounded bg-ui-subtle" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 w-36 animate-pulse rounded bg-ui-subtle" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 w-56 animate-pulse rounded bg-ui-subtle" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 w-52 animate-pulse rounded bg-ui-subtle" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="space-y-4">
          <div className="ui-surface flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-ui-muted">
              <span className="font-semibold text-ui-text">{leadsFound}</span> leads found
              {" | "}
              Avg score: <span className="font-semibold text-ui-text">{avgScore}</span>
              {" | "}
              Provider: <span className="font-semibold text-ui-text">{providerLabel}</span>
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => copyEmails(selectedLeads)}
                className="ui-button-secondary"
                disabled={selectedCount === 0 || emailCountSelected === 0}
                aria-label="Copy emails from selected rows"
              >
                Copy Emails ({emailCountSelected})
              </button>
              <button
                type="button"
                onClick={() => copyPhones(selectedLeads)}
                className="ui-button-secondary"
                disabled={selectedCount === 0 || phoneCountSelected === 0}
                aria-label="Copy phone numbers from selected rows"
              >
                Copy Phone Numbers ({phoneCountSelected})
              </button>
              <button
                type="button"
                onClick={() => downloadCsv(selectedLeads)}
                className="ui-button-secondary inline-flex items-center gap-2"
                disabled={selectedCount === 0}
                aria-label="Export selected rows to CSV"
              >
                <Download size={14} />
                Export selected ({selectedCount})
              </button>
            </div>
          </div>

          <div className="ui-surface flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Search size={16} className="text-ui-muted" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search leads… (name, address, phone, email)"
                className="ui-input h-10 w-full sm:w-96"
              />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-ui-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyWithEmail}
                  onChange={(e) => setOnlyWithEmail(e.target.checked)}
                />
                Only show businesses with email
              </label>

              <label className="inline-flex items-center gap-2 text-sm text-ui-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyFavorites}
                  onChange={(e) => setOnlyFavorites(e.target.checked)}
                  disabled={favoriteLeadKeys.size === 0}
                />
                Only favorites
              </label>

              <div className="flex items-center gap-2 text-sm text-ui-muted">
                <span>Rows:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="ui-input h-10 w-auto"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>
          </div>

          <div className="ui-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-ui-muted">
                <span className="font-semibold text-ui-text">{filteredLeads.length}</span> matched rows
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="ui-button-secondary"
                  onClick={() => copyAllData(leadsForActions)}
                  disabled={leadsForActions.length === 0}
                >
                  <Copy size={14} className="mr-2" />
                  Copy all data
                </button>
                <button
                  type="button"
                  className="ui-button-secondary inline-flex items-center gap-2"
                  onClick={() => downloadCsv(leadsForActions)}
                  disabled={leadsForActions.length === 0}
                >
                  <Download size={14} />
                  Export to CSV
                </button>
              </div>
            </div>
          </div>

          {leadsFound > 0 ? (
            <div className="ui-surface overflow-hidden">
              <div className="overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-ui-subtle text-ui-muted">
                    <tr>
                      <th className="sticky top-0 z-10 px-4 py-3 font-semibold bg-ui-subtle">
                        <input
                          ref={selectAllRef}
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={handleSelectAll}
                          aria-label="Select all filtered leads"
                        />
                      </th>

                      <th className="sticky top-0 z-10 px-4 py-3 font-semibold bg-ui-subtle">
                        <button
                          type="button"
                          onClick={() => toggleSort("business_name")}
                          className="inline-flex items-center gap-2 hover:text-ui-text"
                        >
                          Business Name
                          {sortKey === "business_name" ? (
                            <span className="text-ui-text">{sortDir === "asc" ? "↑" : "↓"}</span>
                          ) : null}
                        </button>
                      </th>

                      <th className="sticky top-0 z-10 px-4 py-3 font-semibold bg-ui-subtle">
                        <button
                          type="button"
                          onClick={() => toggleSort("address")}
                          className="inline-flex items-center gap-2 hover:text-ui-text"
                        >
                          Address
                          {sortKey === "address" ? (
                            <span className="text-ui-text">{sortDir === "asc" ? "↑" : "↓"}</span>
                          ) : null}
                        </button>
                      </th>

                      <th className="sticky top-0 z-10 px-4 py-3 font-semibold bg-ui-subtle">
                        <button
                          type="button"
                          onClick={() => toggleSort("phone")}
                          className="inline-flex items-center gap-2 hover:text-ui-text"
                        >
                          Phone
                          {sortKey === "phone" ? (
                            <span className="text-ui-text">{sortDir === "asc" ? "↑" : "↓"}</span>
                          ) : null}
                        </button>
                      </th>

                      <th className="sticky top-0 z-10 px-4 py-3 font-semibold bg-ui-subtle">
                        <button
                          type="button"
                          onClick={() => toggleSort("email")}
                          className="inline-flex items-center gap-2 hover:text-ui-text"
                        >
                          Email
                          {sortKey === "email" ? (
                            <span className="text-ui-text">{sortDir === "asc" ? "↑" : "↓"}</span>
                          ) : null}
                        </button>
                      </th>

                      <th className="sticky top-0 z-10 px-4 py-3 font-semibold bg-ui-subtle">
                        <button
                          type="button"
                          onClick={() => toggleSort("website")}
                          className="inline-flex items-center gap-2 hover:text-ui-text"
                        >
                          Website
                          {sortKey === "website" ? (
                            <span className="text-ui-text">{sortDir === "asc" ? "↑" : "↓"}</span>
                          ) : null}
                        </button>
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {pagedLeads.map((lead) => {
                      const key = getLeadKey(lead);
                      const isSelected = selectedLeadKeys.has(key);
                      const isFav = favoriteLeadKeys.has(key);
                      return (
                        <tr key={key} className="border-t border-ui-border">
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSelectedLeadKeys((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(key);
                                  else next.delete(key);
                                  return next;
                                });
                              }}
                              aria-label={`Select ${lead.business_name}`}
                            />
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-ui-text">{lead.business_name}</span>
                              <button
                                type="button"
                                onClick={() => toggleFavorite(lead)}
                                className="text-ui-muted hover:text-ui-text transition-colors"
                                aria-label={isFav ? "Unfavorite lead" : "Favorite lead"}
                              >
                                {isFav ? <Star size={16} className="fill-ui-primary text-ui-primary" /> : <StarOff size={16} />}
                              </button>
                            </div>

                            <button
                              type="button"
                              className="mt-2 ui-button-secondary inline-flex items-center gap-2 px-2 py-1"
                              onClick={() => copySingleRowData(lead)}
                              aria-label="Copy this row data"
                            >
                              <Copy size={14} />
                              Copy
                            </button>
                          </td>

                          <td className="px-4 py-3 text-ui-muted">{lead.address}</td>

                          <td className="px-4 py-3 text-ui-muted">
                            {lead.phone ? (
                              <a
                                className="underline-offset-2 hover:underline text-ui-text"
                                href={`tel:${lead.phone}`}
                              >
                                {lead.phone}
                              </a>
                            ) : (
                              "-"
                            )}
                          </td>

                          <td className="px-4 py-3 text-ui-muted">
                            {lead.email ? (
                              <a
                                className="underline-offset-2 hover:underline text-ui-text"
                                href={`mailto:${lead.email}`}
                              >
                                {lead.email}
                              </a>
                            ) : (
                              "-"
                            )}
                          </td>

                          <td className="px-4 py-3">
                            {lead.website ? (
                              <a
                                href={lead.website}
                                target="_blank"
                                rel="noreferrer"
                                className="text-ui-text underline-offset-2 hover:underline"
                              >
                                {websiteHost(lead.website)}
                              </a>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="ui-surface p-5 text-sm text-ui-muted">
              No results found. Try adjusting your filters or search.
            </div>
          )}

          {leadsFound > 0 && pageCount > 1 ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-ui-muted">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="ui-button-secondary"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
                  disabled={currentPage >= pageCount}
                  className="ui-button-secondary"
                >
                  Next
                </button>
              </div>
              <div>
                Page <span className="font-semibold text-ui-text">{currentPage}</span> of{" "}
                <span className="font-semibold text-ui-text">{pageCount}</span>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

