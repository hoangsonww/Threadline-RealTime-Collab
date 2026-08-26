import { afterEach, describe, expect, it, vi } from "vitest";
import { getPreferredOrgId, setPreferredOrgId } from "./workspace-preference";

const KEY = "threadline-last-org";

/** A window whose localStorage behaves normally. */
const installWorkingStorage = () => {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  });
  return store;
};

/**
 * A window that throws on the `localStorage` property access itself, which is
 * what Safari with "Block all cookies" and Chromium with site data blocked
 * actually do — they do not hand back an empty store.
 */
const installRefusingStorage = () => {
  const refusal = new Error("The operation is insecure.");
  const fakeWindow = {};
  Object.defineProperty(fakeWindow, "localStorage", {
    get() {
      throw refusal;
    },
  });
  vi.stubGlobal("window", fakeWindow);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace preference", () => {
  it("round-trips the selected workspace through local storage", () => {
    const store = installWorkingStorage();
    expect(getPreferredOrgId()).toBeNull();

    setPreferredOrgId("2b0f2d9e-5f1a-4a2d-9d0e-2f6f0c1a77b1");
    expect(store.get(KEY)).toBe("2b0f2d9e-5f1a-4a2d-9d0e-2f6f0c1a77b1");
    expect(getPreferredOrgId()).toBe("2b0f2d9e-5f1a-4a2d-9d0e-2f6f0c1a77b1");
  });

  it("reports nothing remembered during server rendering", () => {
    vi.stubGlobal("window", undefined);
    expect(getPreferredOrgId()).toBeNull();
    expect(() => setPreferredOrgId("any-id")).not.toThrow();
  });

  // The regression this file exists for: both functions are called during render
  // by every org-scoped page, so a throw here took the whole authenticated app
  // down for anyone whose browser refuses site data.
  it("degrades to nothing remembered when the browser refuses site data", () => {
    installRefusingStorage();
    expect(getPreferredOrgId()).toBeNull();
    expect(() => setPreferredOrgId("2b0f2d9e-5f1a-4a2d-9d0e-2f6f0c1a77b1")).not.toThrow();
  });

  it("survives a storage write that is refused after the read succeeded", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          // What a full store raises — private-mode Safari historically reported
          // a zero quota rather than refusing the property access.
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(() => setPreferredOrgId("2b0f2d9e-5f1a-4a2d-9d0e-2f6f0c1a77b1")).not.toThrow();
    expect(getPreferredOrgId()).toBeNull();
  });
});
