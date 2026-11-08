import fs from 'node:fs';
import assert from 'node:assert/strict';
import { scanReport } from '../src/scanner.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
async function pages(path) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path)), isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) { const c = await (await doc.getPage(i)).getTextContent(); let lastY = null, line = [], lines = [];
    for (const it of c.items) { if (!('str' in it)) continue; const y = Math.round(it.transform[5]); if (lastY !== null && Math.abs(y - lastY) > 3) { lines.push(line.join(' ')); line = []; } line.push(it.str); lastY = y; if (it.hasEOL) { lines.push(line.join(' ')); line = []; lastY = null; } }
    if (line.length) lines.push(line.join(' ')); out.push(lines.join('\n')); }
  return out;
}
const a = scanReport(await pages('test/fixtures/northwind-soc2-type2.pdf'));
console.log('A', a.reportType, a.period, a.categories, a.serviceOrganization, a.exceptions.map(e => [e.criterion, e.confidence]), 'tested', a.criteriaTested.length, 'clean', a.cleanCount, a.notes);
assert.equal(a.reportType, 'Type 2'); assert.match(a.period, /July 1, 2025 to June 30, 2026/);
assert.deepEqual([...a.categories].sort(), ['availability', 'security'], 'C1 mentioned as out of scope must not add confidentiality'); assert.equal(a.catConf, 'high'); assert.ok(a.sections.s1 && a.sections.s2);
assert.deepEqual(a.exceptions.map(e => e.criterion), ['CC6.3', 'CC7.1', 'CC8.1']);
assert.ok(a.exceptions.every(e => e.confidence === 'high'), 'table layout: high confidence');
assert.ok(a.section4Found);
console.log('A extra', a.auditor, '|', a.system, '|', a.subservice, a.carveOut, 'cuecs', a.cuecCount, a.locations, 'criteria', a.criteriaInReport.length);
assert.equal(a.auditor, 'Contoso Assurance LLP'); assert.match(a.system, /Analytics Platform/); assert.deepEqual(a.subservice, ['AWS']); assert.equal(a.carveOut, 'carve-out'); assert.equal(a.cuecCount, 3); assert.ok(a.locations.includes('Toronto, ON'));
const b = scanReport(await pages('test/fixtures/contoso-soc2-type2.pdf'));
console.log('B', b.reportType, b.period, b.categories, b.serviceOrganization, b.exceptions.map(e => [e.criterion, e.confidence, e.text.slice(0, 50)]), b.notes);
assert.equal(b.reportType, 'Type 2'); assert.match(b.period, /1 January 2026 to 30 September 2026/);
assert.deepEqual([...b.categories].sort(), ['availability', 'confidentiality', 'security']);
assert.deepEqual(b.exceptions.map(e => e.criterion), ['C1.2', 'CC9.2']);
const c = scanReport(await pages('test/fixtures/fabrikam-soc2-type2.pdf'));
console.log('C', c.reportType, c.categories, c.exceptions.map(e => [e.criterion, e.confidence, e.via, e.control, e.text]));
assert.match(c.exceptions[0].text, /exceeded 1 business day/, 'wrapped cell text kept whole');
assert.deepEqual(c.exceptions.slice(0, 2).map(e => e.criterion), ['CC6.3', 'CC8.1'], 'control-number layout resolved through the mapping table');
assert.ok(c.exceptions.slice(0, 2).every(e => e.via === 'map'));
assert.equal(c.exceptions[2].confidence, 'low', 'unmapped control stays uncertain'); assert.ok(c.exceptions[2].candidates.length > 1);
// not a report
const n = scanReport(['Quarterly newsletter', 'Nothing to see here.']);
assert.equal(n.exceptions.length, 0); assert.ok(n.notes.some(x => /not be a SOC 2/.test(x)));
console.log('SCANNER TESTS PASSED');
