/* ---------------------------------------------------------------------------
   Live provider. Runs the model in the visitor's own browser, so any question
   can be asked. Nothing is sent anywhere.

   Published artifacts cannot do this: their sandbox blocks runtime network, so
   the page falls back to the recorded runs in runs.js. On an ordinary host,
   which is what this file is for, the weights load and the page answers
   anything.

   Recovering honest numbers from generate():
   `output_scores` hands back PROCESSED logits, after the sampling warpers have
   run. With temperature as the only warper, processed = raw / T exactly, so
   multiplying by T restores the raw logits and the probabilities we show are
   the model's own, not the sampler's.
--------------------------------------------------------------------------- */

const MODEL = "HuggingFaceTB/SmolLM2-360M-Instruct";
const CDN   = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2";
const TOP_K = 24, MAX_NEW = 48, TEMP = 0.7;

const state = { ready: false, error: null, model: null, tok: null, device: null };
window.LIVE = state;

const say = (msg, bad) => window.onLiveStatus && window.onLiveStatus(msg, bad);

/* top-k without sorting fifty thousand numbers */
function topK(logits, k){
  const idx = new Int32Array(k).fill(-1), val = new Float32Array(k).fill(-Infinity);
  for(let i = 0; i < logits.length; i++){
    const v = logits[i];
    if(v <= val[k-1]) continue;
    let j = k - 1;
    while(j > 0 && val[j-1] < v){ val[j] = val[j-1]; idx[j] = idx[j-1]; j--; }
    val[j] = v; idx[j] = i;
  }
  return { idx, val };
}

function softmaxAt(logits, want){
  let max = -Infinity;
  for(let i = 0; i < logits.length; i++) if(logits[i] > max) max = logits[i];
  let sum = 0;
  for(let i = 0; i < logits.length; i++){
    const e = logits[i] - max;
    if(e > -40) sum += Math.exp(e);          /* anything further down is noise */
  }
  return Math.exp(logits[want] - max) / sum;
}

export async function load(){
  let T;
  try{
    T = await import(/* @vite-ignore */ CDN);
  }catch(e){
    state.error = "library: " + e.message;
    say("could not load transformers.js", true);
    return false;
  }
  T.env.allowLocalModels = false;

  for(const device of ["webgpu", "wasm"]){
    try{
      say(`loading ${MODEL.split("/").pop()} on ${device}`);
      const pc = p => {
        if(p.status === "progress" && p.total)
          say(`${device} · ${(p.loaded / p.total * 100).toFixed(0)}% of ${p.file || "weights"}`);
      };
      state.tok   = await T.AutoTokenizer.from_pretrained(MODEL, { progress_callback: pc });
      state.model = await T.AutoModelForCausalLM.from_pretrained(MODEL,
                      { dtype: "q4", device, progress_callback: pc });
      state.device = device;
      state.ready = true;
      say(`${MODEL.split("/").pop()} · ${device} · running in this tab`);
      return true;
    }catch(e){
      state.error = `${device}: ${e.message}`;
    }
  }
  say("model would not load: " + state.error, true);
  return false;
}

/* returns the same step shape the recorded runs use, so the viewer cannot tell
   the two providers apart */
export async function generate(text, maxNew = MAX_NEW){
  const { tok, model } = state;
  let enc;
  try{
    const prompt = tok.apply_chat_template([{ role:"user", content:text }],
                     { add_generation_prompt:true, tokenize:false });
    enc = await tok(prompt, { add_special_tokens:false });
  }catch{
    enc = await tok(text);
  }

  const out = await model.generate({
    ...enc,
    max_new_tokens: maxNew,
    do_sample: true,
    temperature: TEMP,
    top_k: 0,            /* no shortlisting, so the scores stay a full distribution */
    top_p: 1,
    return_dict_in_generate: true,
    output_scores: true,
  });

  const seqT = out.sequences;
  const seq  = Array.from(seqT.data ?? seqT[0].data).slice(-out.scores.length);
  const steps = [];

  for(let s = 0; s < out.scores.length; s++){
    const sc = out.scores[s];
    const processed = sc.data ?? sc[0].data;
    /* undo the temperature warp to get the model's own logits back */
    const logits = new Float32Array(processed.length);
    for(let i = 0; i < processed.length; i++) logits[i] = processed[i] * TEMP;

    const chosen = Number(seq[s]);
    const piece = tok.decode([chosen], { skip_special_tokens:false });
    if(piece.startsWith("<|") && piece.endsWith("|>")) break;

    const { idx, val } = topK(logits, TOP_K);
    const cands = [];
    for(let i = 0; i < TOP_K; i++){
      if(idx[i] < 0) continue;
      const w = tok.decode([idx[i]], { skip_special_tokens:false });
      if(w.includes("�")) continue;      /* a fragment of a UTF-8 character */
      cands.push([w, +val[i].toFixed(4)]);
    }

    const p = softmaxAt(logits, chosen);
    let rank = 1;
    for(let i = 0; i < logits.length; i++) if(logits[i] > logits[chosen]) rank++;

    steps.push({
      tok: piece,
      p: +p.toFixed(6),
      l: +logits[chosen].toFixed(4),
      rank,
      bits: +Math.log2(1 / Math.max(p, 1e-9)).toFixed(3),
      cands,
    });
  }
  return steps;
}

load();
