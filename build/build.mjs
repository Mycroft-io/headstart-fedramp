// Builds dist/index.html (standalone), dist/artifact.html (body only) and dist/_headers.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildSync } from 'esbuild';
const js = buildSync({ entryPoints: ['src/app.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020', legalComments: 'none' }).outputFiles[0].text;
const inline = o => JSON.stringify(o).replace(/</g, '\\u003c');
const data = {
  fedramp: JSON.parse(fs.readFileSync('data/fedramp.json', 'utf8')), mapping: JSON.parse(fs.readFileSync('data/mapping.json', 'utf8')),
  mappingSoc2: JSON.parse(fs.readFileSync('data/mapping-soc2.json', 'utf8')), annex: JSON.parse(fs.readFileSync('data/annex-a.json', 'utf8')), tsc: JSON.parse(fs.readFileSync('data/tsc.json', 'utf8')),
  sample: { name: 'Northwind Analytics Ltd. (fictional sample SoA)', csv: fs.readFileSync('samples/northwind-soa-2022.csv', 'utf8').replace(/^\ufeff/, ''), soc2: JSON.parse(fs.readFileSync('samples/northwind-soc2.json', 'utf8')) },
};
const b64 = (f, mime) => `data:${mime};base64,` + fs.readFileSync('assets/' + f).toString('base64');
const appJs = js.replace(/<\/script/gi, '<\\/script');
const page = fs.readFileSync('src/page.html', 'utf8').split('/*__LOGO__*/').join(b64('mycroft-lockup-mask.png', 'image/png'))
  .replace('/*__FONT_TASA__*/', () => b64('tasa-orbiter-latin-wght-normal.woff2', 'font/woff2')).replace('/*__FONT_INTER__*/', () => b64('inter-latin-wght-normal.woff2', 'font/woff2'))
  .replace('/*__DATA__*/', () => inline(data)).replace('/*__APP__*/', () => appJs);
fs.mkdirSync('dist', { recursive: true });
const hash = 'sha256-' + crypto.createHash('sha256').update(appJs).digest('base64');
const csp = `default-src 'none'; script-src '${hash}'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
fs.writeFileSync('dist/_headers', fs.readFileSync('site/_headers', 'utf8').replace('{{CSP}}', csp));
fs.writeFileSync('dist/artifact.html', page);
fs.writeFileSync('dist/index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="description" content="Reads an ISO/IEC 27001:2022 Statement of Applicability and shows how far it gets you toward FedRAMP 20x Class B, C or D."><link rel="icon" href="data:,"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>${page}</body></html>`);
console.log('app.js', js.length, 'page', page.length);
