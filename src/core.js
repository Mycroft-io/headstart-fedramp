// Headstart 20x core: parse an ISO 27001:2022 Statement of Applicability and lay it against the
// FedRAMP 20x Key Security Indicators. Pure functions, no DOM. SoA text is untrusted.

export const CLASSES = { b: 'Class B', c: 'Class C', d: 'Class D' };
export const SOURCES = {
  iso: { label: 'ISO/IEC 27001:2022 SoA', unit: 'Annex A control', units: 'Annex A controls', mappingKey: 'iso',
    states: {
      head: { label: 'Head start', long: 'Every strongly related Annex A control is applicable and implemented in your SoA. Expect to re-evidence it in 20x terms.' },
      partial: { label: 'Partial', long: 'Some related Annex A controls are in place. The rest, and the 20x additions, are open.' },
      gap: { label: 'Gap', long: 'None of the related Annex A controls are applicable and implemented in your SoA.' },
      flag: { label: 'Excluded in SoA', long: 'A strongly related control is marked not applicable in your SoA. 20x will expect it for the federal boundary.' } } },
  soc2: { label: 'SOC 2 report', unit: 'Trust Services criterion', units: 'Trust Services criteria', mappingKey: 'tsc',
    states: {
      head: { label: 'Head start', long: 'Every strongly related criterion was in scope with no exception. Expect to re-evidence it in 20x terms.' },
      partial: { label: 'Partial', long: 'Some related criteria were in scope and clean. The rest, and the 20x additions, are open.' },
      gap: { label: 'Gap', long: 'None of the related criteria were in scope of the report.' },
      flag: { label: 'Exception noted', long: 'The report noted an exception against a strongly related criterion. Fix the finding before building on it.' } } },
};
export const STATES = SOURCES.iso.states; // default labels; buildModel attaches the source's own
export const STATE_ORDER = ['head', 'partial', 'gap', 'flag'];
export const TSC_RE = /\b(CC\d\.\d|A1\.\d|C1\.\d|PI1\.\d|P[1-8]\.\d)\b/gi;

// SOC 2 input: { reportType: 'Type 1'|'Type 2', period: string, categories: string[], exceptions: [{criterion, text}], controls?: [{criterion, control, result}] }
// Returns the same shape as a parsed SoA: a Map of entries plus notes.
export function soc2Entries(input, tsc) {
  const cats = new Set((input.categories || []).map(c => String(c).toLowerCase()));
  cats.add('security');
  const notes = [];
  const exceptions = new Map();
  for (const e of input.exceptions || []) {
    const id = normTsc(e.criterion, tsc);
    if (!id) continue;
    exceptions.set(id, [...(exceptions.get(id) || []), String(e.text || '').trim()].filter(Boolean));
  }
  const tested = new Map();
  for (const c of input.controls || []) { const id = normTsc(c.criterion, tsc); if (id) tested.set(id, [...(tested.get(id) || []), c]); }
  const controls = new Map();
  for (const id of Object.keys(tsc.criteria)) {
    const cat = tsc.categoryOf[id.replace(/[\d.].*$/, '')];
    if (!cats.has(cat)) continue;
    const ex = exceptions.get(id) || [];
    controls.set(id, { id, applicable: true, status: ex.length ? 'partial' : 'implemented', flag: ex.length > 0, justification: ex.join(' | ') || (tested.get(id) || []).map(c => c.control).filter(Boolean).slice(0, 3).join(' | '), row: 0 });
  }
  if (input.reportType && /1|I\b/.test(String(input.reportType))) notes.push('A Type 1 report describes control design at a point in time. 20x expects operating evidence, so treat every head start as design-only.');
  if (!cats.has('availability')) notes.push('Availability was not in scope, so the recovery and availability indicators read as gaps even if you run those controls.');
  if (!cats.has('confidentiality')) notes.push('Confidentiality was not in scope; data removal (KSI-SVC-RUD) leans on it.');
  return { controls, notes, soc2: { ...input, categories: [...cats] } };
}
export function normTsc(s, tsc) {
  const m = /^\s*(CC|A|C|PI|P)\s*(\d)\s*\.\s*(\d)\s*$/i.exec(String(s ?? ''));
  if (!m) return null;
  const id = `${m[1].toUpperCase()}${m[2]}.${m[3]}`;
  return tsc.criteria[id] ? id : null;
}
// Pull "CC6.1: text" style lines out of free text.
export function parseExceptionLines(text) {
  const out = [];
  for (const line of String(text || '').split(/\n+/)) {
    const ids = [...new Set([...line.matchAll(TSC_RE)].map(m => m[1].toUpperCase()))];
    for (const id of ids) out.push({ criterion: id, text: line.replace(TSC_RE, '').replace(/^[\s:;,\-–—]+/, '').trim() });
  }
  return out;
}

