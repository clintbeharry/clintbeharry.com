/* ---------------------------------------------------------------------------
   Live provider. Runs the model in the visitor's own browser, so any question
   can be asked. Nothing is sent anywhere.

   This is a hand-written decode loop rather than a call to generate(). It has
   to be. generate() will happily produce text, but it does not hand back the
   logits, and the logits ARE the piece: without them there is no field of
   candidates to show. transformers.js 4.3.2 accepts output_scores and then
   silently returns only {sequences, past_key_values}, so the honest numbers
   have to be taken at the source.

   So: one forward pass per word, KV cache threaded through by hand, and at
   every position the full distribution read straight off the model before
   anything is sampled from it. p, rank and surprisal are computed over the
   whole 49,152-token vocabulary, not over a shortlist, which makes them the
   model's own numbers and not the sampler's.

   The shape it returns is byte-for-byte the shape the recorded runs use, so
   the viewer cannot tell a live answer from a captured one.
--------------------------------------------------------------------------- */

const MODEL = "HuggingFaceTB/SmolLM2-360M-Instruct";
const CDN   = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2";

const TOP_K   = 24;    /* candidates kept per step, matching the recorded runs */
const MAX_NEW = 48;
const TEMP    = 0.7;   /* same decode settings as the recorded replies, so the */
const TOP_P   = 0.92;  /* live ones hesitate in the same way */
const NUCLEUS = 256;   /* shortlist for sampling only. 0.92 never reaches this far */

const state = {
  phase: "loading",    /* loading · ready · failed */
  ready: false,
  error: null,
  pct: 0,
  file: "",
  model: null, tok: null, device: null, T: null,
};
window.LIVE = state;

let settle;
/* anything typed before the weights land can await this instead of being
   turned away, which is the whole difference between "not loaded" and "wait" */
state.whenReady = new Promise(r => { settle = r; });

const say = (msg, bad) => window.onLiveStatus && window.onLiveStatus(msg, bad);
const short = MODEL.split("/").pop();

/* ---- small numeric helpers, written for a 49k-wide array ---- */

/* top-k by insertion, so fifty thousand numbers are never sorted */
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

/* the probability of one token under the full distribution */
function softmaxAt(logits, want){
  let max = -Infinity;
  for(let i = 0; i < logits.length; i++) if(logits[i] > max) max = logits[i];
  let sum = 0;
  for(let i = 0; i < logits.length; i++){
    const e = logits[i] - max;
    if(e > -40) sum += Math.exp(e);        /* anything further down is float noise */
  }
  return Math.exp(logits[want] - max) / sum;
}

/* nucleus sampling, at temperature, over a shortlist wide enough that the
   discarded tail could not have been drawn anyway */
function sample(logits){
  const { idx, val } = topK(logits, NUCLEUS);
  const top = val[0] / TEMP;
  const ex = new Float64Array(NUCLEUS);
  let sum = 0;
  for(let i = 0; i < NUCLEUS; i++){ ex[i] = Math.exp(val[i] / TEMP - top); sum += ex[i]; }

  let acc = 0, cut = NUCLEUS;
  for(let i = 0; i < NUCLEUS; i++){
    acc += ex[i] / sum;
    if(acc >= TOP_P){ cut = i + 1; break; }
  }

  let mass = 0;
  for(let i = 0; i < cut; i++) mass += ex[i];
  let r = Math.random() * mass;
  for(let i = 0; i < cut; i++){ r -= ex[i]; if(r <= 0) return idx[i]; }
  return idx[0];
}

/* everything the viewer needs about one position, in the recorded shape */
function measure(logits, chosen, piece, tok){
  const l = logits[chosen];
  const p = softmaxAt(logits, chosen);

  let rank = 1;
  for(let i = 0; i < logits.length; i++) if(logits[i] > l) rank++;

  const { idx, val } = topK(logits, TOP_K);
  const cands = [];
  for(let i = 0; i < TOP_K; i++){
    if(idx[i] < 0) continue;
    const w = tok.decode([idx[i]], { skip_special_tokens: false });
    if(w.includes("�")) continue;     /* half of a UTF-8 character */
    cands.push([w, +val[i].toFixed(4)]);
  }

  return {
    tok: piece,
    p: +p.toFixed(6),
    l: +l.toFixed(4),
    rank,
    bits: +Math.log2(1 / Math.max(p, 1e-9)).toFixed(3),
    cands,
  };
}

