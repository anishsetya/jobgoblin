// Sets up translation. Every sentence the person reads lives in a JSON file under ./en, one file per
// area of the app, and components ask for it by name: t("today:title"). English is the only language
// for now, but nothing in a component is written in English, so another language is one folder of files.
// Spec: PRD "Language" quality requirement.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import apply from "./en/apply.json";
import application from "./en/application.json";
import common from "./en/common.json";
import pipeline from "./en/pipeline.json";
import profile from "./en/profile.json";
import review from "./en/review.json";
import settings from "./en/settings.json";
import setup from "./en/setup.json";
import today from "./en/today.json";

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  resources: { en: { common, today, review, apply, pipeline, application, setup, profile, settings } },
  // React already escapes text it renders, so i18next must not escape it a second time.
  interpolation: { escapeValue: false },
  initAsync: false, // the texts are bundled, so they are ready before the first screen renders
});

export default i18n;
