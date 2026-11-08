// Rules-based SOC 2 report scanner. Input: the report's text, one string per page. Output: what the
// SOC 2 form needs, each item with a confidence and the text it came from, for the reader to confirm.
// No model involved. Report text is untrusted.

export const RESULT_PHRASES = [
  // [pattern, meaning]. Order matters: "no exceptions" must win over "exception".
  [/\bno\s+(?:relevant\s+)?(?:exceptions?|deviations?)\s+(?:were\s+)?(?:noted|identified|found|observed)\b/i, 'clean'],
  [/\bwithout\s+exception\b/i, 'clean'],
  [/\boperat(?:ed|ing)\s+effectively\b(?!\s+(?:except|with))/i, 'clean'],
  [/\b(?:exceptions?|deviations?)\s+(?:were\s+)?(?:noted|identified|found|observed)\b/i, 'exception'],
  [/\bexception\s*:/i, 'exception'],
  [/\bnot\s+operating\s+effectively\b/i, 'exception'],
  [/\bcontrol\s+(?:was|is)\s+not\s+(?:designed|implemented|performed|operating)\b/i, 'exception'],
  [/\b(?:control|test)\s+(?:was\s+)?not\s+tested\b|\bno\s+testing\s+(?:was\s+)?performed\b|\bnot\s+applicable\s+during\s+the\s+period\b/i, 'not-tested'],
];
export const CRITERION_RE = /\b(CC\s?[1-9]\.\d|A\s?1\.[1-3]|C\s?1\.[12]|PI\s?1\.[1-5]|P\s?[1-8]\.\d)\b/g;
const CATEGORY_WORDS = { security: /\bsecurity\b/i, availability: /\bavailability\b/i, confidentiality: /\bconfidentiality\b/i, processing: /\bprocessing\s+integrity\b/i, privacy: /\bprivacy\b/i };
const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE = `(?:${MONTH}\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+${MONTH}\\.?,?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{4})`;
const PERIOD_RE = new RegExp(`(?:throughout|for|during|covering)\\s+the\\s+period\\s+(?:from\\s+)?(${DATE})\\s*(?:to|through|thru|until|[-–—])\\s*(${DATE})`, 'i');
const ASOF_RE = new RegExp(`\\bas\\s+of\\s+(${DATE})`, 'i');
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
const keepLines = s => String(s || '').split('\n').map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim()).filter(Boolean).join('\n');
export const normCriterion = s => String(s || '').toUpperCase().replace(/\s+/g, '');