/* ---- load ---- */
export async function load(){
  let T;
  try{
    T = await import(/* @vite-ignore */ CDN);
  }catch(e){
    state.phase = "failed";
    state.error = "transformers.js would not load: " + e.message;
    say(state.error, true); settle(false); return false;
  }
  state.T = T;
  T.env.allowLocalModels = false;

  /* report whichever file is currently moving. the weights dominate the wait
     so badly that this is effectively a weights progress bar. */
  const pc = p => {
    if(p.status !== "progress" || !p.total) return;
    state.file = p.file || "weights";
    state.pct  = Math.round(p.loaded / p.total * 100);
    say(`${state.pct}% of ${state.file}`);
  };

  for(const device of ["webgpu", "wasm"]){
    try{
      say(`loading ${short} on ${device}`);
      state.tok   = await T.AutoTokenizer.from_pretrained(MODEL, { progress_callback: pc });
      state.model = await T.AutoModelForCausalLM.from_pretrained(MODEL,
                      { dtype: "q4", device, progress_callback: pc });
      state.device = device;
      state.phase  = "ready";
      state.ready  = true;
      state.pct    = 100;
      say(`${short} · ${device} · running in this tab`);
      settle(true); return true;
    }catch(e){
      state.error = `${device}: ${e.message}`;
    }
  }
  state.phase = "failed";
  say("the model would not load. " + state.error, true);
  settle(false); return false;
}

/* ---- generate ----
   onStep, if given, is called with each position the moment it is known, so
   the page can start animating while the rest is still being computed. */
export async function generate(text, maxNew = MAX_NEW, onStep){
  if(!state.ready) throw new Error("the model is not loaded");
  const { tok, model, T } = state;
  const L   = model.config.num_hidden_layers;
  const EOS = model.config.eos_token_id;

  const i64 = a => new T.Tensor("int64", BigInt64Array.from(a, v => BigInt(v)), [1, a.length]);
  const ones = n => i64(new Array(n).fill(1));

  let prompt;
  try{
    prompt = tok.apply_chat_template([{ role:"user", content:text }],
               { add_generation_prompt:true, tokenize:false });
  }catch{ prompt = text; }

  const enc = await tok(prompt, { add_special_tokens:false });
  const ids = Array.from(enc.input_ids.data, Number);

  /* the prompt goes through in one pass; every word after it costs one pass */
  let feeds = { input_ids: i64(ids), attention_mask: ones(ids.length),
                position_ids: i64(ids.map((_, i) => i)) };
  let pos = ids.length;
  let prev = null;
  const steps = [];

  for(let s = 0; s < maxNew; s++){
    const out = await model.forward(feeds);

    /* the last row of the logits is the only one that predicts anything new */
    const V = out.logits.dims[2], rows = out.logits.dims[1], off = (rows - 1) * V;
    const d = out.logits.data;
    const logits = d.subarray ? d.subarray(off, off + V) : d.slice(off, off + V);

    const chosen = sample(logits);
    const piece  = tok.decode([chosen], { skip_special_tokens:false });
    const stop   = chosen === EOS || (piece.startsWith("<|") && piece.endsWith("|>"));

    if(!stop){
      const step = measure(logits, chosen, piece, tok);
      steps.push(step);
      if(onStep) try{ onStep(step, steps); }catch{}
    }

    /* the previous cache has been read by this pass and can go. on webgpu
       these are real buffers, and 48 steps of them is not free. */
    if(prev) for(const k in prev) try{ prev[k].dispose(); }catch{}
    try{ out.logits.dispose(); }catch{}
    if(stop || s === maxNew - 1){
      for(let i = 0; i < L; i++) try{
        out[`present.${i}.key`].dispose(); out[`present.${i}.value`].dispose();
      }catch{}
      break;
    }

    /* The cache must go in NESTED, under one past_key_values property, not
       spread as past_key_values.0.key and friends at the top level. forward()
       destructures that one property and, finding it absent, helpfully
       substitutes empty tensors over whatever else is there. The model then
       answers from the single token in front of it with no memory of the
       question, and the distribution goes almost flat: the top 24 of 49,152
       hold under 30% of the mass instead of over 94%. It still returns
       fluent-looking words and real-looking numbers, which is what makes the
       mistake worth a comment. */
    const past = {};
    for(let i = 0; i < L; i++){
      past[`past_key_values.${i}.key`]   = out[`present.${i}.key`];
      past[`past_key_values.${i}.value`] = out[`present.${i}.value`];
    }
    prev = past;

    feeds = { input_ids: i64([chosen]), attention_mask: ones(pos + 1),
              position_ids: i64([pos]), past_key_values: past };
    pos++;
  }
  return steps;
}

load();
