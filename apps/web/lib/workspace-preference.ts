const KEY = "threadline-last-org";

export function getPreferredOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

export function setPreferredOrgId(orgId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, orgId);
}
