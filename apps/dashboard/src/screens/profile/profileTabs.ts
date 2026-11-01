// The four tabs of the Profile screen, and a check that turns whatever is in the address into one of them.
export const PROFILE_TABS = ["story", "answers", "targets", "banned"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

// An unknown tab name (a typo in the address) opens the first tab.
export function parseProfileTab(value: string): ProfileTab {
  return PROFILE_TABS.find((tab) => tab === value) ?? "story";
}
