import fs from 'node:fs';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate';
import * as C from '../src/core.js';
const data = JSON.parse(fs.readFileSync('data/fedramp.json', 'utf8'));
const mapping = JSON.parse(fs.readFileSync('data/mapping.json', 'utf8'));
const annex = JSON.parse(fs.readFileSync('data/annex-a.json', 'utf8'));

// id normalisation
for (const [a, b] of [['A.5.1', '5.1'], ['A 8.34', '8.34'], ['5.37', '5.37'], ['a.8.24', '8.24'], ['8.35', null], ['A.9.1.1', null], ['5', null], ['Control', null]]) assert.equal(C.normIso(a), b, a);

// xlsx and csv agree
const x = C.parseSoaRows(C.parseXlsx(new Uint8Array(fs.readFileSync('samples/northwind-soa-2022.xlsx')), unzipSync, strFromU8));
const c = C.parseSoaRows(C.parseDelimited(fs.readFileSync('samples/northwind-soa-2022.csv', 'utf8').replace(/^﻿/, '')));
assert.equal(x.controls.size, 93); assert.equal(c.controls.size, 93);
for (const [id, e] of x.controls) { const f = c.controls.get(id); assert.equal(e.applicable, f.applicable, id); assert.equal(e.status, f.status, id); }
assert.equal(x.controls.get('7.12').applicable, false); assert.equal(x.controls.get('8.16').status, 'partial'); assert.equal(x.controls.get('8.8').status, 'planned'); assert.equal(x.controls.get('5.1').status, 'implemented');
console.log('parse notes', x.notes);

// pasted text without headers, mixed formats
const p = C.parseSoaRows(C.parseDelimited('A.5.15\tAccess control\tApplicable\tImplemented\nA.8.5\tSecure authentication\tNot applicable\n8.2\tPrivileged access\tyes\tpartially implemented\n'));
assert.equal(p.controls.size, 3); assert.equal(p.controls.get('8.5').applicable, false); assert.equal(p.controls.get('8.2').status, 'partial'); assert.equal(p.controls.get('5.15').status, 'implemented');
// 2013 SoA is rejected with a note
const old = C.parseSoaRows(C.parseDelimited('A.9.1.1,Access control policy,Yes\nA.12.4.1,Event logging,Yes\n'));
assert.equal(old.controls.size, 0); assert.ok(old.notes[0].includes('2013'));
// no status column: treated as implemented with a note
const ns = C.parseSoaRows(C.parseDelimited('Control,Applicable\nA.8.15,Yes\nA.8.16,Yes\n'));
assert.ok(ns.notes.some(n => n.includes('status')));

for (const cls of ['b', 'c', 'd']) {
  const m = C.buildModel(data, mapping, annex, x, cls);
  const sum = Object.values(m.counts).reduce((a, b) => a + b, 0);
  assert.equal(sum + m.optionalSkipped, 46);
  assert.equal(m.optionalSkipped, cls === 'b' ? 5 : 0);
  for (const k of m.ksis) {
    const strong = k.links.filter(l => l.strength === 'strong');
    if (k.state === 'head') assert.ok(strong.length ? strong.every(l => l.covered) : k.covered === k.total, k.id);
    if (k.state === 'gap') assert.equal(k.covered, 0, k.id);
  }
  console.log(cls, m.counts, 'frr', m.frr.length, 'sets', m.sets.length);
}
const m = C.buildModel(data, mapping, annex, x, 'c');
// empty SoA: everything is a gap
const e = C.buildModel(data, mapping, annex, { controls: new Map(), notes: [] }, 'c');
assert.equal(e.counts.gap, 46);
// all implemented: no gaps, but still FedRAMP-only rules
const full = new Map(Object.keys(annex).map(id => [id, { id, applicable: true, status: 'implemented' }]));
const f = C.buildModel(data, mapping, annex, { controls: full, notes: [] }, 'c');
assert.equal(f.counts.head, 46); assert.ok(f.frr.length > 100);
// exports
const wb = C.toXlsx(C.workbookSheets(m, { generated: '2026-11-08T00:00:00Z' }), zipSync, strToU8);
assert.ok(Object.keys(unzipSync(wb)).includes('xl/worksheets/sheet4.xml'));
assert.ok(C.toCsv([['=cmd']]).includes(`"'=cmd"`));
console.log('workplan rows', C.workplanRows(m).length - 1, 'sample excluded', m.ksis.filter(k => k.state === 'excluded').map(k => k.id));
console.log('ALL TESTS PASSED');
