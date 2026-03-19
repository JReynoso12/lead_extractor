"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Loader2, Search, Sparkles } from "lucide-react";

type Lead = {
  business_name: string;
  address: string;
  website: string;
  phone: string;
  email: string;
};

type LeadResponse = {
  business_category: string;
  location: string;
  provider: string;
  requested_limit: number | null;
  total_extracted: number;
  total_cleaned: number;
  leads: Lead[];
};

export default function Home() {
  type ProgressStep = "input" | "extract" | "review" | "download";
  type SortKey = "business_name" | "address" | "phone" | "email" | "website";

  const EXPORTED_LEADS_STORAGE_KEY = "exported_lead_keys_v1";

  function normalizePhone(phone: string): string {
    return phone.replace(/[^\d+]/g, "");
  }

  function websiteHost(website: string): string {
    return website
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .toLowerCase();
  }

  // Keep this key aligned with `getDedupKey()` in `src/lib/lead-cleaner.ts`.
  function getLeadKey(lead: Lead): string {
    const name = lead.business_name.trim().toLowerCase();
    const address = lead.address.trim().toLowerCase();
    const phone = normalizePhone(lead.phone);
    const host = websiteHost(lead.website);
    return `${name}|${address}|${host}|${phone}`;
  }

  function loadExportedLeadKeys(): Set<string> {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(
        EXPORTED_LEADS_STORAGE_KEY,
      );
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
      // Skip obviously incomplete rows to avoid storing junk keys.
      if (!lead.business_name || !lead.address) continue;
      keys.add(getLeadKey(lead));
    }
    persistExportedLeadKeys(keys);
  }

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
  const [sortKey, setSortKey] = useState<SortKey>("business_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const formRef = useRef<HTMLDivElement | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: {
      businessCategory?: string;
      location?: string;
    } = {};

    if (!businessCategory.trim()) {
      nextErrors.businessCategory = "Please enter a category";
    }
    if (!location.trim()) {
      nextErrors.location = "Please enter a location";
    }

    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    setFlowStep("extract");
    setProgressPct(10);
    setError("");
    setResult(null);
    setSearchQuery("");
    setOnlyWithEmail(false);
    setSortKey("business_name");
    setSortDir("asc");
    setPageSize(10);
    setCurrentPage(1);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
    const progressTimers = [
      window.setTimeout(() => setProgressPct(30), 1000),
      window.setTimeout(() => setProgressPct(60), 2200),
      window.setTimeout(() => setProgressPct(90), 3600),
    ];

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
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

      // Filter out leads that were already exported on previous runs.
      const exportedKeys = loadExportedLeadKeys();
      const incoming = data as LeadResponse;
      const filteredLeads = incoming.leads.filter(
        (lead) => !exportedKeys.has(getLeadKey(lead)),
      );

      setResult({
        ...incoming,
        total_cleaned: filteredLeads.length,
        leads: filteredLeads,
      });
      setFlowStep("review");
      setProgressPct(100);
    } catch (err) {
      const message = (() => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return "Request timed out. Try again.";
        }
        if (err instanceof Error) return err.message;
        return "Unexpected client error.";
      })();
      setError(message);
    } finally {
      clearTimeout(timeoutId);
      for (const t of progressTimers) clearTimeout(t);
      setLoading(false);
    }
  }

  function scrollToForm() {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir("asc");
  }

  function StepStatus({
    step,
    label,
  }: {
    step: ProgressStep;
    label: string;
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
    const shouldShowCheck =
      !error && (isDone || (stepIdx === currentIdx && step !== "input"));

    return (
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-white ${
            isDone ? "bg-emerald-600" : isLoading || isActive ? "bg-ui-primary" : "bg-slate-400"
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

  const filteredLeads = useMemo(() => {
    if (!result) return [];
    let leads = result.leads;

    if (onlyWithEmail) {
      leads = leads.filter((lead) => Boolean(lead.email));
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
  }, [onlyWithEmail, result, searchQuery]);

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
    // Keep pagination consistent after filters/sorting changes.
    setCurrentPage(1);
  }, [onlyWithEmail, searchQuery, sortKey, sortDir, pageSize, result]);

  const pagedLeads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedLeads.slice(start, start + pageSize);
  }, [currentPage, pageSize, sortedLeads]);

  const leadsForActions = filteredLeads;

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

  const emailCount = useMemo(() => {
    return leadsForActions.filter((lead) => Boolean(lead.email)).length;
  }, [leadsForActions]);

  const phoneCount = useMemo(() => {
    return leadsForActions.filter((lead) => Boolean(lead.phone)).length;
  }, [leadsForActions]);

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
        // If copy fails, we still don't want the UI to crash.
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

  function copyEmails() {
    if (leadsForActions.length === 0) return;
    const emails = leadsForActions
      .map((lead) => lead.email.trim())
      .filter(Boolean)
      .join("\n");
    safeClipboardWrite(emails);
    // Copy is also an "export" action, so mark these leads as exported.
    markLeadsAsExported(leadsForActions);
    setFlowStep("download");
  }

  function copyPhones() {
    if (leadsForActions.length === 0) return;
    const phones = leadsForActions
      .map((lead) => lead.phone.trim())
      .filter(Boolean)
      .join("\n");
    safeClipboardWrite(phones);
    markLeadsAsExported(leadsForActions);
    setFlowStep("download");
  }

  function copyAllData() {
    if (leadsForActions.length === 0) return;
    const headers = ["Business Name", "Address", "Phone Number", "Email", "Website"];
    const rows = leadsForActions.map((lead) => [
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
    markLeadsAsExported(leadsForActions);
    setFlowStep("download");
  }

  function downloadCsv(leads: Lead[]) {
    if (leads.length === 0) return;
    const headers = [
      "Business Name",
      "Address",
      "Phone Number",
      "Email",
      "Website",
    ];
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
  }

  const providerLabel =
    result?.provider === "openstreetmap" ? "OpenStreetMap" : "Google Maps";

  return (
    <div className="min-h-screen bg-ui-bg py-10 text-ui-text">
      <a
        href="#lead-form"
        className="sr-only focus:not-sr-only"
      >
        Skip to lead form
      </a>

      <nav className="mx-auto mb-10 flex w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ui-primary text-white font-semibold">
            L
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">LeadExtractor</div>
            <div className="text-xs text-ui-muted">Google Maps lead scraping</div>
          </div>
        </div>

        <div className="hidden items-center gap-5 text-sm text-ui-muted sm:flex">
          <a href="#features" className="hover:text-ui-text">Features</a>
          <a href="#about" className="hover:text-ui-text">About</a>
          <a href="#lead-form" className="hover:text-ui-text">Get Leads</a>
        </div>

        <button
          type="button"
          onClick={scrollToForm}
          className="ui-button-primary hidden h-10 items-center justify-center px-4 sm:inline-flex"
          aria-label="Get Leads Now"
        >
          Get Leads Now
        </button>
      </nav>

      <main className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <section className="ui-surface p-6 sm:p-8">
          <div className="grid items-center gap-8 md:grid-cols-12">
            <div className="md:col-span-7">
              <div className="inline-flex items-center gap-2 rounded-full bg-ui-subtle px-3 py-1 text-xs font-semibold text-ui-text">
                <Sparkles size={14} /> No login required
              </div>

              <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
                Extract Business Leads from Google Maps in Seconds
              </h1>
              <p className="mt-3 max-w-2xl text-sm text-ui-muted sm:text-base">
                Get emails, phone numbers, and addresses instantly. No manual work.
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={scrollToForm}
                  className="ui-button-primary inline-flex h-12 w-full items-center justify-center gap-2 sm:w-auto"
                >
                  Get Leads Now
                </button>
                <a
                  href="#features"
                  className="ui-button-secondary inline-flex h-12 w-full items-center justify-center gap-2 sm:w-auto"
                >
                  See Features
                </a>
              </div>

              <ul className="mt-6 space-y-2 text-sm text-ui-muted">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex"><Check size={16} className="text-ui-primary" /></span>
                  <span>No login required</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex"><Check size={16} className="text-ui-primary" /></span>
                  <span>Fast &amp; accurate results</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex"><Check size={16} className="text-ui-primary" /></span>
                  <span>Export to CSV</span>
                </li>
              </ul>
            </div>

            <div className="md:col-span-5">
              <div className="rounded-2xl border border-ui-border bg-ui-subtle p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold">Fast, clean lead data</div>
                    <div className="mt-1 text-sm text-ui-muted">
                      Extract, verify, and export-ready records.
                    </div>
                  </div>
                  <div className="rounded-xl bg-ui-primary text-white px-3 py-2 text-sm font-semibold">
                    Free
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-ui-surface border border-ui-border p-3">
                    <div className="text-xs font-semibold text-ui-muted">Output</div>
                    <div className="mt-1 text-sm font-semibold text-ui-text">CSV + Copy</div>
                  </div>
                  <div className="rounded-xl bg-ui-surface border border-ui-border p-3">
                    <div className="text-xs font-semibold text-ui-muted">Quality</div>
                    <div className="mt-1 text-sm font-semibold text-ui-text">Verified leads</div>
                  </div>
                  <div className="rounded-xl bg-ui-surface border border-ui-border p-3 sm:col-span-2">
                    <div className="text-xs font-semibold text-ui-muted">How it works</div>
                    <div className="mt-1 text-sm font-semibold text-ui-text">
                      Enter category &amp; location → extract → review → download
                    </div>
                  </div>
                </div>
              </div>

              <div id="features" className="mt-6">
                <div className="text-sm font-semibold text-ui-text">Used by 1,200+ marketers</div>
                <div className="mt-1 text-xs text-ui-muted">
                  Built for speed, accuracy, and real outreach workflows.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="about" className="ui-surface mt-6 p-5 sm:p-6">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">About LeadExtractor</h2>
              <p className="mt-1 text-sm text-ui-muted">
                Generate verified business leads from Google Maps (or OpenStreetMap when needed),
                then export them instantly to CSV or copy contact info.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <div className="rounded-xl border border-ui-border bg-ui-subtle px-3 py-1 text-xs font-semibold text-ui-muted">
                  No login required
                </div>
                <div className="rounded-xl border border-ui-border bg-ui-subtle px-3 py-1 text-xs font-semibold text-ui-muted">
                  Free to use
                </div>
                <div className="rounded-xl border border-ui-border bg-ui-subtle px-3 py-1 text-xs font-semibold text-ui-muted">
                  Fast &amp; reliable scraping
                </div>
              </div>
            </div>
            <div className="rounded-xl bg-ui-subtle border border-ui-border px-4 py-3 text-sm text-ui-muted">
              <span className="font-semibold text-ui-text">No API key needed</span>
            </div>
          </div>
        </section>

        <section
          id="lead-form"
          ref={formRef}
          className="ui-surface mt-6 p-5 sm:p-6"
        >
          <div className="mb-4">
            <h2 className="text-base font-semibold">Extract Leads</h2>
            <p className="mt-1 text-sm text-ui-muted">
              Enter your niche and area. Hit the button to extract leads.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-12">
            <label className="md:col-span-4">
              <span className="mb-2 block text-sm font-medium text-ui-text">
                Business Category
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

            <label className="md:col-span-4">
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
                {loading ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Search size={15} />
                )}
                {loading ? "Extracting..." : "Extract Leads Now"}
              </button>
            </div>
          </form>
        </section>

        <section className="ui-surface mt-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-ui-muted">
              <StepStatus step="input" label="Enter category & location" />
              <div className="h-px w-8 bg-ui-border" />
              <StepStatus step="extract" label="Extract leads" />
              <div className="h-px w-8 bg-ui-border" />
              <StepStatus step="review" label="Review results" />
              <div className="h-px w-8 bg-ui-border" />
              <StepStatus step="download" label="Download" />
            </div>
            {loading ? (
              <div className="flex items-center gap-3 text-sm text-ui-muted">
                <span className="font-semibold text-ui-text"> {progressPct}%</span>
              </div>
            ) : null}
          </div>

          {loading ? (
            <>
              <div className="mt-3 flex items-center gap-2 text-sm">
                <Loader2 size={16} className="animate-spin text-ui-primary" />
                <span className="font-semibold text-ui-text">
                  Extracting leads from Google Maps…
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-ui-subtle">
                <div
                  className="h-full bg-ui-focus transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </>
          ) : null}
        </section>

        {error ? (
          <section className="ui-surface mt-4 border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p className="font-semibold">Failed to fetch data. Try again.</p>
            <p className="mt-1">{error}</p>
          </section>
        ) : null}

        {!result && !loading && !error ? (
          <section className="ui-surface mt-4 p-5 text-sm text-ui-muted">
            Submit your category and location to extract your first batch of leads.
          </section>
        ) : null}

        {loading && !result ? (
          <section className="mt-6 space-y-4">
            <div className="ui-surface p-4 text-sm text-ui-muted">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin text-ui-primary" />
                  <span className="font-semibold text-ui-text">
                    Extracting leads from Google Maps…
                  </span>
                </div>
                <span className="font-semibold text-ui-text">{progressPct}%</span>
              </div>
              <div className="mt-2 text-xs">
                Please wait while we extract and verify contact details.
              </div>
            </div>

            <div className="ui-surface overflow-hidden">
              <div className="overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-ui-subtle text-ui-muted">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Business Name</th>
                      <th className="px-4 py-3 font-semibold">Address</th>
                      <th className="px-4 py-3 font-semibold">Phone Number</th>
                      <th className="px-4 py-3 font-semibold">Email</th>
                      <th className="px-4 py-3 font-semibold">Website</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-t border-ui-border">
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
          <section className="mt-6 space-y-4">
            <div className="ui-surface flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <p className="text-ui-muted">
                <span className="font-semibold text-ui-text">{leadsFound}</span> leads found
                {" | "}Avg score:{" "}
                <span className="font-semibold text-ui-text">{avgScore}</span>
                {" | "}Provider:{" "}
                <span className="font-semibold text-ui-text">{providerLabel}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={copyEmails}
                  className="ui-button-secondary"
                  disabled={leadsForActions.length === 0 || emailCount === 0}
                >
                  Copy Emails ({emailCount})
                </button>
                <button
                  type="button"
                  onClick={copyPhones}
                  className="ui-button-secondary"
                  disabled={leadsForActions.length === 0 || phoneCount === 0}
                >
                  Copy Phone Numbers ({phoneCount})
                </button>
                <button
                  type="button"
                  onClick={() => downloadCsv(leadsForActions)}
                  className="ui-button-secondary inline-flex items-center gap-2"
                  disabled={leadsForActions.length === 0}
                >
                  <Download size={14} />
                  Export to CSV
                </button>
                <button
                  type="button"
                  onClick={copyAllData}
                  className="ui-button-secondary inline-flex items-center gap-2"
                  disabled={leadsForActions.length === 0}
                >
                  <Copy size={14} />
                  Copy All Data
                </button>
              </div>
            </div>

            <div className="ui-surface p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
            </div>

            {leadsFound > 0 ? (
              <div className="ui-surface overflow-hidden">
                <div className="overflow-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-ui-subtle text-ui-muted">
                      <tr>
                        <th className="px-4 py-3 font-semibold">
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
                        <th className="px-4 py-3 font-semibold">
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
                        <th className="px-4 py-3 font-semibold">
                          <button
                            type="button"
                            onClick={() => toggleSort("phone")}
                            className="inline-flex items-center gap-2 hover:text-ui-text"
                          >
                            Phone Number
                            {sortKey === "phone" ? (
                              <span className="text-ui-text">{sortDir === "asc" ? "↑" : "↓"}</span>
                            ) : null}
                          </button>
                        </th>
                        <th className="px-4 py-3 font-semibold">
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
                        <th className="px-4 py-3 font-semibold">
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
                      {pagedLeads.map((lead, index) => {
                        const key = `${lead.business_name}-${lead.address}-${lead.phone}-${lead.website}-${index}`;
                        return (
                          <tr key={key} className="border-t border-ui-border">
                            <td className="px-4 py-3 font-medium text-ui-text">
                              {lead.business_name}
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
                No verified leads found for this category/location combination. Try increasing scan count
                or using a more specific location.
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
      </main>
    </div>
  );
}
