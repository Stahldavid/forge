# create-forge-app

Create a ForgeOS app without installing ForgeOS globally first.

```bash
npm create forge-app@alpha my-app -- --template minimal-web
cd my-app
npm run dev
```

The wrapper delegates to `forge new` and defaults to:

```txt
--template minimal-web
--package-manager npm
--forge-spec npm:forgeos@alpha
```

Examples:

```bash
npm create forge-app@alpha notes-app -- --template minimal-web
npm create forge-app@alpha support-app -- --template b2b-support-web
npm create forge-app@alpha notes-app -- --template minimal-web --no-install --no-git
```

Use the lower-level ForgeOS package directly when you want to add ForgeOS to an
existing project:

```bash
npm install forgeos@alpha
```
