import { z } from "zod";
import { getPublicEmailFromWebsite } from "@/lib/email";
import type { LeadRequest, RawLead } from "@/types/leads";

const textSearchSchema = z.object({
  results: z.array(
    z.object({
      place_id: z.string(),
      name: z.string(),
      formatted_address: z.string().optional().default(""),
      business_status: z.string().optional().default(""),
      types: z.array(z.string()).optional().default([]),
    }),
  ),
});

const detailsSchema = z.object({
  result: z.object({
    formatted_phone_number: z.string().optional().default(""),
    website: z.string().optional().default(""),
    formatted_address: z.string().optional().default(""),
    name: z.string().optional().default(""),
    types: z.array(z.string()).optional().default([]),
    business_status: z.string().optional().default(""),
  }),
});

function normalizeWebsite(value: string): string {
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return `https://${value}`;
}

async function fetchPlaceDetails(
  placeId: string,
  apiKey: string,
): Promise<{
  phone: string;
  website: string;
  address: string;
  name: string;
  categories: string[];
  businessStatus: string;
}> {
  const detailsUrl = new URL(
    "https://maps.googleapis.com/maps/api/place/details/json",
  );
  detailsUrl.searchParams.set("place_id", placeId);
  detailsUrl.searchParams.set(
    "fields",
    "name,formatted_address,formatted_phone_number,website,types,business_status",
  );
  detailsUrl.searchParams.set("key", apiKey);

  const response = await fetch(detailsUrl.toString());
  if (!response.ok) {
    return {
      phone: "",
      website: "",
      address: "",
      name: "",
      categories: [],
      businessStatus: "",
    };
  }

  const data = await response.json();
  const parsed = detailsSchema.safeParse(data);
  if (!parsed.success) {
    return {
      phone: "",
      website: "",
      address: "",
      name: "",
      categories: [],
      businessStatus: "",
    };
  }

  return {
    phone: parsed.data.result.formatted_phone_number,
    website: normalizeWebsite(parsed.data.result.website),
    address: parsed.data.result.formatted_address,
    name: parsed.data.result.name,
    categories: parsed.data.result.types,
    businessStatus: parsed.data.result.business_status,
  };
}

export async function extractLeadsFromGmaps({
  business_category,
  location,
  max_results,
}: LeadRequest): Promise<RawLead[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GOOGLE_MAPS_API_KEY in environment variables.");
  }

  const query = `${business_category} in ${location}`;
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error("Failed to fetch businesses from Google Maps.");
  }

  const data = await response.json();
  const parsed = textSearchSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Unexpected response from Google Maps extractor.");
  }

  const limit = Math.max(1, Math.min(max_results ?? 30, 100));
  const limited = parsed.data.results.slice(0, limit);
  const leads = await Promise.all(
    limited.map(async (item): Promise<RawLead> => {
      const details = await fetchPlaceDetails(item.place_id, apiKey);
      const website = details.website;
      const email = website ? await getPublicEmailFromWebsite(website) : "";

      return {
        business_name: details.name || item.name,
        address: details.address || item.formatted_address,
        website,
        phone: details.phone,
        email,
        placeId: item.place_id,
        categories:
          details.categories.length > 0 ? details.categories : item.types,
        businessStatus: details.businessStatus || item.business_status,
      };
    }),
  );

  return leads;
}
