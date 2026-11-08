// Gemma 4 E2B on-device engine. Loads the WebGPU runtime published by the Hugging Face webml community
// (gemma-4-webgpu-kernels) at run time, and Google's Gemma 4 E2B QAT weights through it. Everything
// runs in the tab; the only network traffic is the one-time download of the runtime and weights.
// Gemma is provided under and subject to the Gemma Terms of Use: https://ai.google.dev/gemma/terms
export const RUNTIME_URL = 'https://huggingface.co/spaces/webml-community/gemma-4-webgpu-kernels/resolve/main/gemma-4-e2b.js';
export const MODEL_ID = 'google/gemma-4-E2B-it-qat-mobile-transformers';
export const GEMMA_TERMS = 'https://ai.google.dev/gemma/terms';
export const DOWNLOAD_NOTE = 'About 2 GB, downloaded once from Hugging Face and kept in your browser cache. Needs WebGPU (Chrome or Edge) and a machine with a GPU or 16 GB of memory.';

let gpuOk = null;
export function hasWebGPU() { return gpuOk === true; }
// Ask for an adapter once; 'gpu' in navigator alone is true on machines that cannot run a model.
export async function probeWebGPU() {
  if (gpuOk !== null) return gpuOk;
  try { const a = typeof navigator !== 'undefined' && navigator.gpu ? await navigator.gpu.requestAdapter() : null; gpuOk = !!a; }
  catch { gpuOk = false; }
  return gpuOk;
}

export function createGemmaEngine({ runtimeUrl = RUNTIME_URL, onProgress = () => {} } = {}) {
  let model = null, loading = null;
  async function ready(signal) {
    if (model) return true;
    if (!hasWebGPU()) return false;
    loading ??= (async () => {
      onProgress({ status: 'runtime', message: 'Loading the WebGPU runtime' });
      // Hugging Face serves the file as text/plain, which browsers refuse to import as a module,
      // so fetch it and import from an in-page blob. The bundle has no relative imports of its own.
      const res = await fetch(runtimeUrl, { signal });
      if (!res.ok) throw new Error(`runtime download failed (${res.status})`);
      const blobUrl = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
      let mod; try { mod = await import(/* @vite-ignore */ blobUrl); } finally { URL.revokeObjectURL(blobUrl); }
      const Gemma4Mobile = mod.Gemma4Mobile || mod.default;
      if (!Gemma4Mobile?.load) throw new Error('runtime has no Gemma4Mobile.load');
      model = await Gemma4Mobile.load(MODEL_ID, { signal, onProgress: p => onProgress(p || {}) });
      return true;
    })();
    try { return await loading; } catch (e) { loading = null; throw e; }
  }
  // Pick one of `options` for `question`. Returns the option text, or null.
  async function choose(question, options, { signal } = {}) {
    if (!model) throw new Error('engine not ready');
    const prompt = `${question}\n\nOptions:\n${options.map(o => `- ${o}`).join('\n')}\n\nReply with exactly one option from the list, copied verbatim, and nothing else.`;
    model.reset?.();
    const out = await model.complete([{ role: 'user', content: prompt }], { maxNewTokens: 24, signal });
    const text = String(out || '').replace(/<[^>]+>/g, ' ').trim();
    return options.find(o => text.includes(o)) || options.find(o => text.includes(o.split(' ')[0])) || null;
  }
  function dispose() { try { model?.dispose?.(); } catch { /* fine */ } model = null; loading = null; }
  return { name: 'Gemma 4 E2B', credit: 'Gemma 4 E2B by Google, running on-device via WebGPU kernels by the Hugging Face webml community', ready, choose, dispose };
}
