import OpenAI from "openai";
import type { CleanLead, RawLead } from "@/types/leads";

const COUNTRY_ALIASES: Record<string, string[]> = {
  philippines: ["philippines", "ph", "metro manila", "ncr", "luzon", "visayas", "mindanao"],
  "united states": ["united states", "usa", "us", "u.s.", "u.s.a."],
  uk: ["uk", "united kingdom", "england", "scotland", "wales", "northern ireland", "gb"],
};

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function getLocationTokens(location: string): string[] {
  const normalized = normalizeText(location);
  const baseParts = normalized
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2);

  const aliasParts = Object.entries(COUNTRY_ALIASES).flatMap(([key, values]) => {
    if (normalized.includes(key) || values.some((v) => normalized.includes(v))) {
      return values;
    }
    return [];
  });

  return Array.from(new Set([normalized, ...baseParts, ...aliasParts]));
}

function isLocationMatch(address: string, locationTokens: string[]): boolean {
  const addressLower = normalizeText(address);
  return locationTokens.some((token) => token && addressLower.includes(token));
}

function getDedupKey(lead: RawLead): string {
  const websiteHost = lead.website
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();
  const phone = normalizePhone(lead.phone);
  const name = lead.business_name.trim().toLowerCase();
  const address = lead.address.trim().toLowerCase();
  return `${name}|${address}|${websiteHost}|${phone}`;
}

function cleanDeterministic(
  leads: RawLead[],
  businessCategory: string,
  location: string,
): CleanLead[] {
  const seen = new Set<string>();
  const categoryWords = businessCategory
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const locationTokens = getLocationTokens(location);

  const cleaned: CleanLead[] = [];
  for (const lead of leads) {
    if (!lead.business_name || !lead.address) {
      continue;
    }
    if (!isLocationMatch(lead.address, locationTokens)) {
      continue;
    }

    const joinedCategoryData = [
      lead.business_name.toLowerCase(),
      ...lead.categories.map((c) => c.toLowerCase()),
    ].join(" ");

    const matchesCategory =
      categoryWords.length === 0 ||
      categoryWords.some((w) => joinedCategoryData.includes(w));
    if (!matchesCategory) {
      continue;
    }

    if (lead.businessStatus && lead.businessStatus !== "OPERATIONAL") {
      continue;
    }

    const key = getDedupKey(lead);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    cleaned.push({
      business_name: lead.business_name,
      address: lead.address,
      website: lead.website || "",
      phone: lead.phone || "",
      email: lead.email || "",
    });
  }

  return cleaned;
}

function stripCodeFence(value: string): string {
  return value.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
}

export async function cleanAndVerifyLeads(
  leads: RawLead[],
  businessCategory: string,
  location: string,
): Promise<CleanLead[]> {
  const baseline = cleanDeterministic(leads, businessCategory, location);
  if (!baseline.length) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return baseline;
  }

  try {
    const client = new OpenAI({ apiKey });
    const prompt = `You are verifying business leads.
Input location: "${location}"
Input category: "${businessCategory}"

Rules:
- Keep only businesses physically located in the specified area.
- Keep only businesses matching the category.
- Remove duplicates.
- Remove incomplete records missing name or address.
- Keep email as blank string if unavailable.
- Return STRICT JSON only (no markdown), as an array of objects with keys:
  business_name, address, website, phone, email

Leads:
${JSON.stringify(baseline, null, 2)}`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const text = response.output_text || "[]";
    const parsed = JSON.parse(stripCodeFence(text));
    if (!Array.isArray(parsed)) {
      return baseline;
    }

    return parsed
      .map((item) => ({
        business_name: String(item.business_name ?? "").trim(),
        address: String(item.address ?? "").trim(),
        website: String(item.website ?? "").trim(),
        phone: String(item.phone ?? "").trim(),
        email: String(item.email ?? "").trim(),
      }))
      .filter((item) => item.business_name && item.address);
  } catch {
    return baseline;
  }
}
