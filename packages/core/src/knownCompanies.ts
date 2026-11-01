// Well-known employers the truth trace treats as organization names even when Your story never mentions
// them. Without this list, a draft that adds "at Google" would pass whenever Google appears nowhere else
// in the story. Only names that are not also everyday words are listed (no "Apple", "Block" or "Meta").
// The organizations and job titles in Your story are added on top of this list (see facts.ts).
// Spec: ARCHITECTURE.md section 8.2 rule 3 (organization names).

export const WELL_KNOWN_COMPANIES: readonly string[] = [
  "Google", "Alphabet", "Amazon", "Microsoft", "Facebook", "Netflix", "Uber", "Lyft", "Airbnb",
  "Salesforce", "IBM", "Intel", "Nvidia", "Tesla", "OpenAI", "Anthropic", "Palantir", "Dropbox",
  "LinkedIn", "Oracle", "Adobe", "Cisco", "Spotify", "Shopify", "PayPal", "Coinbase", "Robinhood",
  "Goldman Sachs", "JPMorgan", "Morgan Stanley", "Deloitte", "Accenture", "McKinsey", "Walmart",
];
