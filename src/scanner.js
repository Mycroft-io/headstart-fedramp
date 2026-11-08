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

// Positions of the report's main sections, by their headings. Missing ones are -1.
export function sectionIndex(text) {
  const find = (n, roman, words) => { const re = new RegExp(`(?:^|\\n)\\s*(?:section|part)\\s*(?:${n}|${roman})\\b[^\\n]{0,160}`, 'gi'); let best = -1; for (const m of text.matchAll(re)) { if (words.test(m[0])) { best = m.index; break; } if (best < 0) best = m.index; } return best; };
  return {
    s1: find(1, 'I', /auditor|opinion|report/i), s2: find(2, 'II', /assertion|management/i),
    s3: find(3, 'III', /description|system/i), s4: find(4, 'IV', /test|control|result/i),
  };
}
export function scopeText(text) {
  const ix = sectionIndex(text);
  const slice = (a, b) => (a >= 0 ? text.slice(a, b > a ? b : a + 12000) : '');
  const s1 = slice(ix.s1, ix.s2 > ix.s1 ? ix.s2 : ix.s3), s2 = slice(ix.s2, ix.s3 > ix.s2 ? ix.s3 : ix.s4);
  return { s1, s2, ix };
}
export function scanReport(pages) {
  const text = pages.map(keepLines).join('\n');
  const { s1, s2 } = scopeText(text);
  const cover = pages.slice(0, Math.min(pages.length, 3)).map(norm).join('\n');
  const head = ((s1 || s2) ? cover + '\n' + norm(s1 + '\n' + s2) : pages.slice(0, Math.min(pages.length, 12)).map(norm).join('\n')).slice(0, 40000);
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
  const rel = /(?:relevant\s+to|criteria\s+for|trust\s+services\s+criteria\s+(?:for|relevant\s+to)|based\s+on\s+the\s+(?:applicable\s+)?trust\s+services\s+criteria\s+(?:for|relevant\s+to)|commitments\s+and\s+system\s+requirements\s+(?:relevant\s+to|for))\s+([^.;:]{0,200}?)(?:\s+\(|set\s+forth|\.|;|:|\s+in\s+TSP|\s+\bcriteria\b)/gi;
  let m; const catHits = {};
  while ((m = rel.exec(head)) !== null) for (const [cat, re] of Object.entries(CATEGORY_WORDS)) if (re.test(m[1])) catHits[cat] = (catHits[cat] || 0) + 1;
  if (Object.keys(catHits).length) { for (const c of Object.keys(catHits)) categories.add(c); catConf = (s1 || s2) ? 'high' : 'medium'; }
  const presentIds = new Set([...text.matchAll(CRITERION_RE)].map(x => normCriterion(x[1])));
  const byPrefix = { availability: /^A1\./, confidentiality: /^C1\./, processing: /^PI1\./, privacy: /^P[1-8]\./ };

  // service organization: "Report on <Name>'s ..." or "<Name>'s description of its ... system"
  let serviceOrganization = '';
  const so = /(?:report\s+on|description\s+of)\s+([A-Z][\w&.,'\- ]{2,60}?)(?:'s|’s)\s+(?:description|system|controls|hosting|platform)/i.exec(head) || /^([A-Z][\w&.,'\- ]{2,60}?)\s*\n[^\n]*SOC\s*2/m.exec(head);
  if (so) serviceOrganization = norm(so[1]);

  // auditor: "<Firm> LLP/LLC/P.C./Inc." near "independent service auditor", else first firm-like name
  let auditor = '';
  const audWin = (/independent\s+service\s+auditor[\s\S]{0,1500}/i.exec(head) || [''])[0] + '\n' + head.slice(0, 1500);
  const firm = /\b((?:[A-Z][\w&'.\-]*\s){1,5}(?:LLP|LLC|L\.L\.P\.|P\.C\.|PLLC|CPAs?|Associates))\b/.exec(audWin.replace(/\b(?:Independent|Service|Auditor'?s?|Report|Prepared|by|The)\b\s*/g, ''));
  if (firm && !new RegExp(firm[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(serviceOrganization)) auditor = norm(firm[1]);
  // system described: "description of its <X> system" / "the <X> System"
  let system = '';
  const sys = /(?:description\s+of\s+(?:its|the)|(?:'s|’s))\s+((?:[A-Z][\w&.'\-/]*\s){1,6})(?:system|platform)\b/i.exec(head);
  if (sys) system = norm(sys[1]).replace(/^(?:Description\s+of\s+)?(?:Its|The)\s+/i, '').replace(/\s+(?:and|of|the)$/i, '');
  // subservice organizations (carve-outs): names within 300 chars of "subservice organization"
  const subservice = new Set();
  for (const m2 of text.matchAll(/[^.]{0,300}subservice\s+organi[sz]ations?[^.]{0,300}/gi)) {
    for (const n of m2[0].matchAll(/\b(Amazon Web Services|AWS|Microsoft Azure|Azure|Google Cloud(?: Platform)?|GCP|Oracle Cloud|IBM Cloud|Cloudflare|Datadog|Okta|Auth0|Salesforce|Snowflake|Databricks|GitHub|GitLab|Atlassian|Twilio|Stripe|Equinix|Digital Realty|Rackspace|Heroku|Vercel|Fastly|Akamai|MongoDB Atlas|Zendesk|Workday|Slack|Zoom)\b/g)) subservice.add(n[1].replace(/^Amazon Web Services$/, 'AWS').replace(/^Microsoft Azure$/, 'Azure').replace(/^Google Cloud Platform$/, 'Google Cloud'));
  }
  const carveOut = /carve[-\s]?out/i.test(text) ? 'carve-out' : /inclusive\s+method/i.test(text) ? 'inclusive' : '';
  // complementary user entity controls: count of CUEC items
  const cuecSec = /complementary\s+user\s+entity\s+controls?[\s\S]{0,6000}/i.exec(text);
  let cuecCount = 0;
  if (cuecSec) { const lines = cuecSec[0].split('\n').slice(1); cuecCount = lines.filter(l => /^\s*(?:[-•▪◦*]|\d{1,2}[.)]|CUEC[-\s]?\d+|[a-z][.)])\s+\S/i.test(l)).length; }
  // locations: "located in <City, ST>" style mentions in the description
  const locations = [...new Set([...text.matchAll(/\b(?:located|headquartered|offices?)\s+in\s+([A-Z][a-zA-Z.\- ]{2,30},\s?(?:[A-Z]{2}|[A-Z][a-z]+))\b/g)].map(x => x[1]))].slice(0, 6);

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
    // only the row's own control (the last token before the result) may resolve through the map
    const lastCtl = ctlTok.length ? ctlTok[ctlTok.length - 1] : '';
    const mapped = lastCtl && ctlMap.has(lastCtl) ? [ctlMap.get(lastCtl)] : [];
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
    // wrapped table cells put newlines inside a sentence, so split on sentence ends only, and stop at the next row's control token
    const fwdFlat = fwd.replace(/\n+/g, ' ');
    const sentences = fwdFlat.split(/(?<=[.!?])\s+(?=[A-Z])/);
    let text = sentences[0] || ''; if (text.length < 40 && sentences[1]) text += ' ' + sentences[1];
    const nextId = fwdFlat.search(CRITERION_RE); if (nextId > 0 && nextId < text.length) text = text.slice(0, nextId);
    const nextCtl = text.slice(1).search(/\s[A-Z]{1,6}-\d{1,3}\b\s+[A-Z]/); if (nextCtl > 20) text = text.slice(0, nextCtl + 1);
    const ctl = ctlTok.length ? ctlTok[ctlTok.length - 1] : '';
    const confidence = !criterion ? 'low' : via === 'map' ? 'high' : stale ? 'low' : dist < 300 ? 'high' : dist < 700 ? 'medium' : 'low';
    text = norm(text).replace(/^(?:exceptions?|deviations?)\s+(?:were\s+)?(?:noted|identified|found|observed)\s*[:.\-–—]?\s*/i, '').replace(/^result\s*:\s*/i, '');
    if (!text) text = 'Exception noted (see report).';
    const candidates = [...new Set([criterion, ...mapped, ...backIds.slice(-4).map(x => x.id), ...fwdIds.slice(0, 2), ...(via === 'text' && ctlMap.size ? [...new Set(ctlMap.values())] : [])].filter(Boolean))].slice(0, 8);
    exceptions.push({ criterion, candidates, via, control: ctl, text: text.slice(0, 400), snippet: norm(back.slice(-160) + ' ' + text).slice(0, 600), confidence, offset: at });
  }
  exceptions.sort((a, b) => a.offset - b.offset);
  // merge duplicates on same criterion + near-identical text
  const merged = [];
  for (const e of exceptions) { const d = merged.find(x => x.criterion === e.criterion && x.text.slice(0, 80) === e.text.slice(0, 80)); if (!d) merged.push(e); }

  // scope fallback: categories whose criteria actually carry test results (not merely mentioned somewhere)
  if (!Object.keys(catHits).length) for (const [cat, re] of Object.entries(byPrefix)) if ([...tested].some(id => re.test(id))) { categories.add(cat); if (catConf === 'low') catConf = 'medium'; }
  const criteriaTested = [...tested].sort();
  if (!cleanCount && !merged.length) notes.push('No test result phrases ("no exceptions noted", "exception noted") were found. This may not be a SOC 2 report, or the PDF text may not be extractable (scanned image).');
  if (merged.some(e => e.confidence !== 'high')) notes.push('Some exceptions could not be tied confidently to a criterion. Check the ones marked medium or low before reading the report.');

  const criteriaInReport = [...presentIds].sort();
  return {
    reportType, period, typeConf, categories: [...categories], catConf, serviceOrganization, auditor, system,
    subservice: [...subservice], carveOut, cuecCount, locations, criteriaInReport, sections: { s1: !!s1, s2: !!s2 },
    exceptions: merged, criteriaTested, cleanCount, notes, pages: pages.length, chars: text.length,
    section4Found: !!s4,
  };
}
