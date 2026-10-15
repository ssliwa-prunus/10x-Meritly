import { describe, expect, it } from "vitest";
import { configStatuses, missingConfigs } from "@/lib/config-status";

const configured = { supabaseUrl: "http://127.0.0.1:54321", supabaseKey: "public-key" };

describe("missingConfigs", () => {
  it("is empty when Supabase URL and key are set", () => {
    expect(missingConfigs(configured, "pl")).toEqual([]);
  });

  it.each([{}, { supabaseUrl: configured.supabaseUrl }, { supabaseKey: configured.supabaseKey }])(
    "reports Supabase when %j is incomplete",
    (env) => {
      expect(missingConfigs(env, "pl").map((s) => s.name)).toEqual(["Supabase"]);
    },
  );

  it("speaks the request's language", () => {
    const [pl] = missingConfigs({}, "pl");
    const [en] = missingConfigs({}, "en");
    expect(pl.message).toBe("Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.");
    expect(pl.docsLabel).toBe("Zobacz instrukcję konfiguracji");
    expect(en.message).toBe("Supabase is not configured — authentication features are disabled.");
    expect(en.docsLabel).toBe("See the configuration guide");
    expect(en.docsUrl).toBe(pl.docsUrl);
  });
});

describe("configStatuses", () => {
  it("marks Supabase configured when both values are set", () => {
    expect(configStatuses(configured, "en")[0].configured).toBe(true);
  });
});
