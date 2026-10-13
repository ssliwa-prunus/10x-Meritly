import { getMessages, type Locale } from "@/lib/i18n";

// Configuration banner shown by Layout. Pure (no astro:* imports) so it is unit-testable: Layout
// reads the env values from astro:env/server and passes them in with the request's locale.

export interface ConfigStatus {
  name: string;
  configured: boolean;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
}

export interface ConfigEnv {
  supabaseUrl?: string;
  supabaseKey?: string;
}

export function configStatuses(env: ConfigEnv, locale: Locale): ConfigStatus[] {
  const t = getMessages(locale);
  return [
    {
      name: "Supabase",
      configured: Boolean(env.supabaseUrl && env.supabaseKey),
      message: t.layout.supabaseNotConfigured,
      docsUrl: "https://github.com/przeprogramowani/10x-astro-starter#supabase-configuration",
      docsLabel: t.layout.supabaseDocsLabel,
    },
  ];
}

export function missingConfigs(env: ConfigEnv, locale: Locale): ConfigStatus[] {
  return configStatuses(env, locale).filter((s) => !s.configured);
}
