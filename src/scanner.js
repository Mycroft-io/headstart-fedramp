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
export const normCriterion = s => String(s || '').toUpperCase().replace(/\s+/g, '');

export function scanReport(pages) {
  const text = pages.map(norm).join('\n');
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

  // exceptions: each result phrase, attributed to the nearest criterion ID looking back, then forward
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
    const criterion = near ? near.id : fwdIds[0] || '';
    const dist = near ? back.length - near.pos : fwdIds.length ? 1000 : Infinity;
    if (criterion) tested.add(criterion);
    if (h.meaning === 'clean') { cleanCount++; continue; }
    if (h.meaning === 'not-tested') continue;
    // the exception text: this sentence, plus the next one when this one is just the verdict
    const sentences = fwd.split(/(?<=[.!?])\s+(?=[A-Z])|\n/);
    let text = sentences[0] || ''; if (text.length < 40 && sentences[1]) text += ' ' + sentences[1];
    const nextId = fwd.search(CRITERION_RE); if (nextId > 0 && nextId < text.length) text = text.slice(0, nextId);
    const ctl = /\b([A-Z]{1,4}[-.]?\d{1,3}(?:[-.]\d{1,2})?)\b/.exec(back.slice(-120).replace(CRITERION_RE, ''));
    const confidence = !criterion ? 'low' : dist < 300 ? 'high' : dist < 700 ? 'medium' : 'low';
    text = norm(text).replace(/^(?:exceptions?|deviations?)\s+(?:were\s+)?(?:noted|identified|found|observed)\s*[:.\-–—]?\s*/i, '').replace(/^result\s*:\s*/i, '');
    if (!text) text = 'Exception noted (see report).';
    exceptions.push({ criterion, control: ctl ? ctl[1] : '', text: text.slice(0, 400), snippet: norm(back.slice(-160) + ' ' + text).slice(0, 600), confidence, offset: at });
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
