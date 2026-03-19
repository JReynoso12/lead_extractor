import type { LeadRequest, RawLead } from "@/types/leads";

type NominatimResult = {
  boundingbox?: [string, string, string, string];
  display_name?: string;
};

type OverpassElement = {
  id: number;
  type: string;
  tags?: Record<string, string>;
};

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

function quoteRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getLocationBoundingBox(location: string): Promise<{
  south: number;
  north: number;
  west: number;
  east: number;
}> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", location);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: {
      "user-agent": "lead-extractor-app/1.0",
      "accept-language": "en",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to resolve location in OpenStreetMap.");
  }

  const data = (await response.json()) as NominatimResult[];
  const item = data[0];
  if (!item?.boundingbox || item.boundingbox.length < 4) {
    throw new Error("Could not determine target area from location.");
  }

  const [south, north, west, east] = item.boundingbox.map(Number);
  return { south, north, west, east };
}

async function fetchOverpassWithFallback(query: string): Promise<Response> {
  let lastError = "No Overpass response.";

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": "lead-extractor-app/1.0",
        },
        body: `data=${encodeURIComponent(query)}`,
      });

      const contentType = response.headers.get("content-type") || "";

      if (response.ok && contentType.toLowerCase().includes("application/json")) {
        return response;
      }

      const text = await response.text();
      lastError = `${endpoint} returned ${response.status} (${contentType || "unknown content-type"}): ${text.slice(0, 200)}`;
    } catch (error) {
      lastError =
        error instanceof Error
          ? `${endpoint} request failed: ${error.message}`
          : `${endpoint} request failed.`;
    }
  }

  throw new Error(`Failed to fetch businesses from OpenStreetMap. ${lastError}`);
}

function composeAddress(tags: Record<string, string>, fallbackLocation: string): string {
  const streetParts = [tags["addr:housenumber"], tags["addr:street"]]
    .filter(Boolean)
    .join(" ");
  const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || "";
  const state = tags["addr:state"] || "";
  const postcode = tags["addr:postcode"] || "";
  const country = tags["addr:country"] || "";

  const full = [streetParts, city, state, postcode, country]
    .filter(Boolean)
    .join(", ");
  return full || fallbackLocation;
}

function normalizeWebsite(value: string): string {
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return `https://${value}`;
}

function mapElementToLead(
  element: OverpassElement,
  location: string,
  businessCategory: string,
): RawLead | null {
  const tags = element.tags || {};
  const businessName = tags.name?.trim() || "";
  if (!businessName) return null;

  const address = composeAddress(tags, location);
  const website = normalizeWebsite((tags.website || tags["contact:website"] || "").trim());
  const phone = (tags.phone || tags["contact:phone"] || "").trim();
  const email = (tags.email || tags["contact:email"] || "").trim();

  // Keep only complete contactable leads from extraction.
  if (!website || !phone || !email) return null;

  const categories = [
    tags.amenity,
    tags.shop,
    tags.office,
    tags.craft,
    tags.tourism,
    tags.leisure,
    businessCategory,
  ].filter(Boolean) as string[];

  return {
    business_name: businessName,
    address,
    website,
    phone,
    email,
    placeId: `osm:${element.type}:${element.id}`,
    categories,
    businessStatus: "OPERATIONAL",
  };
}

export async function extractLeadsFromOsm({
  business_category,
  location,
  max_results,
}: LeadRequest): Promise<RawLead[]> {
  const box = await getLocationBoundingBox(location);
  const pattern = quoteRegex(business_category);

  const query = `
[out:json][timeout:25];
(
  node(${box.south},${box.west},${box.north},${box.east})[name][~".*"~"${pattern}",i];
  way(${box.south},${box.west},${box.north},${box.east})[name][~".*"~"${pattern}",i];
  relation(${box.south},${box.west},${box.north},${box.east})[name][~".*"~"${pattern}",i];
);
out tags 80;
`;

  const response = await fetchOverpassWithFallback(query);

  let payload: { elements?: OverpassElement[] };
  try {
    payload = (await response.json()) as { elements?: OverpassElement[] };
  } catch {
    throw new Error("Failed to parse OpenStreetMap response.");
  }
  const elements = payload.elements || [];

  const mapped = elements
    .map((element) => mapElementToLead(element, location, business_category))
    .filter((item): item is RawLead => Boolean(item));

  const limit = Math.max(1, Math.min(max_results ?? 80, 100));
  return mapped.slice(0, limit);
}
