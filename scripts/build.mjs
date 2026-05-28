import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync as transformWithEsbuild } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = path.join(root, ".tmp");
const distDir = path.join(root, "dist");
const hostedDir = path.join(distDir, "hosted");
const offlineDir = path.join(distDir, "offline");
const welcomeDir = path.join(distDir, "welcome");
const elmOutput = path.join(tmpDir, "elm.js");
const cssOutput = path.join(tmpDir, "vite", "tailwind.css");
const templatePath = path.join(root, "src", "index.template.html");
const envPath = path.join(root, ".env");

loadDotEnv(envPath);

const isProduction = process.env.NODE_ENV === "production" || process.env.BUILD_ENV === "production";
const hostedAppUrl = requiredConfig("HOSTED_APP_URL", "http://localhost:4173/");
const accessCode = requiredConfig("ACCESS_CODE", "BITES2026");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });
mkdirSync(hostedDir, { recursive: true });
mkdirSync(offlineDir, { recursive: true });
mkdirSync(welcomeDir, { recursive: true });

runBinary("elm", ["make", "src/Main.elm", "--optimize", "--output", elmOutput]);
minifyElmBundle();
runBinary("vite", ["build", "--config", "vite.config.mjs"]);

const template = readFileSync(templatePath, "utf8");
const elmBundle = escapeInlineScript(readFileSync(elmOutput, "utf8"));
const tailwindCss = escapeInlineStyle(readFileSync(cssOutput, "utf8"));

const hostedHtml = renderAppHtml({
  mode: "hosted",
  pwaHead: [
    '<link rel="manifest" href="./manifest.webmanifest" />',
    '<link rel="icon" href="./app-icon.svg" type="image/svg+xml" />',
    '<link rel="apple-touch-icon" href="./app-icon.svg" />'
  ].join("\n    ")
});
const offlineHtml = renderAppHtml({ mode: "offline", pwaHead: "" });

writeFileSync(path.join(hostedDir, "index.html"), minifyInlineAssets(hostedHtml));
writeFileSync(path.join(offlineDir, "first-bites-tracker.html"), minifyInlineAssets(offlineHtml));
writeFileSync(path.join(hostedDir, "manifest.webmanifest"), JSON.stringify(createManifest(), null, 2));
writeFileSync(path.join(hostedDir, "service-worker.js"), minifyJavaScript(createServiceWorker(), "service-worker.js"));
writeFileSync(path.join(hostedDir, "app-icon.svg"), createAppIconSvg());
writeFileSync(path.join(welcomeDir, "first-bites-welcome.html"), minifyInlineAssets(createWelcomeHtml()));
writeFileSync(path.join(welcomeDir, "first-bites-welcome.pdf"), createWelcomePdf());

execFileSync("zip", ["-j", path.join(offlineDir, "first-bites-offline.zip"), path.join(offlineDir, "first-bites-tracker.html")], {
  cwd: root,
  stdio: "inherit"
});

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = unquoteEnvValue(rawValue);
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function requiredConfig(name, localDefault) {
  const value = process.env[name] || localDefault;

  if (isProduction && !process.env[name]) {
    throw new Error(`${name} is required for production builds.`);
  }

  return value;
}

function renderAppHtml({ mode, pwaHead }) {
  const requiresAccessCode = mode === "hosted";

  return replaceTokens(template, {
    "{{TAILWIND}}": tailwindCss,
    "{{ELM}}": elmBundle,
    "{{PWA_HEAD}}": pwaHead,
    "{{MODE_JSON}}": JSON.stringify(mode),
    "{{HOSTED_APP_URL_JSON}}": JSON.stringify(hostedAppUrl),
    "{{REQUIRES_ACCESS_CODE_JSON}}": JSON.stringify(requiresAccessCode),
    "{{ACCESS_CODE_JSON}}": JSON.stringify(requiresAccessCode ? accessCode : null)
  });
}

function replaceTokens(value, replacements) {
  let output = value;

  for (const [token, replacement] of Object.entries(replacements)) {
    output = output.split(token).join(replacement);
  }

  return output;
}

