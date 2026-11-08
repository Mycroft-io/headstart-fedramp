import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import * as C from './core.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = JSON.parse($('data').textContent);
const { fedramp: data, mapping, mappingSoc2, annex, tsc, sample } = D;
const TITLES = { iso: annex, soc2: tsc.criteria };
const MAPPINGS = { iso: mapping, soc2: mappingSoc2 };
let sampleFn = null; // claude.ai 'sample' capability, resolved after load; null elsewhere
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
  { id: 'xlsx', name: 'Readiness workbook', ext: 'xlsx', what: 'Summary, a prioritised work plan, every indicator with its Annex A evidence and the 20x additions, and the FedRAMP rules for your class.' },
  { id: 'workplan', name: 'Work plan', ext: 'csv', what: 'Gaps and partials first, then re-evidencing of head starts, then the FedRAMP rule sets.' },
  { id: 'ksi', name: 'Indicator readiness', ext: 'csv', what: 'One row per indicator.' },
  { id: 'rules', name: 'FedRAMP rules', ext: 'csv', what: 'The rules that apply to your class, with statements.' },
];
function renderExport() {
  const m = state.model; const top = C.workplanRows(m).slice(1).filter(r => r[0] === 1).slice(0, 8);
  $('view').innerHTML = `<p class="lede">Start with the indicators where ISO gives you nothing to build on${top.length ? `: ${top.map(r => `<strong>${esc(r[1].split(' ')[0])}</strong>`).join(', ')}` : ''}. Then extend the partials, then plan the FedRAMP rule sets as new programme work. ${esc(C.NOTICE)}</p>
    ${sampleFn ? `<div class="ai memo-card" style="margin-bottom:14px"><div class="ai-head"><span class="spark" aria-hidden="true">✦</span><strong>Draft a readiness summary with Claude</strong></div><p class="dim">A one-page note for your leadership from the reading above: where you stand for ${esc(C.CLASSES[m.cls])}, the first gaps to close, and what the FedRAMP rules add. Written from the computed result, on your own Claude account, after you allow it. Check it before you send it.</p>
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
// ---------- Claude (claude.ai artifact only) ----------
const AI_COPY = { not_granted: 'Claude is not allowed for this page, so this stays manual.', rate_limited: 'Claude is busy or you have hit a usage limit. Try again in a little while.', refused: 'Claude declined to read that text.', invalid_json: 'Claude did not return a readable result. Try pasting less text, such as only Section 4.', prompt_too_large: 'That is more text than one call can take. Paste Section 4 only.', upstream_error: 'The connection dropped. Try again.', session_expired: 'Sign in to Claude again, then retry.' };
const aiCopy = e => AI_COPY[e?.code] || (['sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(e?.code) ? AI_COPY.not_granted : AI_COPY.upstream_error);
let aiCtl = null;
async function aiExtract() {
  const text = $('ai-text').value.trim(); const status = $('ai-status'); const found = $('ai-found');
  if (!text) { status.textContent = 'Paste the report text first.'; return; }
  const run = $('ai-run'), stop = $('ai-stop');
  run.disabled = true; stop.hidden = false; found.hidden = true; status.textContent = 'Reading… this can take a minute for a long report.';
  aiCtl = new AbortController();
  const prompt = `You are reading text from a SOC 2 report (AICPA Trust Services Criteria). Extract facts only; do not assess anything.
Reply with only a JSON object of this shape:
{"reportType":"Type 1"|"Type 2"|"unknown","period":"<examination period or as-of date as written, or empty>","categories":["security","availability","confidentiality","processing","privacy"] (only those in scope),"serviceOrganization":"<name or empty>","exceptions":[{"criterion":"CC6.3","text":"<the exception or deviation as written, one sentence>"}],"criteriaTested":["CC1.1","CC1.2",...]}
Rules: criteria are identifiers like CC1.1 to CC9.2, A1.1 to A1.3, C1.1, C1.2, PI1.1 to PI1.5, P1.1 to P8.1. An exception is any test result that is not "no exceptions noted" (deviations, exceptions, controls not operating). Include every exception you find, attributed to the criterion the control supports; if the text gives the control number but not the criterion, infer the criterion from the control's subject. If a field is not in the text, use empty or unknown. Do not invent anything.

REPORT TEXT:
` + text.slice(0, 200000);
  try {
    const x = await sampleFn.json(prompt, { signal: aiCtl.signal, modelTier: 'default' });
    if (!x || typeof x !== 'object') throw { code: 'invalid_json' };
    fillSoc2Form(x);
    const exc = Array.isArray(x.exceptions) ? x.exceptions.filter(e => e && C.normTsc(e.criterion, tsc)) : [];
    const tested = Array.isArray(x.criteriaTested) ? x.criteriaTested.filter(c => C.normTsc(c, tsc)).length : 0;
    status.textContent = `Done. ${exc.length} exception${exc.length === 1 ? '' : 's'} found${tested ? `, ${tested} criteria seen` : ''}. Check the form, then read the report.`;
    found.hidden = false;
    found.innerHTML = `<p class="dim" style="font-size:13px">${x.serviceOrganization ? `Service organisation: <strong>${esc(x.serviceOrganization)}</strong>. ` : ''}What Claude found, written into the form above:</p>` + (exc.length ? `<ul class="found">${exc.map(e => `<li><span class="mono">${esc(String(e.criterion).toUpperCase())}</span><span>${esc(String(e.text || '').slice(0, 300))}</span><span class="tag t-bad">exception</span></li>`).join('')}</ul>` : '<p class="dim" style="font-size:13px">No exceptions found in the text.</p>');
  } catch (e) {
    status.textContent = e?.code === 'cancelled' ? 'Stopped.' : aiCopy(e);
    if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(e?.code)) $('ai-extract').hidden = true;
  } finally { run.disabled = false; stop.hidden = true; aiCtl = null; }
}
let memoCtl = null;
async function aiMemo() {
  const m = state.model; const out = $('memo'); const status = $('memo-status'); const run = $('memo-run'), stop = $('memo-stop'), copy = $('memo-copy');
  run.disabled = true; stop.hidden = false; copy.hidden = true; out.hidden = false; out.textContent = 'Thinking…'; status.textContent = '';
  memoCtl = new AbortController();
  const gaps = m.ksis.filter(k => !k.optional && (k.state === 'gap' || k.state === 'flag')).map(k => `${k.id} ${k.name} [${m.states[k.state].label}]: ${k.adds}`);
  const partials = m.ksis.filter(k => !k.optional && k.state === 'partial').map(k => `${k.id} ${k.name}: missing ${k.links.filter(l => !l.covered).map(l => l.id).join(', ')}`);
  const heads = m.ksis.filter(k => !k.optional && k.state === 'head').map(k => k.id);
  const prompt = `Write a one-page readiness note (about 350 words, plain prose with at most one short list) for a cloud provider's leadership team, from the data below. Audience: executives who know ${m.source === 'soc2' ? 'SOC 2' : 'ISO 27001'} but not FedRAMP. Tone: direct, specific, no hype, no percentages or scores. Structure: where we stand (2-3 sentences), the first things to close (name indicators by ID and what 20x asks for), what carries over and still needs re-evidencing, the FedRAMP rules as a separate workstream, and a closing sentence on sequencing. Do not invent facts, dates, costs or timelines. Do not mention this tool by name.

DATA
Source: ${m.src.label}${m.soc2 ? ` (${m.soc2.reportType || ''}${m.soc2.period ? ', ' + m.soc2.period : ''}; categories: ${(m.soc2.categories || []).join(', ')})` : ''}
Target: FedRAMP 20x ${C.CLASSES[m.cls]} (${m.scored} indicators scored${m.optionalSkipped ? `, ${m.optionalSkipped} optional in this class` : ''})
Head start: ${m.counts.head} indicators (${heads.join(', ')})
Partial: ${m.counts.partial}
Gaps and flags: ${m.counts.gap + m.counts.flag}
FedRAMP rules with no equivalent: ${m.frr.length}, in sets: ${m.sets.map(s => `${s.name} (${s.rules.length})`).join('; ')}

GAPS AND FLAGS
${gaps.join('\n') || 'none'}

PARTIALS
${partials.join('\n') || 'none'}

A note that applies to every indicator: 20x expects cloud-native, automated and continuously evidenced outcomes, validated by a third-party assessor, and FedRAMP-specific items such as FIPS 140-validated cryptography and FedRAMP reporting.`;
  try {
    const { text, truncated } = await sampleFn(prompt, { signal: memoCtl.signal, onText: ({ text }) => { out.textContent = text; } });
    out.textContent = text; copy.hidden = false;
    status.textContent = truncated ? 'Cut short. Ask again for a shorter note.' : 'Drafted by Claude from the reading above. Review before sending.';
  } catch (e) {
    out.textContent = e?.text || ''; if (!e?.text) out.hidden = true;
    status.textContent = e?.code === 'cancelled' ? 'Stopped.' : aiCopy(e);
  } finally { run.disabled = false; stop.hidden = true; memoCtl = null; }
}
async function copyMemo(btn) {
  const t = $('memo').textContent;
  try { await navigator.clipboard.writeText(t); btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }
  catch { const r = document.createRange(); r.selectNodeContents($('memo')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); btn.textContent = 'Selected, press copy'; }
}
(async () => {
  try { sampleFn = window.claude?.use ? await window.claude.use('sample') : null; } catch { sampleFn = null; }
  if (sampleFn) { $('ai-extract').hidden = false; if (state.model && state.tab === 'export') renderExport(); }
})();

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
  const t = e.target.closest('[data-tab],[data-state],[data-export],#open,#clear,[data-open],[data-sample],[data-src],#use-paste,#ai-run,#ai-stop,#memo-run,#memo-stop,#memo-copy');
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
  else if (t.id === 'ai-stop') aiCtl?.abort();
  else if (t.id === 'memo-run') aiMemo();
  else if (t.id === 'memo-stop') memoCtl?.abort();
  else if (t.id === 'memo-copy') copyMemo(t);
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
document.addEventListener('submit', e => { if (e.target.id === 'soc2-form') { e.preventDefault(); readSoc2Form(); } });
addEventListener('hashchange', () => { if (location.hash === '#sample') loadSample('iso'); else if (location.hash === '#sample-soc2') loadSample('soc2'); else setTab(location.hash.slice(1), true); });

$('rules-version').textContent = data.rulesVersion;
state.tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'indicators';
if (location.hash === '#sample') loadSample('iso'); else if (location.hash === '#sample-soc2') loadSample('soc2'); else refresh();
