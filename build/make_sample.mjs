// A fictional ISO 27001:2022 Statement of Applicability for testing and the demo. Not a real company.
import fs from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { toXlsx } from '../src/core.js';
const annex = JSON.parse(fs.readFileSync('data/annex-a.json', 'utf8'));
const na = new Set(['7.12', '8.30', '8.11', '8.23', '5.32']);
const partial = new Set(['8.16', '8.9', '5.7', '8.25', '8.29', '5.30', '8.12']);
const planned = new Set(['8.8', '5.21', '8.17', '8.10']);
const rows = [['Northwind Analytics Ltd. — Statement of Applicability (ISO/IEC 27001:2022)'], [], ['Control ID', 'Control name', 'Applicable', 'Justification for inclusion / exclusion', 'Implementation status', 'Evidence']];
for (const [id, title] of Object.entries(annex)) {
  const app = na.has(id) ? 'No' : 'Yes';
  const status = na.has(id) ? '' : partial.has(id) ? 'Partially implemented' : planned.has(id) ? 'Planned' : 'Implemented';
  const why = na.has(id) ? 'Not applicable: fully cloud-hosted, no owned facilities or outsourced development' : 'Risk assessment RA-2026-03; contractual requirement';
  rows.push([`A.${id}`, title, app, why, status, na.has(id) ? '' : `EV-${id.replace('.', '-')}`]);
}
fs.writeFileSync('samples/northwind-soa-2022.xlsx', toXlsx([{ name: 'SoA', rows, widths: [12, 60, 12, 60, 24, 14] }], zipSync, strToU8));
fs.writeFileSync('samples/northwind-soa-2022.csv', '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n'));
console.log('sample rows', rows.length);