const ANNEX_RANGES = { 5: 37, 6: 8, 7: 14, 8: 34 };
export function normIso(s) {
  const m = /^\s*(?:A\.?\s*)?([5-8])\s*[.\-]\s*(\d{1,2})\s*$/i.exec(String(s ?? ''));
  if (!m) return null;
  const a = +m[1], b = +m[2];
  return b >= 1 && b <= ANNEX_RANGES[a] ? `${a}.${b}` : null;
}
const is2013 = s => /^\s*A\.?\s*(\d{1,2})\.(\d{1,2})\.(\d{1,2})\s*$/i.test(String(s ?? ''));

const APPLICABLE_NO = /\b(not\s*applicable|n\/?a|excluded?|exclusion|out\s*of\s*scope|no)\b/i;
const APPLICABLE_YES = /\b(applicable|included?|in\s*scope|yes|y|selected|✓|✔|x)\b/i;
// Order matters: "partially implemented" and "not implemented" must not read as implemented.
const STATUS = [
  [/\bplanned\b|\bnot\s*(yet\s*)?implemented\b|\bto\s*do\b|\bnot\s*started\b|\bmissing\b|\bopen\b/i, 'planned'],
  [/\bpartial(ly)?\b|\bin\s*progress\b|\bongoing\b|\bpartly\b/i, 'partial'],
  [/\b(fully\s+)?implemented\b|\bin\s*place\b|\bcomplete[d]?\b|\boperating\b|\beffective\b/i, 'implemented'],
];
const NOT_STATUS = /\bnot\s+implemented\b/i;