function createManifest() {
  return {
    name: "First Bites Tracker",
    short_name: "First Bites",
    description: "Low-friction food exploration tracking for toddlers.",
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: "#f3f1e6",
    theme_color: "#f3f1e6",
    icons: [
      {
        src: "./app-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable"
      }
    ]
  };
}

function createServiceWorker() {
  return `const CACHE_NAME = "first-bites-tracker-${Date.now()}";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./app-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(event.request);
    })
  );
});
`;
}

function createAppIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#f3f1e6"/>
  <circle cx="256" cy="256" r="174" fill="#e7f2d5"/>
  <path d="M196 166c44 0 76 34 76 82v110h-42V248c0-25-13-40-34-40s-35 15-35 40v110h-42V248c0-48 33-82 77-82Z" fill="#446b0a"/>
  <path d="M316 166c45 0 77 34 77 82 0 49-32 83-77 83h-35V166h35Zm-35 124h33c22 0 36-16 36-42 0-25-14-40-36-40h-33v82Z" fill="#244a7d"/>
  <circle cx="204" cy="139" r="26" fill="#f46c5b"/>
</svg>
`;
}

function createWelcomeHtml() {
  const hostedUrl = escapeHtml(hostedAppUrl);
  const code = escapeHtml(accessCode);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>First Bites Welcome</title>
    <style>
      body { margin: 0; background: #f3f1e6; color: #1f2d4a; font-family: Arial, sans-serif; }
      main { width: 760px; margin: 0 auto; padding: 48px; }
      h1 { margin: 0; color: #446b0a; font-size: 44px; }
      p { color: #4b5d7f; font-size: 18px; line-height: 1.6; }
      .option { margin-top: 28px; padding: 28px; border-radius: 24px; background: #fff; box-shadow: 0 18px 42px rgba(130,120,90,0.12); }
      .button { display: inline-block; margin-top: 12px; padding: 16px 22px; border-radius: 999px; background: #4f7d00; color: #fff; font-weight: 800; text-decoration: none; letter-spacing: .12em; }
      code { padding: 8px 12px; border-radius: 12px; background: #e8f6df; color: #315500; font-size: 20px; font-weight: 800; }
    </style>
  </head>
  <body>
    <main>
      <h1>Welcome to First Bites Tracker</h1>
      <p>Your access code is <code>${code}</code></p>
      <section class="option">
        <h2>Option A: Premium Hosted App (Recommended)</h2>
        <p>Tap here to set up the app in 10 seconds. Best for keeping your data safe from accidental deletion.</p>
        <a class="button" href="${hostedUrl}">OPEN HOSTED APP</a>
      </section>
      <section class="option">
        <h2>Option B: 100% Offline Version</h2>
        <p>Want ultimate privacy? Download the standalone file to run the app completely offline.</p>
        <p>Open <strong>first-bites-offline.zip</strong>, extract <strong>first-bites-tracker.html</strong>, then double-click the HTML file.</p>
      </section>
    </main>
  </body>
</html>
`;
}

