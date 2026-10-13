import type { Messages } from "./pl";

// English dictionary. Typed as the shape of `pl`, so a missing or extra key fails `astro check`.
export const en: Messages = {
  common: {
    languageNamePl: "Polski",
    languageNameEn: "English",
  },
  layout: {
    languageSwitch: "Language",
    switchToPl: "Switch to Polish",
    switchToEn: "Switch to English",
  },
};
