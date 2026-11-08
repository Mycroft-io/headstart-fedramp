import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import * as C from './core.js';
import { scanReport } from './scanner.js';
import { pdfToPages } from './pdftext.js';
import { createGemmaEngine, hasWebGPU, probeWebGPU, DOWNLOAD_NOTE } from './engines/gemma.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = JSON.parse($('data').textContent);
const { fedramp: data, mapping, mappingSoc2, annex, tsc, sample } = D;
const TITLES = { iso: annex, soc2: tsc.criteria };
const MAPPINGS = { iso: mapping, soc2: mappingSoc2 };
const store = { get(k) { try { return localStorage.getItem('hs20x.' + k); } catch { return null; } }, set(k, v) { try { localStorage.setItem('hs20x.' + k, v); } catch { /* optional */ } } };
const TABS = ['indicators', 'rules', 'soa', 'export'];
const GLYPH = { head: '●', partial: '◐', gap: '○', flag: '✕' };

const state = { source: 'iso', soa: null, name: '', sample: false, model: null, cls: ['b', 'c', 'd'].includes(store.get('cls')) ? store.get('cls') : 'c', tab: 'indicators', states: new Set(), q: '' };

// ---------- loading ----------
function setSoa(parsed, name, isSample, source = 'iso') {
  state.source = source; state.soa = parsed; state.name = name; state.sample = isSample; state.states.clear(); state.q = '';
  refresh();
}
function loadSample(which = 'iso') {
  if (which === 'soc2') return setSoa(C.soc2Entries(sample.soc2, tsc), 'Northwind Analytics Ltd. (fictional sample SOC 2 Type 2)', true, 'soc2');
  setSoa(C.parseSoaRows(C.parseDelimited(sample.csv)), sample.name, true, 'iso');
}
function readSoc2Form() {
  const f = $('soc2-form');
  const input = {
    reportType: f.querySelector('input[name=rtype]:checked')?.value || 'Type 2', period: $('period').value.trim(),
    categories: [...f.querySelectorAll('input[name=cat]:checked')].map(i => i.value),
    exceptions: C.parseExceptionLines($('exceptions').value),
  };
  const raw = $('exceptions').value.trim();
  if (raw && !input.exceptions.length) { showEmptyNote('No criterion references (such as CC6.1 or A1.2) were found in the exceptions. Start each line with the criterion.'); return; }
  setSoa(C.soc2Entries(input, tsc), `SOC 2 ${input.reportType}${input.period ? ', ' + input.period : ''}`, false, 'soc2');
}
function fillSoc2Form(x) {
  const f = $('soc2-form');
  const t = /1\b|\bI\b/.test(String(x.reportType || '')) && !/2|II/.test(String(x.reportType || '')) ? 'Type 1' : 'Type 2';
  f.querySelector(`input[name=rtype][value="${t}"]`).checked = true;
  $('period').value = String(x.period || '').slice(0, 80);
  const cats = new Set((x.categories || []).map(c => String(c).toLowerCase()));
  for (const i of f.querySelectorAll('input[name=cat]')) if (!i.disabled) i.checked = cats.has(i.value);
  $('exceptions').value = (x.exceptions || []).map(e => `${String(e.criterion || '').toUpperCase()}: ${String(e.text || '').replace(/\s+/g, ' ').trim()}`).join('\n');
}
function showSource(src) {
  state.source = src;
  for (const b of document.querySelectorAll('.src-tab')) { const on = b.dataset.src === src; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
  $('src-iso').hidden = src !== 'iso'; $('src-soc2').hidden = src !== 'soc2';
  $('empty-notes').hidden = true;
}
function clearAll() {
  state.soa = null; state.name = ''; state.sample = false; state.states.clear();
  if (/^#sample/.test(location.hash)) { try { history.replaceState(null, '', location.pathname); } catch { location.hash = ''; } }
  refresh(); scrollTo({ top: 0 });
}
async function loadFile(f) {
  showSource('iso');
  if (!f) return;
  let parsed;
  try {
    if (/\.xlsx$/i.test(f.name) || f.type.includes('spreadsheetml')) parsed = C.parseSoaRows(C.parseXlsx(new Uint8Array(await f.arrayBuffer()), unzipSync, strFromU8));
    else parsed = C.parseSoaRows(C.parseDelimited((await f.text()).replace(/^﻿/, '')));
  } catch (e) { showEmptyNote(`${f.name} could not be read (${e.message}). Export the SoA as .xlsx or .csv and try again.`); return; }
  if (!parsed.controls.size) { showEmptyNote(parsed.notes[0] || `${f.name} has no Annex A control IDs (A.5.1 to A.8.34) that Headstart can read. Check that the SoA sheet is the first sheet, or export it as CSV.`); return; }
  setSoa(parsed, f.name, false);
}
function usePaste() {
  const t = $('paste').value;
  const parsed = C.parseSoaRows(C.parseDelimited(t));
  if (!parsed.controls.size) { showEmptyNote(parsed.notes[0] || 'No Annex A control IDs (A.5.1 to A.8.34) found in the pasted rows.'); return; }
  setSoa(parsed, 'pasted rows', false);
}
function showEmptyNote(t) { $('empty-notes').hidden = false; $('empty-notes').innerHTML = `<p>${esc(t)}</p>`; }

// ---------- render ----------
function refresh() {
  const has = !!state.soa;
  $('empty').hidden = has; $('loaded').hidden = !has; $('clear').hidden = !has; $('open').hidden = has;
  if (!has) return;
  $('empty-notes').hidden = true;
  state.model = C.buildModel(data, MAPPINGS[state.source], TITLES[state.source], state.soa, state.cls, state.source);
  $('tab-soa').textContent = state.source === 'soc2' ? 'Your report' : 'Your SoA';
  renderHeader(); renderCoverage(); renderTab();
}
function renderHeader() {
  const s = state.model.soaStats; const m = state.model;
  const meta = m.source === 'soc2'
    ? `${esc(m.src.label)} <span class="sep">/</span> ${(m.soc2.categories || []).map(c => esc(tsc.categories[c] || c)).join(', ')} <span class="sep">/</span> ${s.listed} criteria in scope <span class="sep">/</span> ${(m.soc2.exceptions || []).length} exceptions noted`
    : `${s.listed} Annex A controls listed <span class="sep">/</span> ${s.applicable} applicable <span class="sep">/</span> ${s.hasStatus ? `${s.implemented} implemented` : 'no status column, applicable read as implemented'} <span class="sep">/</span> ${s.notApplicable} not applicable`;
  $('ident').innerHTML = `<div class="ident-name">${esc(state.name)}</div><div class="ident-meta">${meta}</div>`;
  $('sample-note').hidden = !state.sample;
  const notes = state.soa.notes;
  $('notes').hidden = !notes.length; $('notes').innerHTML = notes.map(n => `<p>${esc(n)}</p>`).join('');
  $('cls').value = state.cls;
}
function pill(s) { return `<span class="pill s-${s}"><span class="glyph" aria-hidden="true">${GLYPH[s]}</span>${esc(state.model.states[s].label)}</span>`; }
function bar(counts, total) {
  return C.STATE_ORDER.filter(s => counts[s]).map(s => `<span class="seg s-${s}" style="flex:${counts[s]} 0 0" title="${esc(state.model.states[s].label)}: ${counts[s]}"></span>`).join('') || `<span class="seg s-gap" style="flex:1 0 0"></span>`;
}
function renderCoverage() {
  const m = state.model;
  const open = m.counts.partial + m.counts.gap + m.counts.flag;
  const what = m.source === 'soc2' ? 'Your SOC 2 report' : 'Your SoA'; const std = m.source === 'soc2' ? 'SOC 2' : 'ISO';
  $('headline').innerHTML = `${what} gives a head start on <strong>${m.counts.head}</strong> of ${m.scored} indicators for ${C.CLASSES[m.cls]}. <strong>${open}</strong> need work, and <strong>${m.frr.length}</strong> FedRAMP rules have no ${std} equivalent.`;
  $('bar').innerHTML = bar(m.counts, m.scored);
  $('legend').innerHTML = C.STATE_ORDER.map(s => `<button type="button" class="chip s-${s}${state.states.has(s) ? ' on' : ''}" data-state="${s}" aria-pressed="${state.states.has(s)}" title="${esc(m.states[s].long)}"><span class="glyph" aria-hidden="true">${GLYPH[s]}</span><span class="chip-n">${m.counts[s]}</span> ${esc(m.states[s].label)}</button>`).join('');
  $('themes').innerHTML = m.themes.map(t => `<div class="theme"><h4>${esc(t.name)}<span>${t.counts.head}/${t.n}</span></h4><div class="bar">${bar(t.counts, t.n)}</div></div>`).join('');
  $('caveat').textContent = `A head start means the related ${m.src.units} are in place, not that the indicator is met. Every indicator carries a note on what 20x adds.${m.optionalSkipped ? ` ${m.optionalSkipped} indicators are optional in Class B and are shown but not counted.` : ''} Mapping version 1; FedRAMP rules ${m.rulesVersion}.`;
}
const statusWord = l => (state.source === 'soc2' ? (!l.listed ? 'not in scope' : l.flagged ? 'exception' : 'no exception') : !l.listed ? 'not in SoA' : !l.applicable ? 'not applicable' : l.status === 'implemented' ? 'implemented' : l.status === 'partial' ? 'partially implemented' : l.status === 'planned' ? 'planned' : 'no status');
function ksiBody(k) {
  const src = state.model.src;
  return `<div class="cols"><section><h4>Related ${esc(src.units)}${state.source === 'soc2' ? ' in your report' : ' in your SoA'}</h4><ul class="links">${k.links.map(l => `<li><span class="mono id">${esc(l.id)}</span><span>${esc(l.title)} <span class="dim">(${l.strength})</span>${l.flagged && l.note ? `<div class="dim" style="font-size:13px">${esc(l.note)}</div>` : ''}</span><span class="tag ${l.covered ? 't-ok' : l.flagged ? 't-bad' : l.status === 'partial' ? 't-warn' : ''}">${esc(statusWord(l))}</span></li>`).join('')}</ul>
      <p class="rule-text">${esc(k.statement)}</p></section>
    <section><h4>What 20x adds</h4><div class="adds"><strong>Beyond ${state.source === 'soc2' ? 'SOC 2' : 'ISO 27001'}</strong>${esc(k.adds)}</div>${k.optional ? '<p class="dim" style="font-size:13px">Optional for Class B.</p>' : ''}</section></div>`;
}
function renderIndicators() {
  const m = state.model; const q = state.q.trim().toLowerCase();
  const list = m.ksis.filter(k => (!state.states.size || state.states.has(k.state)) && (!q || k.id.toLowerCase().includes(q) || k.name.toLowerCase().includes(q) || k.theme.toLowerCase().includes(q) || k.links.some(l => l.id.includes(q))));
  const themes = [...new Set(m.ksis.map(k => k.theme))];
  $('view').innerHTML = `<div class="toolbar"><label class="field grow"><span class="sr">Search indicators</span><input id="q" type="search" placeholder="Search by indicator, theme or control, e.g. KSI-IAM, logging, 8.24, CC6.1" value="${esc(state.q)}" autocomplete="off"></label></div>
    <p class="count">${list.length === m.ksis.length ? 'All 46 indicators' : `${list.length} of 46 indicators`}. Open one to see the Annex A controls behind the reading and what 20x adds.</p>
    ${themes.map(t => { const l = list.filter(k => k.theme === t); if (!l.length) return ''; return `<section class="fam"><h3><span class="fam-code">${esc(t)}</span><span class="fam-n">${l.length}</span></h3>
      ${l.map(k => `<details class="ctl" data-id="${esc(k.id)}"><summary class="ksi"><span class="mono id">${esc(k.id)}</span><span class="ctl-title">${esc(k.name)}${k.optional ? ' <span class="dim">(optional in Class B)</span>' : ''}</span><span class="ctl-map">${k.covered} of ${k.total} ${state.source === 'soc2' ? 'criteria clean' : 'controls in place'}</span>${pill(k.state)}</summary><div class="ctl-body"></div></details>`).join('')}</section>`; }).join('') || '<p class="empty pad">No indicators match.</p>'}`;
}
function renderRules() {
  const m = state.model;
  $('view').innerHTML = `<p class="lede">${m.frr.length} FedRAMP rules apply to a ${C.CLASSES[m.cls]} provider beyond the indicators. They cover how you certify, report, share data and handle vulnerabilities with FedRAMP and agencies. No ${esc(m.src.unit)} evidences them; budget for them as new work.</p>
    <div class="card" style="overflow:hidden">${m.sets.map(s => `<details class="rule-set" style="border-bottom:1px solid var(--line)"><summary>${esc(s.name)}<span>${s.rules.length}</span></summary><ul>${s.rules.map(r => `<li><strong class="mono">${esc(r.id)}</strong> ${esc(r.name)}<div class="dim">${esc(r.statement)}</div></li>`).join('')}</ul></details>`).join('')}</div>`;
}
function renderSoa() {
  const m = state.model;
  if (m.source === 'soc2') {
    const used = new Set(Object.keys(mappingSoc2).filter(k => k !== '_about').flatMap(k => Object.keys(mappingSoc2[k].tsc)));
    const rows = [...state.soa.controls.values()];
    $('view').innerHTML = `<p class="lede">How Headstart read your report. ${m.soc2.reportType || ''}${m.soc2.period ? ', ' + esc(m.soc2.period) : ''}. Categories in scope: ${(m.soc2.categories || []).map(c => esc(tsc.categories[c] || c)).join(', ')}. Criteria in a category outside the report's scope are read as gaps.</p>
      <div class="scroll"><table class="reg"><thead><tr><th>Criterion</th><th class="wide">Label</th><th>Result</th><th>Used by indicators</th><th class="wide">Exception noted</th></tr></thead><tbody>
      ${rows.map(c => { const ks = Object.keys(mappingSoc2).filter(k => k !== '_about' && mappingSoc2[k].tsc[c.id]); return `<tr><td class="mono">${esc(c.id)}</td><td class="wide">${esc(tsc.criteria[c.id])}</td><td>${c.flag ? '<span class="tag t-bad">exception</span>' : '<span class="tag t-ok">no exception</span>'}</td><td>${used.has(c.id) ? ks.length : '<span class="dim">none</span>'}</td><td class="wide dim">${c.flag ? esc(c.justification) : ''}</td></tr>`; }).join('')}
      </tbody></table></div>`;
    return;
  } const rows = [...state.soa.controls.values()].sort((a, b) => { const [x, y] = [a.id.split('.').map(Number), b.id.split('.').map(Number)]; return x[0] - y[0] || x[1] - y[1]; });
  const used = new Set(Object.keys(mapping).filter(k => k !== '_about').flatMap(k => Object.keys(mapping[k].iso)));
  $('view').innerHTML = `<p class="lede">How Headstart read your SoA, control by control. ${m.unusedAnnex.length} Annex A controls (physical, HR, legal) relate to no indicator and do not affect the reading.</p>
    <div class="scroll"><table class="reg"><thead><tr><th>Control</th><th class="wide">Title</th><th>Applicable</th><th>Status</th><th>Used by indicators</th><th class="wide">Justification</th></tr></thead><tbody>
    ${rows.map(c => { const ks = Object.keys(mapping).filter(k => k !== '_about' && mapping[k].iso[c.id]); return `<tr><td class="mono">${esc(c.id)}</td><td class="wide">${esc(annex[c.id])}</td><td>${c.applicable === false ? 'No' : c.applicable ? 'Yes' : '<span class="dim">not stated</span>'}</td><td>${esc(c.status || (c.applicable === false ? '' : 'not stated'))}</td><td>${used.has(c.id) ? ks.length : '<span class="dim">none</span>'}</td><td class="wide dim">${esc(c.justification)}</td></tr>`; }).join('')}
    </tbody></table></div>`;
}
const EXPORTS = [
  { id: 'xlsx', name: 'Readiness workbook', ext: 'xlsx', what: 'Summary, a prioritized work plan, every indicator with its Annex A evidence and the 20x additions, and the FedRAMP rules for your class.' },
  { id: 'workplan', name: 'Work plan', ext: 'csv', what: 'Gaps and partials first, then re-evidencing of head starts, then the FedRAMP rule sets.' },
  { id: 'ksi', name: 'Indicator readiness', ext: 'csv', what: 'One row per indicator.' },
  { id: 'rules', name: 'FedRAMP rules', ext: 'csv', what: 'The rules that apply to your class, with statements.' },
];
function renderExport() {
  const m = state.model; const top = C.workplanRows(m).slice(1).filter(r => r[0] === 1).slice(0, 8);
  $('view').innerHTML = `<p class="lede">Start with the indicators where ISO gives you nothing to build on${top.length ? `: ${top.map(r => `<strong>${esc(r[1].split(' ')[0])}</strong>`).join(', ')}` : ''}. Then extend the partials, then plan the FedRAMP rule sets as new program work. ${esc(C.NOTICE)}</p>
    ${hasWebGPU() ? `<div class="ai memo-card" style="margin-bottom:14px"><div class="ai-head"><span class="spark" aria-hidden="true">✦</span><strong>Draft a readiness summary with Gemma, on this device</strong></div><p class="dim">A short note for your leadership from the reading above: where you stand for ${esc(C.CLASSES[m.cls])}, the first gaps to close, and what the FedRAMP rules add. Written by Gemma 4 running in this browser from the computed result; nothing leaves your machine. ${gemmaReady ? '' : 'Loads Gemma first (about 2 GB, once). '}Check it before you send it.</p>
      <div class="row" style="justify-content:flex-start;align-items:center"><button type="button" class="btn cta" id="memo-run">Draft summary</button><button type="button" class="btn" id="memo-stop" hidden>Stop</button><button type="button" class="btn" id="memo-copy" hidden>Copy</button><span id="memo-status" class="dim" role="status" aria-live="polite"></span></div>
      <div id="memo" class="memo" hidden></div></div>` : ''}
    <ul class="exports">${EXPORTS.map(x => `<li><div><strong>${esc(x.name)}</strong> <span class="mono dim">.${x.ext}</span><p class="dim">${esc(x.what)}</p></div><button type="button" class="btn" data-export="${x.id}">Save</button></li>`).join('')}</ul><p id="export-status" class="status" role="status" aria-live="polite"></p>`;
}
async function build(id) {
  const m = state.model; const meta = { generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
  const base = `headstart-20x-class-${m.cls}`;
  switch (id) {
    case 'xlsx': return [`${base}.xlsx`, C.toXlsx(C.workbookSheets(m, meta), zipSync, strToU8)];
    case 'workplan': return [`${base}-work-plan.csv`, C.toCsv(C.workplanRows(m))];
    case 'ksi': return [`${base}-indicators.csv`, C.toCsv(C.ksiRows(m))];
    case 'rules': return [`${base}-fedramp-rules.csv`, C.toCsv(C.ruleRows(m))];
  }
  throw new Error('Unknown export');
}
async function save(id, btn) {
  const status = $('export-status'); const say = (t, bad) => { status.textContent = t; status.classList.toggle('bad', !!bad); };
  btn.disabled = true;
  try {
    const [filename, d] = await build(id);
    if (window.claude?.use) {
      const dl = await window.claude.use('downloads');
      if (!dl) { say('Saving files is not available in this view. Open the page in a browser to save.', true); return; }
      try { await dl.save({ filename, data: d }); say(`Saved ${filename}.`); }
      catch (e) { say(e?.code === 'declined' ? 'Nothing was saved.' : `Could not save ${filename} here (${e?.code || 'unavailable'}).`, e?.code !== 'declined'); }
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([d])); a.download = filename; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000); say(`Saved ${filename}.`);
    }
  } catch (e) { say(`Could not build that file: ${e.message}`, true); } finally { btn.disabled = false; }
}
// ---------- PDF scanner ----------
let lastScan = null;
async function scanPdf(f) {
  if (!f) return;
  if (!$('empty').hidden || true) $('empty').scrollIntoView?.({ block: 'start' });
  showSource('soc2');
  const status = $('scan-status'), found = $('scan-found');
  found.hidden = true; status.textContent = 'Reading the PDF…';
  let pages;
  try { pages = await pdfToPages(new Uint8Array(await f.arrayBuffer()), (i, n) => { status.textContent = `Reading page ${i} of ${n}…`; }); }
  catch (e) { status.textContent = `Could not read ${f.name} (${e?.message || 'unreadable PDF'}).`; return; }
  const chars = pages.join('').replace(/\s/g, '').length;
  if (chars < 200) { status.textContent = 'This PDF has no extractable text (probably a scanned image). Use the form below instead.'; return; }
  const r = scanReport(pages); lastScan = r;
  fillSoc2Form({ reportType: r.reportType, period: r.period, categories: r.categories, exceptions: r.exceptions.filter(e => e.criterion) });
  status.textContent = `Scanned ${r.pages} pages. ${r.exceptions.length} exception${r.exceptions.length === 1 ? '' : 's'}, ${r.cleanCount} clean results, ${r.criteriaTested.length} criteria seen. The form is filled in; untick anything that is wrong, then read the report.`;
  renderFound(r);
  const uncertain = r.exceptions.filter(e => e.confidence !== 'high' && (e.candidates || []).length > 1);
  $('gemma').hidden = !(uncertain.length && hasWebGPU());
  if (uncertain.length && gemmaReady) { runGemma(); }
  if (uncertain.length && hasWebGPU()) { $('gemma-why').textContent = `${uncertain.length} exception${uncertain.length === 1 ? '' : 's'} could belong to more than one criterion. Gemma reads each snippet and picks among the nearby criteria; its picks are marked and you can still untick them.`; $('gemma-note').textContent = DOWNLOAD_NOTE; $('gemma-status').textContent = ''; }
}
function renderFound(r) {
  const found = $('scan-found');
  const conf = c => `<span class="conf conf-${c}">${c}</span>`;
  found.hidden = false;
  const meta = [
    r.serviceOrganization && ['Organization', esc(r.serviceOrganization)], r.system && ['System', esc(r.system)], r.auditor && ['Auditor', esc(r.auditor)],
    ['Report', `${esc(r.reportType)} ${conf(r.typeConf)}`], r.period && ['Period', esc(r.period)],
    ['Categories in scope', `${r.categories.map(c => esc(tsc.categories[c] || c)).join(', ')} ${conf(r.catConf)}`],
    ['Criteria referenced', `${r.criteriaInReport.length}${r.criteriaTested.length ? ` (${r.criteriaTested.length} with test results)` : ''}`],
    (r.subservice.length || r.carveOut) && ['Subservice organizations', `${r.subservice.map(esc).join(', ') || 'named in the report'}${r.carveOut ? `, ${esc(r.carveOut)} method` : ''} <span class="dim">(declare these as third-party resources in 20x)</span>`],
    r.cuecCount && ['Complementary user entity controls', `${r.cuecCount} listed`],
    r.locations.length && ['Locations', r.locations.map(esc).join('; ')],
  ].filter(Boolean);
  found.innerHTML = `<dl class="facts found-facts">${meta.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${r.criteriaInReport.length ? `<details class="crit"><summary class="dim">Criteria referenced in the report</summary><p class="mono" style="font-size:12.5px;line-height:1.8">${r.criteriaInReport.map(id => `<span class="${r.criteriaTested.includes(id) ? '' : 'dim'}" title="${esc(tsc.criteria[id] || '')}">${esc(id)}</span>`).join(' · ')}</p></details>` : ''}
    ${r.notes.map(n => `<p class="warn" style="font-size:13px">${esc(n)}</p>`).join('')}
    ${r.exceptions.length ? `<ul class="found">${r.exceptions.map((e, i) => `<li class="pick"><input type="checkbox" id="exc-${i}" data-exc="${i}" ${e.criterion ? 'checked' : ''} aria-label="Include this exception"><label for="exc-${i}" class="mono">${esc(e.criterion || '?')}</label><span><label for="exc-${i}">${esc(e.text)}</label>${e.control ? ` <span class="dim">(${esc(e.control)})</span>` : ''}${e.byGemma ? '<span class="gemma-tag">Gemma</span>' : ''}${e.confidence !== 'high' && !e.byGemma ? `<div class="dim" style="font-size:12.5px">Context: ${esc(e.snippet.slice(0, 220))}</div>` : ''}</span>${conf(e.confidence)}</li>`).join('')}</ul>` : '<p class="dim" style="font-size:13px">No exceptions found.</p>'}`;
}
function syncExceptionsFromScan() {
  if (!lastScan) return;
  const keep = [...document.querySelectorAll('[data-exc]')].filter(i => i.checked).map(i => lastScan.exceptions[+i.dataset.exc]).filter(e => e.criterion);
  $('exceptions').value = keep.map(e => `${e.criterion}: ${e.text}`).join('\n');
}

// ---------- Gemma on-device ----------
let gemma = null, gemmaCtl = null, gemmaReady = false;
let gemmaBusy = false;
function gemmaLoadUi(progressText) {
  const box = $('gemma-load'); if (box) box.hidden = !hasWebGPU();
  const btn = $('gemma-load-btn'); if (btn) { btn.textContent = gemmaReady ? 'Gemma is loaded on this device' : gemmaBusy ? 'Loading…' : 'Load Gemma on this device'; btn.disabled = gemmaReady || gemmaBusy; }
  const ex = $('ai-extract'); if (ex) ex.hidden = !hasWebGPU();
  const top = $('gemma-top'), topText = $('gemma-top-text');
  if (top) {
    top.hidden = !hasWebGPU();
    top.classList.toggle('ready', gemmaReady);
    top.disabled = gemmaReady || gemmaBusy;
    topText.textContent = gemmaReady ? 'Local AI ready · Gemma 4' : gemmaBusy ? (progressText || 'Loading local AI…') : 'Power up local AI';
    top.title = gemmaReady ? 'Gemma 4 is loaded in this browser and reads reports on this device.' : 'Loads Gemma 4 into this browser once (about 2 GB). It then reads reports on this device; nothing leaves your machine.';
  }
}
async function loadGemma() {
  if (gemmaBusy || gemmaReady) return;
  if (!$('empty').hidden) showSource('soc2'); // the progress line lives on the SOC 2 panel
  const status = $('gemma-load-status');
  gemmaBusy = true; gemmaCtl = new AbortController(); $('gemma-load-stop').hidden = false; gemmaLoadUi();
  const fmt = p => p.kind === 'bytes' && p.total ? `${p.message} ${(p.loaded / 1048576).toFixed(0)} / ${(p.total / 1048576).toFixed(0)} MB` : p.fraction != null ? `${p.message} ${Math.round(p.fraction * 100)}%` : p.message || 'Loading';
  const short = p => p.kind === 'bytes' && p.total ? `Loading local AI ${Math.round(100 * p.loaded / p.total)}%` : p.fraction != null ? `Loading local AI ${Math.round(p.fraction * 100)}%` : 'Loading local AI…';
  try {
    gemma ??= createGemmaEngine({ onProgress: p => { status.textContent = fmt(p); gemmaLoadUi(short(p)); } });
    status.textContent = 'Starting…';
    gemmaReady = await gemma.ready(gemmaCtl.signal);
    status.textContent = gemmaReady ? 'Ready. Gemma runs on this device; it will review uncertain exceptions after each scan.' : 'WebGPU is not available in this browser.';
  } catch (err) { status.textContent = gemmaCtl.signal.aborted ? 'Stopped.' : /fetch|network|download|Failed/i.test(String(err?.message)) ? 'Could not download the runtime or model. Check the connection and try again.' : `Gemma could not load here (${err?.message || 'unknown error'}).`; }
  finally { gemmaBusy = false; $('gemma-load-stop').hidden = true; gemmaCtl = null; gemmaLoadUi(); if (gemmaReady && lastScan) { const u = lastScan.exceptions.filter(e => e.confidence !== 'high' && (e.candidates || []).length > 1); if (u.length) runGemma(); } }
}
async function runGemma() {
  if (!lastScan) return;
  const status = $('gemma-status'), run = $('gemma-run'), stop = $('gemma-stop');
  run.disabled = true; stop.hidden = false; gemmaCtl = new AbortController();
  const fmt = p => p.kind === 'bytes' && p.total ? `${p.message} ${(p.loaded / 1048576).toFixed(0)} / ${(p.total / 1048576).toFixed(0)} MB` : p.fraction != null ? `${p.message} ${Math.round(p.fraction * 100)}%` : p.message || 'Loading';
  try {
    gemma ??= createGemmaEngine({ onProgress: p => { status.textContent = fmt(p); } });
    status.textContent = 'Starting…';
    const ok = await gemma.ready(gemmaCtl.signal); gemmaReady = ok; gemmaLoadUi();
    if (!ok) { status.textContent = 'WebGPU is not available in this browser.'; return; }
    const todo = lastScan.exceptions.filter(e => e.confidence !== 'high' && (e.candidates || []).length > 1);
    let n = 0, changed = 0;
    for (const e of todo) {
      if (gemmaCtl.signal.aborted) break;
      status.textContent = `Reading exception ${++n} of ${todo.length}…`;
      const options = e.candidates.filter(c => tsc.criteria[c]).map(c => `${c} ${tsc.criteria[c]}`);
      const q = `A SOC 2 auditor recorded this test result: "${e.snippet.slice(0, 500)}". Which Trust Services criterion does the tested control support?`;
      let pick = null;
      try { pick = await gemma.choose(q, options, { signal: gemmaCtl.signal }); } catch (err) { if (gemmaCtl.signal.aborted) break; throw err; }
      const id = pick ? pick.split(' ')[0] : null;
      if (id && tsc.criteria[id]) { if (id !== e.criterion) changed++; e.criterion = id; e.byGemma = true; e.confidence = 'medium'; }
    }
    renderFound(lastScan); syncExceptionsFromScan();
    status.textContent = gemmaCtl.signal.aborted ? 'Stopped.' : `Done. Gemma reviewed ${todo.length} exception${todo.length === 1 ? '' : 's'} and changed ${changed}. Its picks are marked; check them.`;
  } catch (err) {
    status.textContent = /import|fetch|network|Failed to load/i.test(String(err?.message)) ? 'Could not download the runtime or model. Check the connection and try again.' : `Gemma could not run here (${err?.message || 'unknown error'}).`;
  } finally { run.disabled = false; stop.hidden = true; gemmaCtl = null; }
}

// ---------- Gemma: read pasted text, draft the summary ----------
async function ensureGemma() {
  if (gemmaReady) return true;
  await loadGemma();
  return gemmaReady;
}
let aiCtl = null;
async function aiExtract() {
  const text = $('ai-text').value.trim(); const status = $('ai-status'); const found = $('ai-found');
  if (!text) { status.textContent = 'Paste the report text first.'; return; }
  const run = $('ai-run'), stop = $('ai-stop');
  run.disabled = true; stop.hidden = false; found.hidden = true;
  try {
    // deterministic pass first: front matter, clean results, and whatever exceptions the rules can place
    const r = scanReport(text.split(/\f|\n(?=\s*Page\s+\d+)/));
    lastScan = r;
    fillSoc2Form({ reportType: r.reportType, period: r.period, categories: r.categories, exceptions: r.exceptions.filter(e => e.criterion) });
    status.textContent = 'Loading Gemma…';
    if (!(await ensureGemma())) { status.textContent = 'Gemma is not available in this browser; the scanner\'s reading is in the form above.'; renderFound(r); found.hidden = false; return; }
    aiCtl = new AbortController();
    // Gemma reads Section 4 in chunks and lists exceptions as "CRITERION | text" lines; only valid criteria are kept
    const body = text.length > 200000 ? text.slice(0, 200000) : text;
    const chunks = []; for (let i = 0; i < body.length; i += 5000) chunks.push(body.slice(Math.max(0, i - 300), i + 5000));
    const seen = new Map();
    for (let i = 0; i < chunks.length; i++) {
      if (aiCtl.signal.aborted) break;
      status.textContent = `Gemma is reading part ${i + 1} of ${chunks.length}…`;
      const prompt = `Below is text from a SOC 2 report's tests of controls. List every test result that is NOT "no exceptions noted": exceptions, deviations, controls not operating effectively. For each, write one line in the form\nCRITERION | one-sentence description of the exception\nwhere CRITERION is the Trust Services criterion the tested control supports (like CC6.3, CC7.1, A1.2, C1.2). If the text gives only a control number, infer the criterion from the control's subject. If there are none, write NONE. Write nothing else.\n\nTEXT:\n${chunks[i]}`;
      let out = '';
      try { out = await gemma.complete(prompt, { maxNewTokens: 300, signal: aiCtl.signal }); } catch (err) { if (aiCtl.signal.aborted) break; throw err; }
      for (const line of out.split('\n')) {
        const m = /^\s*[-*•]?\s*(CC\s?\d\.\d|A\s?1\.\d|C\s?1\.\d|PI\s?1\.\d|P\s?\d\.\d)\s*\|\s*(.+?)\s*$/i.exec(line);
        if (!m) continue;
        const id = C.normTsc(m[1], tsc); const desc = m[2].replace(/\s+/g, ' ').slice(0, 300);
        if (!id || /^none$/i.test(desc)) continue;
        const key = id + '|' + desc.slice(0, 40).toLowerCase();
        if (!seen.has(key)) seen.set(key, { criterion: id, text: desc, byGemma: true, confidence: 'medium', candidates: [id], snippet: desc, control: '' });
      }
    }
    // merge: rule-placed exceptions keep priority; Gemma adds the rest
    const merged = [...r.exceptions.filter(e => e.criterion)];
    for (const g of seen.values()) if (!merged.some(e => e.criterion === g.criterion && e.text.slice(0, 30).toLowerCase() === g.text.slice(0, 30).toLowerCase())) merged.push(g);
    r.exceptions = merged; lastScan = r;
    fillSoc2Form({ reportType: r.reportType, period: r.period, categories: r.categories, exceptions: merged });
    renderFound(r); found.hidden = false;
    status.textContent = aiCtl.signal.aborted ? 'Stopped.' : `Done. ${merged.length} exception${merged.length === 1 ? '' : 's'} in the form above (${seen.size} read by Gemma). Check them, then read the report.`;
  } catch (e) { status.textContent = `Gemma could not read that (${e?.message || 'unknown error'}).`; }
  finally { run.disabled = false; stop.hidden = true; aiCtl = null; }
}
let memoCtl = null;
async function aiMemo() {
  const m = state.model; const out = $('memo'); const status = $('memo-status'); const run = $('memo-run'), stop = $('memo-stop'), copy = $('memo-copy');
  run.disabled = true; stop.hidden = false; copy.hidden = true; out.hidden = false; out.textContent = 'Loading Gemma…'; status.textContent = '';
  try {
    if (!(await ensureGemma())) { out.textContent = ''; out.hidden = true; status.textContent = 'Gemma is not available in this browser.'; return; }
    memoCtl = new AbortController(); out.textContent = 'Thinking…';
    const gaps = m.ksis.filter(k => !k.optional && (k.state === 'gap' || k.state === 'flag')).slice(0, 12).map(k => `${k.id} ${k.name} [${m.states[k.state].label}]: ${k.adds}`);
    const partials = m.ksis.filter(k => !k.optional && k.state === 'partial').slice(0, 12).map(k => `${k.id} ${k.name}`);
    const prompt = `Write a short readiness note (about 250 words, plain prose, no headings, no bullet points, no percentages) for a cloud provider's leadership team who know ${m.source === 'soc2' ? 'SOC 2' : 'ISO 27001'} but not FedRAMP. Be direct and specific. Do not invent facts, dates, costs or timelines. Cover: where we stand for FedRAMP 20x ${C.CLASSES[m.cls]}; the first indicators to close, by ID, and what 20x asks for; what carries over but must be re-evidenced; and the FedRAMP rules as separate work.\n\nDATA\nSource: ${m.src.label}\nIndicators scored: ${m.scored}. Head start: ${m.counts.head}. Partial: ${m.counts.partial}. Gaps or flagged: ${m.counts.gap + m.counts.flag}. FedRAMP rules with no equivalent: ${m.frr.length}.\nGAPS AND FLAGS\n${gaps.join('\n') || 'none'}\nPARTIALS\n${partials.join('\n') || 'none'}\nNOTE: 20x expects cloud-native, automated, continuously evidenced outcomes validated by a third-party assessor, plus FedRAMP-specific items such as FIPS 140-validated cryptography and FedRAMP reporting.`;
    const text = await gemma.complete(prompt, { maxNewTokens: 600, signal: memoCtl.signal, onText: t => { out.textContent = t; } });
    out.textContent = text.trim(); copy.hidden = false;
    status.textContent = memoCtl.signal.aborted ? 'Stopped.' : 'Drafted on this device by Gemma 4 from the reading above. Review before sending.';
  } catch (e) { if (!out.textContent || out.textContent === 'Thinking…') out.hidden = true; status.textContent = memoCtl?.signal.aborted ? 'Stopped.' : `Gemma could not draft that (${e?.message || 'unknown error'}).`; }
  finally { run.disabled = false; stop.hidden = true; memoCtl = null; }
}
async function copyMemo(btn) {
  const t = $('memo').textContent;
  try { await navigator.clipboard.writeText(t); btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }
  catch { const r = document.createRange(); r.selectNodeContents($('memo')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); btn.textContent = 'Selected, press copy'; }
}

function renderTab() {
  for (const b of document.querySelectorAll('[data-tab]')) { const on = b.dataset.tab === state.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
  $('tab-n-rules').textContent = String(state.model.frr.length);
  ({ indicators: renderIndicators, rules: renderRules, soa: renderSoa, export: renderExport })[state.tab]();
}
function setTab(t, fromHash) {
  state.tab = TABS.includes(t) ? t : 'indicators';
  if (!fromHash) { try { history.replaceState(null, '', '#' + state.tab); } catch { location.hash = state.tab; } }
  renderTab();
}

// ---------- events ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-state],[data-export],#open,#clear,[data-open],[data-sample],[data-src],#use-paste,#ai-run,#ai-stop,#memo-run,#memo-stop,#memo-copy,#pdf-open,#gemma-run,#gemma-stop,#gemma-load-btn,#gemma-load-stop,#gemma-top');
  if (!t) return;
  if (t.dataset.tab) setTab(t.dataset.tab);
  else if (t.dataset.state) { const s = t.dataset.state; state.states.has(s) ? state.states.delete(s) : state.states.add(s); renderCoverage(); if (state.tab !== 'indicators') setTab('indicators'); else renderIndicators(); }
  else if (t.dataset.export) save(t.dataset.export, t);
  else if (t.id === 'open') { $('empty').scrollIntoView({ behavior: 'smooth', block: 'start' }); document.querySelector('.src-tab.on')?.focus({ preventScroll: true }); }
  else if (t.hasAttribute('data-open')) $('file').click();
  else if (t.hasAttribute('data-sample')) loadSample(t.dataset.sample || 'iso');
  else if (t.dataset.src) showSource(t.dataset.src);
  else if (t.id === 'clear') clearAll();
  else if (t.id === 'use-paste') usePaste();
  else if (t.id === 'ai-run') aiExtract();
  else if (t.id === 'ai-stop') { aiCtl?.abort(); gemmaCtl?.abort(); }
  else if (t.id === 'memo-run') aiMemo();
  else if (t.id === 'memo-stop') memoCtl?.abort();
  else if (t.id === 'memo-copy') copyMemo(t);
  else if (t.id === 'pdf-open') $('pdf').click();
  else if (t.id === 'gemma-run') runGemma();
  else if (t.id === 'gemma-stop' || t.id === 'gemma-load-stop') gemmaCtl?.abort();
  else if (t.id === 'gemma-load-btn' || t.id === 'gemma-top') loadGemma();
});
document.addEventListener('toggle', e => {
  const d = e.target; if (!d.classList?.contains('ctl') || !d.open) return;
  const body = d.querySelector('.ctl-body'); if (body.childElementCount) return;
  const k = state.model.ksis.find(x => x.id === d.dataset.id); if (k) body.innerHTML = ksiBody(k);
}, true);
let timer;
document.addEventListener('input', e => {
  if (e.target.id !== 'q') return; state.q = e.target.value; clearTimeout(timer);
  timer = setTimeout(() => { const pos = e.target.selectionStart; renderIndicators(); const q = $('q'); q.focus(); try { q.setSelectionRange(pos, pos); } catch { /* fine */ } }, 140);
});
document.addEventListener('change', e => {
  if (e.target.id === 'cls') { state.cls = e.target.value; store.set('cls', state.cls); refresh(); }
  else if (e.target.id === 'file') { loadFile(e.target.files[0]); e.target.value = ''; }
  else if (e.target.id === 'pdf') { scanPdf(e.target.files[0]); e.target.value = ''; }
  else if (e.target.matches('[data-exc]')) syncExceptionsFromScan();
});
let depth = 0;
addEventListener('dragenter', e => { e.preventDefault(); if (depth++ === 0) document.body.classList.add('dragging'); });
addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); depth = 0; document.body.classList.remove('dragging'); const f = e.dataTransfer?.files?.[0]; if (!f) return; if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') scanPdf(f); else loadFile(f); });
document.addEventListener('submit', e => { if (e.target.id === 'soc2-form') { e.preventDefault(); readSoc2Form(); } });
function sampleScan() { const bytes = Uint8Array.from(atob(sample.pdf), c => c.charCodeAt(0)); scanPdf(new File([bytes], 'fabrikam-soc2-type2-sample.pdf', { type: 'application/pdf' })); }
addEventListener('hashchange', () => { if (location.hash === '#sample') loadSample('iso'); else if (location.hash === '#sample-soc2') loadSample('soc2'); else if (location.hash === '#sample-scan') sampleScan(); else setTab(location.hash.slice(1), true); });

$('rules-version').textContent = data.rulesVersion;
gemmaLoadUi();
probeWebGPU().then(() => { gemmaLoadUi(); if (lastScan) renderFound(lastScan); });
state.tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'indicators';
if (location.hash === '#sample') loadSample('iso'); else if (location.hash === '#sample-soc2') loadSample('soc2'); else { refresh(); if (location.hash === '#sample-scan') sampleScan(); }
