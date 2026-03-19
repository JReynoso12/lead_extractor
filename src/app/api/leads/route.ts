import { z } from "zod";
import { cleanAndVerifyLeads } from "@/lib/lead-cleaner";
import { extractLeadsFromGmaps } from "@/lib/gmaps-extractor";
import { extractLeadsFromOsm } from "@/lib/osm-extractor";

const requestSchema = z.object({
  business_category: z.string().min(1, "business_category is required"),
  location: z.string().min(1, "location is required"),
  max_results: z.coerce.number().int().min(1).max(100).optional(),
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request payload.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { business_category, location, max_results } = parsed.data;
    const provider = (process.env.LEAD_MAPS_PROVIDER || "").toLowerCase();
    const shouldUseOsm = provider === "osm" || !process.env.GOOGLE_MAPS_API_KEY;

    let extracted = [] as Awaited<ReturnType<typeof extractLeadsFromOsm>>;
    let warning: string | null = null;

    try {
      extracted = shouldUseOsm
        ? await extractLeadsFromOsm({ business_category, location, max_results })
        : await extractLeadsFromGmaps({ business_category, location, max_results });
    } catch (error) {
      if (!shouldUseOsm) {
        throw error;
      }
      warning =
        error instanceof Error
          ? `OSM temporary issue: ${error.message}`
          : "OSM temporary issue. Please retry shortly.";
      extracted = [];
    }
    const cleaned = await cleanAndVerifyLeads(
      extracted,
      business_category,
      location,
    );

    return Response.json({
      business_category,
      location,
      provider: shouldUseOsm ? "openstreetmap" : "google_maps",
      requested_limit: max_results ?? null,
      total_extracted: extracted.length,
      total_cleaned: cleaned.length,
      leads: cleaned,
      warning,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    return Response.json({ error: message }, { status: 500 });
  }
}
