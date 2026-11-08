import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import * as C from './core.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = JSON.parse($('data').textContent);
const { fedramp: data, mapping, annex, sample } = D;
const store = { get(k) { try { return localStorage.getItem('hs20x.' + k); } catch { return null; } }, set(k, v) { try { localStorage.setItem('hs20x.' + k, v); } catch { /* optional */ } } };
const TABS = ['indicators', 'rules', 'soa', 'export'];
const GLYPH = { head: '●', partial: '◐', gap: '○', excluded: '✕' };

const state = { soa: null, name: '', sample: false, model: null, cls: ['b', 'c', 'd'].includes(store.get('cls')) ? store.get('cls') : 'c', tab: 'indicators', states: new Set(), q: '' };

// ---------- loading ----------
function setSoa(parsed, name, isSample) {
  state.soa = parsed; state.name = name; state.sample = isSample; state.states.clear(); state.q = '';
  refresh();
}
function loadSample() { setSoa(C.parseSoaRows(C.parseDelimited(sample.csv)), sample.name, true); }
function clearAll() {
  state.soa = null; state.name = ''; state.sample = false; state.states.clear();
  if (location.hash === '#sample') { try { history.replaceState(null, '', location.pathname); } catch { location.hash = ''; } }
  refresh(); scrollTo({ top: 0 });
}
async function loadFile(f) {
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
  $('empty').hidden = has; $('loaded').hidden = !has; $('clear').hidden = !has;
  if (!has) return;
  $('empty-notes').hidden = true;
  state.model = C.buildModel(data, mapping, annex, state.soa, state.cls);
  renderHeader(); renderCoverage(); renderTab();
}
function renderHeader() {
  const s = state.model.soaStats;
  $('ident').innerHTML = `<div class="ident-name">${esc(state.name)}</div>
    <div class="ident-meta">${s.listed} Annex A controls listed <span class="sep">/</span> ${s.applicable} applicable <span class="sep">/</span> ${s.hasStatus ? `${s.implemented} implemented` : 'no status column, applicable read as implemented'} <span class="sep">/</span> ${s.notApplicable} not applicable</div>`;
  $('sample-note').hidden = !state.sample;
  const notes = state.soa.notes;
  $('notes').hidden = !notes.length; $('notes').innerHTML = notes.map(n => `<p>${esc(n)}</p>`).join('');
  $('cls').value = state.cls;
}
function pill(s) { return `<span class="pill s-${s}"><span class="glyph" aria-hidden="true">${GLYPH[s]}</span>${esc(C.STATES[s].label)}</span>`; }
function bar(counts, total) {
  return C.STATE_ORDER.filter(s => counts[s]).map(s => `<span class="seg s-${s}" style="flex:${counts[s]} 0 0" title="${esc(C.STATES[s].label)}: ${counts[s]}"></span>`).join('') || `<span class="seg s-gap" style="flex:1 0 0"></span>`;
}
function renderCoverage() {
  const m = state.model;
  const open = m.counts.partial + m.counts.gap + m.counts.excluded;
  $('headline').innerHTML = `Your SoA gives a head start on <strong>${m.counts.head}</strong> of ${m.scored} indicators for ${C.CLASSES[m.cls]}. <strong>${open}</strong> need work, and <strong>${m.frr.length}</strong> FedRAMP rules have no ISO equivalent.`;
  $('bar').innerHTML = bar(m.counts, m.scored);
  $('legend').innerHTML = C.STATE_ORDER.map(s => `<button type="button" class="chip s-${s}${state.states.has(s) ? ' on' : ''}" data-state="${s}" aria-pressed="${state.states.has(s)}" title="${esc(C.STATES[s].long)}"><span class="glyph" aria-hidden="true">${GLYPH[s]}</span><span class="chip-n">${m.counts[s]}</span> ${esc(C.STATES[s].label)}</button>`).join('');
  $('themes').innerHTML = m.themes.map(t => `<div class="theme"><h4>${esc(t.name)}<span>${t.counts.head}/${t.n}</span></h4><div class="bar">${bar(t.counts, t.n)}</div></div>`).join('');
  $('caveat').textContent = `A head start means the related Annex A controls are in place, not that the indicator is met. Every indicator carries a note on what 20x adds.${m.optionalSkipped ? ` ${m.optionalSkipped} indicators are optional in Class B and are shown but not counted.` : ''} Mapping version 1; FedRAMP rules ${m.rulesVersion}.`;
}
const statusWord = l => (!l.listed ? 'not in SoA' : !l.applicable ? 'not applicable' : l.status === 'implemented' ? 'implemented' : l.status === 'partial' ? 'partially implemented' : l.status === 'planned' ? 'planned' : 'no status');
function ksiBody(k) {
  return `<div class="cols"><section><h4>Related Annex A controls in your SoA</h4><ul class="links">${k.links.map(l => `<li><span class="mono id">${esc(l.id)}</span><span>${esc(l.title)} <span class="dim">(${l.strength})</span></span><span class="tag ${l.covered ? 't-ok' : l.status === 'partial' ? 't-warn' : l.listed && !l.applicable ? 't-bad' : ''}">${esc(statusWord(l))}</span></li>`).join('')}</ul>
      <p class="rule-text">${esc(k.statement)}</p></section>
    <section><h4>What 20x adds</h4><div class="adds"><strong>Beyond ISO 27001</strong>${esc(k.adds)}</div>${k.optional ? '<p class="dim" style="font-size:13px">Optional for Class B.</p>' : ''}</section></div>`;
}
function renderIndicators() {
  const m = state.model; const q = state.q.trim().toLowerCase();
  const list = m.ksis.filter(k => (!state.states.size || state.states.has(k.state)) && (!q || k.id.toLowerCase().includes(q) || k.name.toLowerCase().includes(q) || k.theme.toLowerCase().includes(q) || k.links.some(l => l.id.includes(q))));
  const themes = [...new Set(m.ksis.map(k => k.theme))];
  $('view').innerHTML = `<div class="toolbar"><label class="field grow"><span class="sr">Search indicators</span><input id="q" type="search" placeholder="Search by indicator, theme or Annex A control, e.g. KSI-IAM, logging, 8.24" value="${esc(state.q)}" autocomplete="off"></label></div>
    <p class="count">${list.length === m.ksis.length ? 'All 46 indicators' : `${list.length} of 46 indicators`}. Open one to see the Annex A controls behind the reading and what 20x adds.</p>
    ${themes.map(t => { const l = list.filter(k => k.theme === t); if (!l.length) return ''; return `<section class="fam"><h3><span class="fam-code">${esc(t)}</span><span class="fam-n">${l.length}</span></h3>
      ${l.map(k => `<details class="ctl" data-id="${esc(k.id)}"><summary class="ksi"><span class="mono id">${esc(k.id)}</span><span class="ctl-title">${esc(k.name)}${k.optional ? ' <span class="dim">(optional in Class B)</span>' : ''}</span><span class="ctl-map">${k.covered} of ${k.total} controls in place</span>${pill(k.state)}</summary><div class="ctl-body"></div></details>`).join('')}</section>`; }).join('') || '<p class="empty pad">No indicators match.</p>'}`;
}
function renderRules() {
  const m = state.model;
  $('view').innerHTML = `<p class="lede">${m.frr.length} FedRAMP rules apply to a ${C.CLASSES[m.cls]} provider beyond the indicators. They cover how you certify, report, share data and handle vulnerabilities with FedRAMP and agencies. No ISO 27001 control evidences them; budget for them as new work.</p>
    <div class="card" style="overflow:hidden">${m.sets.map(s => `<details class="rule-set" style="border-bottom:1px solid var(--line)"><summary>${esc(s.name)}<span>${s.rules.length}</span></summary><ul>${s.rules.map(r => `<li><strong class="mono">${esc(r.id)}</strong> ${esc(r.name)}<div class="dim">${esc(r.statement)}</div></li>`).join('')}</ul></details>`).join('')}</div>`;
}
function renderSoa() {
  const m = state.model; const rows = [...state.soa.controls.values()].sort((a, b) => { const [x, y] = [a.id.split('.').map(Number), b.id.split('.').map(Number)]; return x[0] - y[0] || x[1] - y[1]; });
  const used = new Set(Object.keys(mapping).filter(k => k !== '_about').flatMap(k => Object.keys(mapping[k].iso)));
  $('view').innerHTML = `<p class="lede">How Headstart read your SoA, control by control. ${m.unusedAnnex.length} Annex A controls (physical, HR, legal) relate to no indicator and do not affect the reading.</p>
    <div class="scroll"><table class="reg"><thead><tr><th>Control</th><th class="wide">Title</th><th>Applicable</th><th>Status</th><th>Used by indicators</th><th class="wide">Justification</th></tr></thead><tbody>
    ${rows.map(c => { const ks = Object.keys(mapping).filter(k => k !== '_about' && mapping[k].iso[c.id]); return `<tr><td class="mono">${esc(c.id)}</td><td class="wide">${esc(annex[c.id])}</td><td>${c.applicable === false ? 'No' : c.applicable ? 'Yes' : '<span class="dim">not stated</span>'}</td><td>${esc(c.status || (c.applicable === false ? '' : 'not stated'))}</td><td>${used.has(c.id) ? ks.length : '<span class="dim">none</span>'}</td><td class="wide dim">${esc(c.justification)}</td></tr>`; }).join('')}
    </tbody></table></div>`;
}
const EXPORTS = [
  { id: 'xlsx', name: 'Readiness workbook', ext: 'xlsx', what: 'Summary, a prioritised work plan, every indicator with its Annex A evidence and the 20x additions, and the FedRAMP rules for your class.' },
  { id: 'workplan', name: 'Work plan', ext: 'csv', what: 'Gaps and partials first, then re-evidencing of head starts, then the FedRAMP rule sets.' },
  { id: 'ksi', name: 'Indicator readiness', ext: 'csv', what: 'One row per indicator.' },
  { id: 'rules', name: 'FedRAMP rules', ext: 'csv', what: 'The rules that apply to your class, with statements.' },
];
function renderExport() {
  const m = state.model; const top = C.workplanRows(m).slice(1).filter(r => r[0] === 1).slice(0, 8);
  $('view').innerHTML = `<p class="lede">Start with the indicators where ISO gives you nothing to build on${top.length ? `: ${top.map(r => `<strong>${esc(r[1].split(' ')[0])}</strong>`).join(', ')}` : ''}. Then extend the partials, then plan the FedRAMP rule sets as new programme work. ${esc(C.NOTICE)}</p>
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
  const t = e.target.closest('[data-tab],[data-state],[data-export],#open,#sample,#clear,[data-open],[data-sample],#use-paste');
  if (!t) return;
  if (t.dataset.tab) setTab(t.dataset.tab);
  else if (t.dataset.state) { const s = t.dataset.state; state.states.has(s) ? state.states.delete(s) : state.states.add(s); renderCoverage(); if (state.tab !== 'indicators') setTab('indicators'); else renderIndicators(); }
  else if (t.dataset.export) save(t.dataset.export, t);
  else if (t.id === 'open' || t.hasAttribute('data-open')) $('file').click();
  else if (t.id === 'sample' || t.hasAttribute('data-sample')) loadSample();
  else if (t.id === 'clear') clearAll();
  else if (t.id === 'use-paste') usePaste();
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
});
let depth = 0;
addEventListener('dragenter', e => { e.preventDefault(); if (depth++ === 0) document.body.classList.add('dragging'); });
addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); depth = 0; document.body.classList.remove('dragging'); if (e.dataTransfer?.files?.length) loadFile(e.dataTransfer.files[0]); });
addEventListener('hashchange', () => { if (location.hash === '#sample') loadSample(); else setTab(location.hash.slice(1), true); });

$('rules-version').textContent = data.rulesVersion;
state.tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'indicators';
if (location.hash === '#sample') loadSample(); else refresh();