// rows: array of arrays of cell strings. Returns { controls: Map<id, {applicable, status, justification, row}>, notes }.
export function parseSoaRows(rows) {
  const controls = new Map();
  const notes = [];
  let legacy = 0;
  // header detection: the first row containing an Annex id decides the id column; status/applicability columns from header text
  let idCol = -1, headerIdx = -1, applCol = -1, statCol = -1, justCol = -1;
  for (let i = 0; i < Math.min(rows.length, 60) && idCol < 0; i++) {
    const r = rows[i] || [];
    for (let c = 0; c < r.length; c++) if (normIso(r[c])) { idCol = c; headerIdx = i - 1; break; }
  }
  if (idCol < 0) {
    if (rows.some(r => (r || []).some(is2013))) notes.push('This looks like an ISO 27001:2013 Statement of Applicability (A.x.y.z numbering). Headstart 20x reads the 2022 Annex A. Transition the SoA to 2022 numbering first.');
    return { controls, notes };
  }
  for (let h = Math.max(0, headerIdx - 3); h <= headerIdx; h++) {
    const r = rows[h] || [];
    r.forEach((v, c) => {
      const t = String(v ?? '').toLowerCase();
      if (/applicab|in\s*scope|selected|included/.test(t) && applCol < 0) applCol = c;
      if (/status|implement|maturity|state/.test(t) && statCol < 0 && !/applicab/.test(t)) statCol = c;
      if (/justif|reason|rationale|comment|remark/.test(t) && justCol < 0) justCol = c;
    });
  }
  for (let i = Math.max(0, headerIdx + 1); i < rows.length; i++) {
    const r = rows[i] || [];
    const id = normIso(r[idCol]);
    if (!id) { if (is2013(r[idCol])) legacy++; continue; }
    const cells = r.map(v => String(v ?? '').trim());
    const others = cells.filter((_, c) => c !== idCol);
    let applicable = null, status = null;
    const applText = applCol >= 0 ? cells[applCol] : '';
    if (applText) applicable = APPLICABLE_NO.test(applText) ? false : APPLICABLE_YES.test(applText) ? true : null;
    const statText = statCol >= 0 ? cells[statCol] : '';
    const classify = t => { if (NOT_STATUS.test(t)) return 'planned'; for (const [re, s] of STATUS) if (re.test(t)) return s; return null; };
    if (statText) status = classify(statText);
    if (applicable === null) {
      const joined = others.join(' | ');
      if (/\bnot\s*applicable\b|\bn\/a\b|\bexcluded\b|\bout\s*of\s*scope\b/i.test(joined)) applicable = false;
      else if (/\bapplicable\b|\bin\s*scope\b|\bincluded\b/i.test(joined) || status) applicable = true;
    }
    if (status === null) for (const t of others) { const s = classify(t); if (s) { status = s; break; } }
    const justification = justCol >= 0 ? cells[justCol] : '';
    controls.set(id, { id, applicable, status, justification, row: i + 1 });
  }
  if (legacy) notes.push(`${legacy} rows use 2013-style numbering (A.x.y.z) and were skipped.`);
  if (controls.size && controls.size < 60) notes.push(`Only ${controls.size} of 93 Annex A controls were found. Controls not listed are treated as not applicable.`);
  if (controls.size && [...controls.values()].every(c => c.status === null)) notes.push('No implementation status column was recognized, so every applicable control is treated as implemented. Readiness will read higher than it is.');
  return { controls, notes };
}

