"use client";

import { FormEvent, useMemo, useState } from "react";
import { Check, Download, Loader2, Search } from "lucide-react";

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
  type ProgressStep = "extract" | "enrich" | "validate";

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
  const [activeStep, setActiveStep] = useState<ProgressStep | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<ProgressStep>>(new Set());
  const [error, setError] = useState("");
  const [result, setResult] = useState<LeadResponse | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setActiveStep("extract");
    setCompletedSteps(new Set());
    setError("");
    setResult(null);
    const phase1 = setTimeout(() => {
      setCompletedSteps((prev) => new Set([...prev, "extract"]));
      setActiveStep("enrich");
    }, 1800);
    const phase2 = setTimeout(() => {
      setCompletedSteps((prev) => new Set([...prev, "enrich"]));
      setActiveStep("validate");
    }, 3600);

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
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
      setCompletedSteps(new Set(["extract", "enrich", "validate"]));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unexpected client error.";
      setError(message);
    } finally {
      clearTimeout(phase1);
      clearTimeout(phase2);
      setActiveStep(null);
      setLoading(false);
    }
  }

  function StepStatus({
    step,
    label,
  }: {
    step: ProgressStep;
    label: string;
  }) {
    const isLoading = loading && activeStep === step;
    const isDone = !error && (completedSteps.has(step) || (!loading && Boolean(result)));

    return (
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-white ${
            isDone ? "bg-emerald-600" : isLoading ? "bg-ui-primary" : "bg-slate-400"
          }`}
        >
          {isLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : isDone ? (
            <Check size={14} />
          ) : (
            <span className="text-xs">•</span>
          )}
        </span>
        {label}
      </div>
    );
  }

  const avgScore = useMemo(() => {
    if (!result || result.leads.length === 0) return 0;
    const scoreTotal = result.leads.reduce((sum, lead) => {
      let score = 50;
      if (lead.website) score += 15;
      if (lead.phone) score += 15;
      if (lead.email) score += 20;
      return sum + score;
    }, 0);
    return Math.round(scoreTotal / result.leads.length);
  }, [result]);

  const emailCount = useMemo(() => {
    if (!result) return 0;
    return result.leads.filter((lead) => Boolean(lead.email)).length;
  }, [result]);

  function copyEmails() {
    if (!result) return;
    const emails = result.leads
      .map((lead) => lead.email.trim())
      .filter(Boolean)
      .join("\n");
    navigator.clipboard.writeText(emails);
    // Copy is also an "export" action, so mark these leads as exported.
    markLeadsAsExported(result.leads);
  }

  function downloadCsv() {
    if (!result) return;
    const headers = ["Business Name", "Address", "Website", "Phone", "Email"];
    const rows = result.leads.map((lead) => [
      lead.business_name,
      lead.address,
      lead.website,
      lead.phone,
      lead.email,
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
    // Downloading CSV is the user's main "export" action.
    markLeadsAsExported(result.leads);
  }

  const providerLabel =
    result?.provider === "openstreetmap" ? "OpenStreetMap" : "Google Maps";

  return (
    <div className="min-h-screen bg-ui-bg py-10 text-ui-text">
      <main className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Lead Discovery Dashboard
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ui-muted">
            Search by business category and area, then export clean, validated
            leads for outreach.
          </p>
        </header>

        <section className="ui-surface p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="text-base font-semibold">Search Parameters</h2>
            <p className="mt-1 text-sm text-ui-muted">
              Configure your target market before generating leads.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-12">
            <label className="md:col-span-4">
              <span className="mb-2 block text-sm font-medium text-ui-text">
                Business Category
              </span>
              <input
                required
                value={businessCategory}
                onChange={(e) => setBusinessCategory(e.target.value)}
                placeholder="Property Management"
                className="ui-input h-11"
              />
            </label>

            <label className="md:col-span-4">
              <span className="mb-2 block text-sm font-medium text-ui-text">
                Location / Area
              </span>
              <input
                required
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Chelmsford"
                className="ui-input h-11"
              />
            </label>

            <label className="md:col-span-2">
              <span className="mb-2 block text-sm font-medium text-ui-text">
                Businesses to Scan
              </span>
              <input
                required
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
              />
            </label>

            <div className="md:col-span-2 md:self-end">
              <button
                type="submit"
                disabled={loading}
                className="ui-button-primary inline-flex h-11 w-full items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                {loading ? "Generating..." : "Generate Leads"}
              </button>
            </div>
          </form>
        </section>

        <section className="ui-surface mt-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-ui-muted">
            <StepStatus step="extract" label={`Extracting from ${providerLabel}`} />
            <div className="h-px w-8 bg-ui-border" />
            <StepStatus step="enrich" label="Enriching emails" />
            <div className="h-px w-8 bg-ui-border" />
            <StepStatus step="validate" label="Validating with AI" />
          </div>
        </section>

        {error ? (
          <section className="ui-surface mt-4 border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p className="font-semibold">Unable to complete extraction</p>
            <p className="mt-1">{error}</p>
          </section>
        ) : null}

        {!result && !loading && !error ? (
          <section className="ui-surface mt-4 p-5 text-sm text-ui-muted">
            Submit search parameters to generate your first batch of leads.
          </section>
        ) : null}

        {result ? (
          <section className="mt-6 space-y-4">
            <div className="ui-surface flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <p className="text-ui-muted">
                <span className="font-semibold text-ui-text">{result.total_cleaned}</span> leads
                {" | "}Avg score:{" "}
                <span className="font-semibold text-ui-text">{avgScore}</span>
                {" | "}Provider:{" "}
                <span className="font-semibold text-ui-text">{providerLabel}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyEmails}
                  className="ui-button-secondary"
                  disabled={result.leads.length === 0}
                >
                  Copy Emails ({emailCount})
                </button>
                <button
                  type="button"
                  onClick={downloadCsv}
                  className="ui-button-secondary inline-flex items-center gap-2"
                  disabled={result.leads.length === 0}
                >
                  <Download size={14} />
                  Download CSV
                </button>
              </div>
            </div>

            {result.leads.length > 0 ? (
              <div className="ui-surface overflow-hidden">
                <div className="overflow-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-ui-subtle text-ui-muted">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Business Name</th>
                        <th className="px-4 py-3 font-semibold">Address</th>
                        <th className="px-4 py-3 font-semibold">Website</th>
                        <th className="px-4 py-3 font-semibold">Phone</th>
                        <th className="px-4 py-3 font-semibold">Email</th>
                        <th className="px-4 py-3 font-semibold">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.leads.map((lead, index) => {
                        let score = 50;
                        if (lead.website) score += 15;
                        if (lead.phone) score += 15;
                        if (lead.email) score += 20;
                        return (
                          <tr
                            key={`${lead.business_name}-${lead.address}-${lead.phone}-${lead.website}-${index}`}
                            className="border-t border-ui-border"
                          >
                            <td className="px-4 py-3 font-medium text-ui-text">
                              {lead.business_name}
                            </td>
                            <td className="px-4 py-3 text-ui-muted">{lead.address}</td>
                            <td className="px-4 py-3">
                              {lead.website ? (
                                <a
                                  href={lead.website}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-ui-text underline-offset-2 hover:underline"
                                >
                                  Link
                                </a>
                              ) : (
                                "-"
                              )}
                            </td>
                            <td className="px-4 py-3 text-ui-muted">{lead.phone || "-"}</td>
                            <td className="px-4 py-3 text-ui-muted">{lead.email || "-"}</td>
                            <td className="px-4 py-3">
                              <span className="rounded bg-ui-subtle px-2 py-1 text-xs font-semibold text-ui-text">
                                {score}
                              </span>
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
          </section>
        ) : null}
      </main>
    </div>
  );
}
