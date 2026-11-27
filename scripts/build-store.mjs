import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "dist-store");

// Only public store files. Admin/calculator/APK-related files are intentionally excluded.
const files = [
  "tienda.html",
  "tienda-clasica.html",
  "producto.html",
  "config.js",
  "cart.js",
  "cart-ui.js",
  "checkout.js",
  "receipt.js",
  "order.js",
  "customer.js",
  "share.js",
  "offline-store.js",
  "jspdf.umd.min.js",
  "logo.svg",
  "robots.txt",
  "sitemap.xml",
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const file of files) {
  const src = join(root, file);
  if (!existsSync(src)) throw new Error(`Missing required store file: ${file}`);
  cpSync(src, join(out, file));
}

// Cloudflare Pages: serve store root at /tienda.html. Keep .html pages accessible.
const redirects = `/ /tienda.html 302\n/index.html /tienda.html 302\n`;
writeFileSync(join(out, "_redirects"), redirects, "utf8");

const notFound = `<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Página no encontrada · Reymero3d</title><style>body{font-family:system-ui,sans-serif;background:#f4f0e9;color:#26221d;display:grid;place-items:center;min-height:100vh;margin:0;padding:2rem}.box{max-width:32rem;text-align:center}a{color:#b91c1c;font-weight:700}</style></head><body><div class="box"><h1>Página no encontrada</h1><p>La página que buscás no existe o fue movida.</p><p><a href="/tienda.html">Ir a la tienda</a></p></div></body></html>`;
writeFileSync(join(out, "404.html"), notFound, "utf8");

// Basic security/cache headers for static store.
const headers = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/*.html
  Cache-Control: public, max-age=0, must-revalidate

/*.js
  Cache-Control: public, max-age=86400

/*.css
  Cache-Control: public, max-age=86400

/*.svg
  Cache-Control: public, max-age=604800, immutable

/*.png
  Cache-Control: public, max-age=604800

/*.jpg
  Cache-Control: public, max-age=604800

/*.webp
  Cache-Control: public, max-age=604800

/*.woff2
  Cache-Control: public, max-age=31536000, immutable

/*.ico
  Cache-Control: public, max-age=604800
`;
writeFileSync(join(out, "_headers"), headers, "utf8");

// Ensure sitemap/robots in build point to custom domain.
for (const name of ["robots.txt", "sitemap.xml"]) {
  const p = join(out, name);
  const s = readFileSync(p, "utf8")
    .replaceAll("https://reymero3d.github.io/Calculadora-3D-/", "https://tienda.reymero3d.com/");
  writeFileSync(p, s, "utf8");
}

console.log(`Store build created at ${out}`);
console.log(`Files: ${files.length} + _redirects + _headers`);