// CSV / TSV text to rows (RFC 4180-ish, handles quotes).
export function parseDelimited(text) {
  const delim = (text.match(/\t/g) || []).length > (text.match(/,/g) || []).length ? '\t' : (text.match(/;/g) || []).length > (text.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Minimal .xlsx reader: first sheet with an Annex id wins. unzip: fflate.unzipSync, dec: strFromU8.
export function parseXlsx(bytes, unzip, dec) {
  const files = unzip(bytes);
  const read = p => (files[p] ? dec(files[p]) : '');
  const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
  const shared = [];
  const ss = read('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
  const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const sheets = Object.keys(files).filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  const all = [];
  for (const p of sheets) {
    const xml = read(p); const rows = [];
    for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const [, ref, attrs, inner = ''] = cm;
        let v = '';
        const t = /t="([^"]+)"/.exec(attrs)?.[1];
        if (t === 's') { const i = +(/<v>([^<]*)<\/v>/.exec(inner)?.[1] ?? -1); v = shared[i] ?? ''; }
        else if (t === 'inlineStr') v = unesc([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
        else if (t === 'b') v = /<v>1<\/v>/.test(inner) ? 'Yes' : 'No';
        else v = unesc(/<v>([^<]*)<\/v>/.exec(inner)?.[1] ?? '');
        row[colIdx(ref)] = v;
      }
      rows.push(Array.from(row, x => x ?? ''));
    }
    all.push(rows);
  }
  return all.find(rows => rows.some(r => r.some(normIso))) || all[0] || [];
}

// ---------- model ----------

export function buildModel(data, mapping, annex, soa, cls, source = 'iso') {
  const src = SOURCES[source]; const key = src.mappingKey;
  const ids = Object.keys(mapping).filter(k => k !== '_about');
  const counts = Object.fromEntries(STATE_ORDER.map(s => [s, 0]));
  let optionalSkipped = 0;
  const ksis = ids.map(id => {
    const k = data.ksi[id]; const m = mapping[id];
    const optional = cls === 'b' && k.optionalInB;
    const links = Object.entries(m[key]).map(([c, strength]) => {
      const e = soa.controls.get(c) || null;
      const applicable = e ? e.applicable !== false : false;
      const status = e ? (e.status ?? (applicable ? 'implemented' : null)) : null;
      const covered = applicable && status === 'implemented';
      const flagged = !!e && (e.flag === true || (source === 'iso' && e.applicable === false));
      return { id: c, title: annex[c], strength, entry: e, applicable, status, covered, listed: !!e, flagged, note: e?.justification || '' };
    });
    const strong = links.filter(l => l.strength === 'strong');
    const coveredN = links.filter(l => l.covered).length;
    const excluded = strong.some(l => l.flagged);
    let state;
    if (excluded) state = 'flag';
    else if (strong.length ? strong.every(l => l.covered) : coveredN === links.length) state = 'head';
    else if (coveredN > 0 || links.some(l => l.status === 'partial')) state = 'partial';
    else state = 'gap';
    if (optional) optionalSkipped++; else counts[state]++;
    return { id, name: k.name, theme: k.theme, statement: k.statement, adds: m.adds, optional, links, state, covered: coveredN, total: links.length };
  });
  const themes = [...new Set(ksis.map(k => k.theme))].map(t => {
    const list = ksis.filter(k => k.theme === t && !k.optional);
    return { name: t, n: list.length, counts: Object.fromEntries(STATE_ORDER.map(s => [s, list.filter(k => k.state === s).length])) };
  });
  const frr = data.frr.filter(r => r.classes.includes(cls));
  const sets = [...new Set(frr.map(r => r.set))].map(s => ({ name: s, rules: frr.filter(r => r.set === s) })).sort((a, b) => b.rules.length - a.rules.length);
  const soaStats = {
    listed: soa.controls.size,
    applicable: [...soa.controls.values()].filter(c => c.applicable !== false).length,
    implemented: [...soa.controls.values()].filter(c => c.applicable !== false && (c.status ?? 'implemented') === 'implemented').length,
    notApplicable: [...soa.controls.values()].filter(c => c.applicable === false).length,
    hasStatus: [...soa.controls.values()].some(c => c.status !== null),
  };
  const unusedAnnex = Object.keys(annex).filter(c => !ids.some(k => mapping[k][key][c]));
  return { source, src, states: src.states, cls, ksis, counts, scored: ids.length - optionalSkipped, optionalSkipped, themes, frr, sets, soaStats, unusedAnnex, rulesVersion: data.rulesVersion, soc2: soa.soc2 || null };
}

// ---------- exports ----------

export const NOTICE = 'Headstart 20x is a planning aid. It maps FedRAMP 20x Key Security Indicators to ISO/IEC 27001:2022 Annex A controls and to the SOC 2 Trust Services Criteria, and reads your SoA or report against that mapping. A control being implemented or a criterion being clean does not mean the indicator is met: 20x asks for cloud-native, automated and continuously evidenced outcomes, and for FedRAMP-specific requirements that ISO 27001 does not contain. The mapping is Mycroft\'s, not FedRAMP\'s.';

export function ksiRows(model, notes = new Map()) {
  const head = ['KSI', 'Name', 'Theme', 'Readiness', `Related ${model.src.units} (strength)`, 'Covered', 'Not covered', 'What 20x adds', 'KSI statement', 'Gemma interpretation (on-device)'];
  return [head, ...model.ksis.map(k => [k.id, k.name, k.theme, k.optional ? `${model.states[k.state].label} (optional in Class B)` : model.states[k.state].label,
    k.links.map(l => `${l.id} ${l.title} (${l.strength})`).join('\n'),
    k.links.filter(l => l.covered).map(l => l.id).join(', '),
    k.links.filter(l => !l.covered).map(l => `${l.id}: ${l.flagged && model.source === 'soc2' ? 'exception' : !l.listed ? (model.source === 'soc2' ? 'not in scope' : 'not in SoA') : !l.applicable ? 'not applicable' : l.status || 'no status'}`).join('\n'),
    k.adds, k.statement, notes.get(k.id) || ''])];
}
export function ruleRows(model) {
  return [['Rule', 'Name', 'Rule set', 'Applies to classes', 'Statement'], ...model.frr.map(r => [r.id, r.name, r.set, r.classes.map(c => c.toUpperCase()).join(', '), r.statement])];
}
export function workplanRows(model) {
  const head = ['Priority', 'Item', 'Type', 'Why', `${model.src.units} to extend`, 'What 20x adds'];
  const rows = [];
  for (const k of model.ksis.filter(k => !k.optional && k.state !== 'head')) {
    const pri = k.state === 'gap' || k.state === 'flag' ? 1 : 2;
    rows.push([pri, `${k.id} ${k.name}`, 'Key Security Indicator', model.states[k.state].long, k.links.filter(l => !l.covered).map(l => l.id).join(', '), k.adds]);
  }
  for (const k of model.ksis.filter(k => !k.optional && k.state === 'head')) rows.push([3, `${k.id} ${k.name}`, 'Key Security Indicator', 'Re-evidence in 20x terms.', '', k.adds]);
  for (const s of model.sets) rows.push([2, `${s.name} (${s.rules.length} rules)`, 'FedRAMP rules', `FedRAMP-specific. No ${model.src.unit} evidences these.`, '', s.rules.slice(0, 6).map(r => r.id).join(', ') + (s.rules.length > 6 ? ', …' : '')]);
  rows.sort((a, b) => a[0] - b[0]);
  return [head, ...rows];
}

const safeCell = v => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };
export function toCsv(rows) { return '﻿' + rows.map(r => r.map(v => `"${safeCell(v).replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n'; }

const xml = s => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
export function toXlsx(sheets, zip, enc) {
  const files = {};
  files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  files['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  files['xl/styles.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>`;
  sheets.forEach((s, i) => {
    const n = Math.max(1, ...s.rows.map(r => r.length));
    const cols = Array.from({ length: n }, (_, c) => `<col min="${c + 1}" max="${c + 1}" width="${s.widths?.[c] ?? 24}" customWidth="1"/>`).join('');
    const body = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = colName(ci) + (ri + 1);
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${ri ? 2 : 1}"><v>${v}</v></c>`;
      const t = String(v ?? '').slice(0, 32000);
      return t ? `<c r="${ref}" s="${ri ? 2 : 1}" t="inlineStr"><is><t xml:space="preserve">${xml(t)}</t></is></c>` : '';
    }).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
  });
  return zip(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc(v)])));
}
export function workbookSheets(model, meta, notes = new Map()) {
  const summary = [['Field', 'Value'], ['Source', model.src.label], ['Target', `FedRAMP 20x ${CLASSES[model.cls]}`], ['Generated', meta.generated], ['FedRAMP rules version', model.rulesVersion],
    [`${model.src.units} read`, model.soaStats.listed], ['Applicable / in scope', model.soaStats.applicable], ['Implemented / clean', model.soaStats.implemented],
    ...STATE_ORDER.map(s => [`KSIs: ${model.states[s].label}`, model.counts[s]]), ['KSIs scored', model.scored], ['KSIs optional in this class', model.optionalSkipped],
    ['FedRAMP rules with no ISO equivalent', model.frr.length], ['How to read this', NOTICE]];
  return [
    { name: 'Summary', rows: summary, widths: [40, 90] },
    { name: 'Work plan', rows: workplanRows(model), widths: [9, 40, 22, 60, 30, 80] },
    { name: 'KSI readiness', rows: ksiRows(model, notes), widths: [14, 34, 28, 16, 60, 24, 40, 80, 80, 90] },
    { name: 'FedRAMP rules', rows: ruleRows(model), widths: [16, 40, 34, 14, 100] },
    ...(model.soc2 ? [{ name: 'SOC 2 input', rows: [['Field', 'Value'], ['Report type', model.soc2.reportType || ''], ['Period', model.soc2.period || ''], ['Categories in scope', (model.soc2.categories || []).join(', ')], ...(model.soc2.exceptions || []).map(e => ['Exception ' + e.criterion, e.text])], widths: [28, 100] }] : []),
  ];
}
