export function normalizeCompanyName(name: string): string {
  if (!name) return "";

  let normalized = name.toLowerCase();

  // Replace punctuation with spaces
  normalized = normalized.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, " ");

  // Collapse whitespace
  normalized = normalized.replace(/\s{2,}/g, " ").trim();

  // Suffix normalization mapping
  const suffixMap: Record<string, string> = {
    "pvt ltd": "private limited",
    "ltd": "limited",
    "llc": "limited liability company",
    "l l c": "limited liability company",
    "inc": "incorporated",
    "corp": "corporation",
    "co": "company",
  };

  // Replace suffixes if they appear at the end
  for (const [suffix, replacement] of Object.entries(suffixMap)) {
    const regex = new RegExp(`\\b${suffix}$`, "i");
    if (regex.test(normalized)) {
      normalized = normalized.replace(regex, replacement).trim();
      break; // Only replace one terminal suffix
    }
  }

  return normalized;
}

export function normalizeDomain(domain: string): string {
  if (!domain) return "";

  let normalized = domain.toLowerCase().trim();
  // Remove protocols
  normalized = normalized.replace(/^https?:\/\//, "");
  // Remove www.
  normalized = normalized.replace(/^www\./, "");
  // Remove trailing slashes and paths
  normalized = normalized.split('/')[0];

  return normalized;
}
