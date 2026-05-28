# First Bites Tracker

This project builds an Elm app into two delivery paths: a hosted PWA and a standalone offline HTML file for Etsy buyers.

## Build

```bash
npm install
npm run build
```

Local builds default to `HOSTED_APP_URL=http://localhost:4173/` and `ACCESS_CODE=BITES2026`. You can configure builds by copying `.env.example` to `.env`:

```bash
HOSTED_APP_URL=https://firstbites.app/
ACCESS_CODE=BITES2026
```

Shell-provided environment variables override `.env` values. Production builds require both values from either `.env` or the shell:

```bash
NODE_ENV=production HOSTED_APP_URL=https://firstbites.app/ ACCESS_CODE=BITES2026 npm run build
```

The build emits:

- `dist/hosted/` for the hosted PWA
- `dist/offline/first-bites-tracker.html` for the standalone offline app
- `dist/offline/first-bites-offline.zip` for Etsy delivery
- `dist/welcome/first-bites-welcome.pdf` for the Etsy Welcome PDF

The build expects dependencies to be installed locally so Elm and Vite can run from `node_modules`.

## Edit points

- `src/Main.elm` for the Elm app
- `src/styles.css` for Tailwind layers and base styles
- `src/vite-entry.js` for the Vite CSS entry
- `vite.config.mjs` for the Tailwind/Vite pipeline
- `src/index.template.html` for the hosted/offline HTML shell
- `scripts/build.mjs` for product packaging, PWA files, ZIP, and Welcome PDF generation
