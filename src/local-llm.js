// Local model hook. The page's AI steps run through one small interface so the engine can be swapped:
//   engine.ready(): Promise<boolean>          // load the model (may download weights once); false if unavailable
//   engine.choose(question, options): Promise<string|null>  // pick one of `options` (strings) or null
//   engine.name, engine.credit                 // shown in the UI when active
// Engines register themselves on window.HeadstartEngines before the app reads them. The Gemma 4 E2B
// WebGPU engine lands here once its runtime's license is confirmed; until then no local engine ships,
// and the scanner's own attribution stands.
export function pickEngine() {
  const list = Array.isArray(globalThis.HeadstartEngines) ? globalThis.HeadstartEngines : [];
  return list.find(e => e && typeof e.ready === 'function' && typeof e.choose === 'function') || null;
}
export function hasWebGPU() { return typeof navigator !== 'undefined' && 'gpu' in navigator; }
// Resolve a low-confidence attribution: ask the engine to choose among the nearby criteria.
export async function attributeWithEngine(engine, exception, candidates, tsc) {
  const options = candidates.filter(c => tsc.criteria[c]);
  if (!options.length) return null;
  const q = `A SOC 2 auditor noted this test result: "${exception.snippet.slice(0, 500)}". Which Trust Services criterion does the tested control support? Answer with one identifier only.`;
  const a = await engine.choose(q, options.map(c => `${c} (${tsc.criteria[c]})`));
  const id = String(a || '').match(/\b(CC\d\.\d|A1\.\d|C1\.\d|PI1\.\d|P\d\.\d)\b/)?.[1];
  return id && options.includes(id) ? id : null;
}
