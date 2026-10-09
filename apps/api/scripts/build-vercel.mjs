// Build untuk Vercel (Build Output API v3): bundel seluruh API (termasuk paket workspace @aevia/* yang
// berupa TypeScript mentah) menjadi satu file ESM, karena runtime Vercel tidak bisa memuat .ts dari node_modules.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}.vercel/output`;
const fn = `${out}/functions/api.func`;
rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });
mkdirSync(`${out}/static`, { recursive: true });

// PGlite hanya untuk dev/test (tanpa DATABASE_URL). Di produksi diganti stub agar bundel kecil dan tanpa WASM.
const pgliteStub = {
  name: "pglite-stub",
  setup(b) {
    b.onResolve({ filter: /^@electric-sql\/pglite$/ }, () => ({ path: "pglite-stub", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents:
        "export const types = {};\nexport class PGlite { constructor() { throw new Error('PGlite tidak tersedia di produksi: isi DATABASE_URL.'); } }\n",
      loader: "js",
    }));
  },
};

await build({
  entryPoints: [`${root}src/vercel.ts`],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  minify: true,
  legalComments: "none",
  external: ["pg-native"],
  plugins: [pgliteStub],
  // Dependensi CommonJS di dalam bundel ESM butuh require().
  // Dependensi CommonJS memakai require/__dirname/__filename; di ESM ketiganya harus disediakan.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);",
  },
});

// Aset statis Swagger UI (/docs) ikut disalin; src/vercel.ts mengarahkan SWAGGER_UI_STATIC_DIR ke folder ini.
const swaggerUiDir = dirname(createRequire(`${root}package.json`).resolve("@fastify/swagger-ui/package.json"));
cpSync(`${swaggerUiDir}/static`, `${fn}/static`, { recursive: true });

// Cron didefinisikan di vercel.json (Vercel menggabungkannya); jangan diulang di config.json.
// Migrasi SQL ikut disalin (dibaca relatif terhadap bundel bila dipakai).
cpSync(fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)), `${fn}/migrations`, { recursive: true });

writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 30 }, null, 2),
);
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: "module" }));
writeFileSync(`${out}/static/robots.txt`, "User-agent: *\nDisallow: /\n");

writeFileSync(
  `${out}/config.json`,
  JSON.stringify({ version: 3, routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/api" }], }, null, 2),
);
console.log("Vercel build output siap:", out);
