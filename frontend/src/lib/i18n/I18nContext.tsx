import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { POS_LOCALE_LABELS, PosLocale, posDictionaries } from "./dictionaries";

interface I18nContextType {
  locale: PosLocale;
  setLocale: (locale: PosLocale) => void;
  toggleLocale: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  locales: Array<{ id: PosLocale; label: string }>;
}

const STORAGE_KEY = "pos_locale";

const isLocale = (value: string | null): value is PosLocale => value === "en" || value === "ml";

const I18nContext = createContext<I18nContextType>({
  locale: "en",
  setLocale: () => {},
  toggleLocale: () => {},
  t: (key) => posDictionaries.en[key] ?? key,
  locales: [],
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<PosLocale>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : "en";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: PosLocale) => setLocaleState(next), []);
  const toggleLocale = useCallback(
    () => setLocaleState((prev) => (prev === "en" ? "ml" : "en")),
    []
  );

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const template = posDictionaries[locale][key] ?? posDictionaries.en[key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        params[name] !== undefined ? String(params[name]) : match
      );
    },
    [locale]
  );

  return (
    <I18nContext.Provider
      value={{
        locale,
        setLocale,
        toggleLocale,
        t,
        locales: Object.entries(POS_LOCALE_LABELS).map(([id, label]) => ({
          id: id as PosLocale,
          label,
        })),
      }}
    >
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): I18nContextType => useContext(I18nContext);