function createWelcomePdf() {
  const pageWidth = 612;
  const pageHeight = 792;
  const hostedButtonRect = [72, 422, 306, 466];
  const content = [
    "0.953 0.945 0.902 rg 0 0 612 792 re f",
    "0.902 0.949 0.835 rg 48 622 516 106 re f",
    "1 1 1 rg 58 358 496 220 re f",
    "1 1 1 rg 58 104 496 220 re f",
    "0.267 0.420 0.039 rg BT /F1 34 Tf 72 674 Td (Welcome to First Bites Tracker) Tj ET",
    "0.122 0.176 0.290 rg BT /F1 17 Tf 72 638 Td (Your access code is:) Tj ET",
    `0.196 0.333 0 rg BT /F1 24 Tf 236 636 Td (${pdfText(accessCode)}) Tj ET`,
    "0.122 0.176 0.290 rg BT /F1 20 Tf 72 532 Td (Option A: Premium Hosted App \\(Recommended\\)) Tj ET",
    "0.294 0.365 0.498 rg BT /F1 14 Tf 72 500 Td (Tap here to set up the app in 10 seconds.) Tj ET",
    "0.294 0.365 0.498 rg BT /F1 14 Tf 72 480 Td (Best for keeping your data safe from accidental deletion.) Tj ET",
    "0.310 0.490 0 rg 72 422 234 44 re f",
    "1 1 1 rg BT /F1 13 Tf 96 440 Td (OPEN HOSTED APP) Tj ET",
    "0.122 0.176 0.290 rg BT /F1 22 Tf 72 278 Td (Option B: 100% Offline Version) Tj ET",
    "0.294 0.365 0.498 rg BT /F1 14 Tf 72 246 Td (Want ultimate privacy? Download the standalone file) Tj ET",
    "0.294 0.365 0.498 rg BT /F1 14 Tf 72 226 Td (to run the app completely offline.) Tj ET",
    "0.294 0.365 0.498 rg BT /F1 14 Tf 72 190 Td (Open first-bites-offline.zip, extract first-bites-tracker.html,) Tj ET",
    "0.294 0.365 0.498 rg BT /F1 14 Tf 72 170 Td (then double-click the HTML file.) Tj ET"
  ].join("\n");

  const objects = [];
  const fontId = addObject(objects, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const contentId = addObject(objects, `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
  const linkId = addObject(objects, `<< /Type /Annot /Subtype /Link /Rect [${hostedButtonRect.join(" ")}] /Border [0 0 0] /A << /S /URI /URI (${pdfText(hostedAppUrl)}) >> >>`);
  const pageId = addObject(objects, `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R /Annots [${linkId} 0 R] >>`);
  const pagesId = addObject(objects, `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
  objects[pageId - 1] = objects[pageId - 1].replace("/Parent 0 0 R", `/Parent ${pagesId} 0 R`);
  const catalogId = addObject(objects, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  return serializePdf(objects, catalogId);
}

function addObject(objects, body) {
  objects.push(body);
  return objects.length;
}

function serializePdf(objects, catalogId) {
  let output = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, "utf8"));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(output, "utf8");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return output;
}

function runBinary(binaryName, args) {
  const binName = process.platform === "win32" ? `${binaryName}.cmd` : binaryName;
  const binPath = path.join(root, "node_modules", ".bin", binName);

  if (!existsSync(binPath)) {
    throw new Error(`Missing ${binaryName}. Run "npm install" first so local devDependencies are available.`);
  }

  execFileSync(binPath, args, {
    cwd: root,
    stdio: "inherit"
  });
}

function minifyElmBundle() {
  const minified = minifyJavaScript(readFileSync(elmOutput, "utf8"), "elm.js");
  writeFileSync(elmOutput, minified);
}

function minifyInlineAssets(html) {
  const preservedScripts = [];

  return html
    .replace(/<script data-preserve-minified>([\s\S]*?)<\/script>/g, (_match, js) => {
      const placeholder = `%%PRESERVED_SCRIPT_${preservedScripts.length}%%`;
      preservedScripts.push(`<script>${js}</script>`);
      return placeholder;
    })
    .replace(/<style>([\s\S]*?)<\/style>/g, (_match, css) => `<style>${minifyInlineCss(css)}</style>`)
    .replace(/<script>([\s\S]*?)<\/script>/g, (_match, js) => `<script>${minifyJavaScript(js, "inline.js")}</script>`)
    .replace(/%%PRESERVED_SCRIPT_(\d+)%%/g, (_match, index) => preservedScripts[Number(index)]);
}

function minifyInlineCss(css) {
  return transformWithEsbuild(css, {
    legalComments: "none",
    loader: "css",
    minify: true,
    sourcefile: "inline.css"
  }).code.trim();
}

function minifyJavaScript(js, sourcefile) {
  return transformWithEsbuild(js, {
    legalComments: "none",
    minify: true,
    sourcefile,
    target: "es2017"
  }).code.trim();
}

function escapeInlineStyle(value) {
  return value.replaceAll("</style>", "<\\/style>");
}

function escapeInlineScript(value) {
  return value.replaceAll("</script>", "<\\/script>");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pdfText(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}
