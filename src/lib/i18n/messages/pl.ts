// Polish dictionary: the shape source for every locale (`Messages = typeof pl`), namespaced by area.
// Values are plain strings (island props must be serialisable); `{name}` placeholders are filled by
// format() from @/lib/i18n. Later phases add their own namespaces here first, then in en.ts.

export const pl = {
  common: {
    languageNamePl: "Polski",
    languageNameEn: "English",
  },
  layout: {
    languageSwitch: "Język",
    switchToPl: "Przełącz na język polski",
    switchToEn: "Przełącz na język angielski",
  },
};

export type Messages = typeof pl;
