export default defineNuxtConfig({
  compatibilityDate: "2026-06-24",
  runtimeConfig: {
    public: {
      forgeUrl: process.env.NUXT_PUBLIC_FORGE_URL ?? "http://127.0.0.1:3765",
    },
  },
  typescript: {
    strict: true,
  },
});
