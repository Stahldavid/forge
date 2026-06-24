export default defineEventHandler(() => {
  const config = useRuntimeConfig();

  return {
    forgeUrl: config.public.forgeUrl,
  };
});
