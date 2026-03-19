const EMAIL_REGEX =
  /(?:mailto:)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

export function extractEmailFromText(text: string): string {
  const matches = Array.from(text.matchAll(EMAIL_REGEX));
  if (!matches.length) {
    return "";
  }

  const candidate = matches[0]?.[1] ?? "";
  return candidate.toLowerCase();
}

export async function getPublicEmailFromWebsite(url: string): Promise<string> {
  if (!url) {
    return "";
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "LeadExtractorBot/1.0",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return "";
    }

    const html = await response.text();
    return extractEmailFromText(html);
  } catch {
    return "";
  }
}
