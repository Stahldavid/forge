import { ForgeVuePlugin } from "../composables/forge";

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();

  nuxtApp.vueApp.use(ForgeVuePlugin, {
    url: String(config.public.forgeUrl),
    devAuth: true,
  });
});
