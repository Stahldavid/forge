# __FORGE_APP_TITLE__

Nuxt + ForgeOS notes app.

Run the full-stack loop:

```bash
__PACKAGE_MANAGER__ install
__PACKAGE_MANAGER__ run generate
__PACKAGE_MANAGER__ run dev
```

`forge dev` starts both the Forge runtime API and the Nuxt web UI.

For agent/CI diagnostics:

```bash
__PACKAGE_MANAGER__ run forge -- dev --once --json
```

Generated files and local runtime state are gitignored and hidden from editor search by default. Recreate them with `forge generate`.

The Nuxt app reads the Forge API URL from `runtimeConfig.public.forgeUrl`, overrideable with `NUXT_PUBLIC_FORGE_URL`.

The web app includes:

- `web/plugins/forge.client.ts` and `web/plugins/forge.server.ts` for hydration-safe Forge Vue plugin setup.
- `web/composables/forge.ts` as the generated-client bridge.
- `web/composables/useNotes.ts` as a domain composable using `useForgeCommand` and `useForgeLiveQuery`.
- `web/server/api/forge-health.get.ts` as a minimal Nitro route that reads Nuxt runtime config.