export function scanReport(pages) {
  const text = pages.map(keepLines).join('\n');
  const head = pages.slice(0, Math.min(pages.length, 12)).map(norm).join('\n');
  const notes = [];

  // report type and period
  let reportType = 'unknown', period = '', typeConf = 'low';
  const pm = PERIOD_RE.exec(head) || PERIOD_RE.exec(text);
  const am = ASOF_RE.exec(head);
  if (pm) { reportType = 'Type 2'; period = `${pm[1]} to ${pm[2]}`; typeConf = 'high'; }
  else if (am) { reportType = 'Type 1'; period = `as of ${am[1]}`; typeConf = 'medium'; }
  if (/\btype\s*(?:2|II)\b/i.test(head) && reportType !== 'Type 2') { reportType = 'Type 2'; typeConf = typeConf === 'high' ? 'high' : 'medium'; }
  else if (/\btype\s*(?:1|I)\b/i.test(head) && reportType === 'unknown') { reportType = 'Type 1'; typeConf = 'medium'; }

  // categories: the opinion's "relevant to security, availability ..." phrase, else criteria present
  const categories = new Set(['security']); let catConf = 'low';
  const rel = /(?:relevant\s+to|criteria\s+for|trust\s+services\s+criteria\s+(?:for|relevant\s+to))\s+([^.;:]{0,160}?)(?:\s+\(|set\s+forth|\.|;|:)/gi;
  let m; const catHits = {};
  while ((m = rel.exec(head)) !== null) for (const [cat, re] of Object.entries(CATEGORY_WORDS)) if (re.test(m[1])) catHits[cat] = (catHits[cat] || 0) + 1;
  if (Object.keys(catHits).length) { for (const c of Object.keys(catHits)) categories.add(c); catConf = 'high'; }
  const presentIds = new Set([...text.matchAll(CRITERION_RE)].map(x => normCriterion(x[1])));
  const byPrefix = { availability: /^A1\./, confidentiality: /^C1\./, processing: /^PI1\./, privacy: /^P[1-8]\./ };
  for (const [cat, re] of Object.entries(byPrefix)) if ([...presentIds].some(id => re.test(id))) { if (!categories.has(cat)) { categories.add(cat); if (catConf === 'low') catConf = 'medium'; } }

  // service organization: "Report on <Name>'s ..." or "<Name>'s description of its ... system"
  let serviceOrganization = '';
  const so = /(?:report\s+on|description\s+of)\s+([A-Z][\w&.,'\- ]{2,60}?)(?:'s|’s)\s+(?:description|system|controls|hosting|platform)/i.exec(head) || /^([A-Z][\w&.,'\- ]{2,60}?)\s*\n[^\n]*SOC\s*2/m.exec(head);
  if (so) serviceOrganization = norm(so[1]);

  // Section 4 region: from the heading onward, else whole text
  const s4 = /(?:section|part)\s*(?:4|IV)\b[^\n]{0,120}(?:tests?\s+of\s+controls|controls?,?\s+tests?|results)/i.exec(text) || /tests?\s+of\s+(?:operating\s+effectiveness|controls)\s+and\s+results/i.exec(text);
  const body = s4 ? text.slice(s4.index) : text;
  if (!s4) notes.push('Could not find the Section 4 heading, so the whole text was scanned for test results.');

  // control -> criterion map, from lines like "CC6.1  IAM-1, IAM-2" (a criteria-to-controls table) or "Control CC6.1-1"
  const ctlMap = new Map();
  const CTL = /\b([A-Z]{1,6}-\d{1,3}(?:\.\d{1,2})?)\b/g;
  for (const line of body.split('\n')) {
    const ids = [...line.matchAll(CRITERION_RE)].map(x => normCriterion(x[1]));
    if (ids.length !== 1) continue;
    const rest = line.replace(CRITERION_RE, ' ');
    const ctls = [...rest.matchAll(CTL)].map(x => x[1]);
    if (ctls.length && ctls.length <= 12 && rest.replace(CTL, '').replace(/[\s,;and]/g, '').length < 20) for (const c of ctls) if (!ctlMap.has(c)) ctlMap.set(c, ids[0]);
  }
  const RESULT_ANY = new RegExp(RESULT_PHRASES.map(([re]) => `(?:${re.source})`).join('|'), 'i');

  // exceptions: each result phrase, attributed by control number through the map when possible, else to the nearest criterion ID
  const exceptions = []; const tested = new Set(); let cleanCount = 0;
  // collect every result phrase, then keep the earliest-starting of any overlapping matches
  const hits = [];
  for (const [re, meaning] of RESULT_PHRASES) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let r; while ((r = g.exec(body)) !== null) hits.push({ at: r.index, end: r.index + r[0].length, meaning });
  }
  hits.sort((a, b) => a.at - b.at || b.end - a.end);
  let lastEnd = -1;
  for (const h of hits) {
    if (h.at < lastEnd) continue;
    lastEnd = h.end;
    const at = h.at;
    const back = body.slice(Math.max(0, at - 900), at); const fwd = body.slice(at, at + 600);
    const backIds = [...back.matchAll(CRITERION_RE)].map(x => ({ id: normCriterion(x[1]), pos: x.index }));
    const fwdIds = [...fwd.matchAll(CRITERION_RE)].map(x => normCriterion(x[1]));
    const near = backIds.length ? backIds[backIds.length - 1] : null;
    const rowBack = back.slice(-220);
    const ctlTok = [...rowBack.replace(CRITERION_RE, ' ').matchAll(CTL)].map(x => x[1]);
    const mapped = ctlTok.map(c => ctlMap.get(c)).filter(Boolean);
    let criterion = '', dist = Infinity, via = 'text';
    if (mapped.length) { criterion = mapped[mapped.length - 1]; dist = 0; via = 'map'; }
    else if (near) { criterion = near.id; dist = back.length - near.pos; }
    else if (fwdIds.length) { criterion = fwdIds[0]; dist = 1000; }
    // a result phrase between the criterion and this one means the criterion belongs to an earlier row
    const between = near && via === 'text' ? back.slice(near.pos) : '';
    const stale = via === 'text' && between && RESULT_ANY.test(between.slice(0, -1));
    if (criterion) tested.add(criterion);
    if (h.meaning === 'clean') { cleanCount++; continue; }
    if (h.meaning === 'not-tested') continue;
    // the exception text: this sentence, plus the next one when this one is just the verdict
    const sentences = fwd.split(/(?<=[.!?])\s+(?=[A-Z])|\n/);
    let text = sentences[0] || ''; if (text.length < 40 && sentences[1]) text += ' ' + sentences[1];
    const nextId = fwd.search(CRITERION_RE); if (nextId > 0 && nextId < text.length) text = text.slice(0, nextId);
    const ctl = ctlTok.length ? ctlTok[ctlTok.length - 1] : '';
    const confidence = !criterion ? 'low' : via === 'map' ? 'high' : stale ? 'low' : dist < 300 ? 'high' : dist < 700 ? 'medium' : 'low';
    text = norm(text).replace(/^(?:exceptions?|deviations?)\s+(?:were\s+)?(?:noted|identified|found|observed)\s*[:.\-–—]?\s*/i, '').replace(/^result\s*:\s*/i, '');
    if (!text) text = 'Exception noted (see report).';
    const candidates = [...new Set([criterion, ...mapped, ...backIds.slice(-4).map(x => x.id), ...fwdIds.slice(0, 2), ...(stale ? [...ctlMap.values()] : [])].filter(Boolean))].slice(0, 8);
    exceptions.push({ criterion, candidates, via, control: ctl, text: text.slice(0, 400), snippet: norm(back.slice(-160) + ' ' + text).slice(0, 600), confidence, offset: at });
  }
  exceptions.sort((a, b) => a.offset - b.offset);
  // merge duplicates on same criterion + near-identical text
  const merged = [];
  for (const e of exceptions) { const d = merged.find(x => x.criterion === e.criterion && x.text.slice(0, 80) === e.text.slice(0, 80)); if (!d) merged.push(e); }

  const criteriaTested = [...tested].sort();
  if (!cleanCount && !merged.length) notes.push('No test result phrases ("no exceptions noted", "exception noted") were found. This may not be a SOC 2 report, or the PDF text may not be extractable (scanned image).');
  if (merged.some(e => e.confidence !== 'high')) notes.push('Some exceptions could not be tied confidently to a criterion. Check the ones marked medium or low before reading the report.');

  return {
    reportType, period, typeConf, categories: [...categories], catConf, serviceOrganization,
    exceptions: merged, criteriaTested, cleanCount, notes, pages: pages.length, chars: text.length,
    section4Found: !!s4,
  };
}
