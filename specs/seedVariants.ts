// Seeds the demo person through the public HTTP API, like support/seed.ts, but lets a journey change the profile
// first (no Remote answers, a different pay, no story items confirmed). The product's own seed is untouched.
import type { SeedTarget } from "../support/seed";
import { readAlexRiveraFixture } from "../support/seed";

type Profile = Record<string, any>;
const SECTIONS = ["contact", "workAuthorization", "employment", "compensation", "eeo", "targets", "rules"] as const;

export type VariantOptions = {
  usageNoticeSeen?: boolean;
  mutateProfile?: (profile: Profile) => void;
  finishSetup?: boolean; // default true
};

type StoryItem = { id: string; kind: string; parentId: string | null; status: string; data: unknown; keywords: string[] };

export async function seedVariant(server: SeedTarget, options: VariantOptions = {}): Promise<void> {
  const fixture = readAlexRiveraFixture() as { profile: Profile; storyItems: StoryItem[] };
  const profile: Profile = structuredClone(fixture.profile);
  options.mutateProfile?.(profile);

  await server.api("/api/settings/folder", { body: { path: server.personFolder } });
  for (const section of SECTIONS) {
    await server.api(`/api/profile/${section}`, { method: "PUT", body: profile[section] });
  }

  const newIdOf = new Map<string, string>();
  const parentsFirst = [...fixture.storyItems].sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null));
  for (const item of parentsFirst) {
    const parentId = item.parentId === null ? null : (newIdOf.get(item.parentId) ?? null);
    const created = await server.api<{ id: string; status: string }>("/api/story", {
      body: { kind: item.kind, parentId, data: item.data, keywords: item.keywords },
    });
    newIdOf.set(item.id, created.id);
    if (created.status !== "confirmed") await server.api(`/api/story/${created.id}/confirm`, { body: {} });
  }
  if (options.usageNoticeSeen === true) {
    await server.api("/api/settings", { method: "PUT", body: { usageNoticeSeen: true } });
  }
  if (options.finishSetup !== false) await server.api("/api/setup/finish", { body: {} });
}
