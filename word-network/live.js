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
const TEMP    = 0.7;   /* same decode settings as the recorded replies, so the */
const TOP_P   = 0.92;  /* live ones hesitate in the same way */
const NUCLEUS = 256;

/* kept identical to the capture script's SYSTEM */
const SYSTEM = "You are a helpful assistant.";   /* shortlist for sampling only. 0.92 never reaches this far */

/* A flat cap cuts the reply wherever the counter runs out, which reads as a
   broken page rather than a finished thought: "divisors: 1 and itself. For
   example". So: let it run to the first sentence it finishes after MIN_NEW,
   and keep MAX_NEW only as a backstop for a model that will not land one.
   The aim is not a longer reply, it is a reply that ends. */
const MIN_NEW = 20;
const MAX_NEW = 88;

/* A sentence end, but not a decimal point or a numbered list marker. Tested
   against the whole reply so far, because the full stop is often its own
   token and arrives separately from the word before it. */
const endsSentence = text =>
  /[.!?]["')\]]?\s*$/.test(text) && !/\d[.]\s*$/.test(text) && !/\b[A-Za-z][.]\s*$/.test(text);

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
      say(`loading on ${device}`);
      state.tok   = await T.AutoTokenizer.from_pretrained(MODEL, { progress_callback: pc });
      state.model = await T.AutoModelForCausalLM.from_pretrained(MODEL,
                      { dtype: "q4", device, progress_callback: pc });
      state.device = device;
      state.phase  = "ready";
      state.ready  = true;
      state.pct    = 100;
      say(`${device} · sampled t=${TEMP} top_p=${TOP_P} · live in this tab`);
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
const MAX_SEEDS = 16;   /* each one costs a pass over prompt+reply */

/* Where the person's own words sit inside the templated prompt. Everything
   else in there is scaffolding the model needs and the reader does not. */
async function userSpan(tok, ids){
  const head = tok.apply_chat_template([{ role:"system", content:SYSTEM }],
                 { add_generation_prompt:false, tokenize:false });
  const headN = (await tok(head, { add_special_tokens:false })).input_ids.data.length;
  const openN = (await tok("<|im_start|>user\n", { add_special_tokens:false }))
                  .input_ids.data.length;
  const endId = Number((await tok("<|im_end|>", { add_special_tokens:false }))
                  .input_ids.data[0]);
  const start = headN + openN;
  let end = start;
  while(end < ids.length && ids[end] !== endId) end++;
  return { start, end };
}

/* How much each of the person's words actually seeded the answer, and which
   words of the answer it is responsible for.

   This is measured, not inferred: take one of their words out, run the real
   reply back through, and see how much less likely the model finds its own
   words without it. Attention weights would be the obvious thing to show, but
   this ONNX graph exports only logits and the cache, and leave-one-out is the
   stronger claim anyway. It is causal. An attention weight is a correlate.

   Scoring the first token alone does not work: the opening word of a reply is
   almost pure syntax, so everything appears to "push toward" A and An. The
   question worth asking is which words of the ANSWER depend on this word. */
async function seedInfluence(model, tok, promptIds, reply, span, fwd, free){
  const seq = promptIds.concat(reply), P = promptIds.length;
  const lp = (d, off, V, id) => {
    let m = -Infinity;
    for(let i = 0; i < V; i++){ const v = d[off+i]; if(v > m) m = v; }
    let S = 0;
    for(let i = 0; i < V; i++){ const z = d[off+i] - m; if(z > -40) S += Math.exp(z); }
    return d[off+id] - m - Math.log(S);
  };

  const o0 = await fwd(seq);
  const V = o0.logits.dims[2], d0 = o0.logits.data;
  const base = reply.map((t, k) => lp(d0, (P - 1 + k) * V, V, t));
  free(o0);

  const last = Math.min(span.end, span.start + MAX_SEEDS);
  const seeds = [];
  for(let j = span.start; j < last; j++){
    const o = await fwd(seq.slice(0, j).concat(seq.slice(j + 1)));
    const d = o.logits.data;
    /* one token shorter, so the same reply word sits one position earlier */
    const drop = reply.map((t, k) => base[k] - lp(d, (P - 2 + k) * V, V, t));
    free(o);
    const order = drop.map((v, k) => [v, k]).sort((a, b) => b[0] - a[0]);
    seeds.push({
      tok: tok.decode([seq[j]], { skip_special_tokens:false }),
      pull: +drop.reduce((a, b) => a + b, 0).toFixed(3),
      /* the answer's words that lean on this one */
      put: order.slice(0, 4).filter(([v]) => v > 0.05).map(([, k]) => reply[k]),
    });
  }
  const top = Math.max(...seeds.map(x => x.pull), 1e-6);
  seeds.forEach(x => { x.share = +(x.pull / top).toFixed(3);
                       x.put = x.put.map(t => tok.decode([t], { skip_special_tokens:false })); });
  return seeds;
}

/* onSeeds fires after the reply exists, since the measurement needs it;
   onStep fires per generated word. */
export async function generate(text, maxNew = MAX_NEW, onStep, onSeeds){
  if(!state.ready) throw new Error("the model is not loaded");
  const { tok, model, T } = state;
  const L   = model.config.num_hidden_layers;
  const EOS = model.config.eos_token_id;

  const i64 = a => new T.Tensor("int64", BigInt64Array.from(a, v => BigInt(v)), [1, a.length]);
  const ones = n => i64(new Array(n).fill(1));

  /* The system message is sent explicitly. Left out, the chat template
     silently inserts the model's own default, which names its maker, and a
     small model that wanders onto a low-confidence branch will reach into
     that line and address it as though it were the person asking. The
     recorded runs are conditioned with this exact string, so a live reply
     and a recorded one start from the same place. */
  let prompt;
  try{
    prompt = tok.apply_chat_template(
      [{ role:"system", content:SYSTEM }, { role:"user", content:text }],
      { add_generation_prompt:true, tokenize:false });
  }catch{ prompt = text; }

  const enc = await tok(prompt, { add_special_tokens:false });
  const ids = Array.from(enc.input_ids.data, Number);
  const span = onSeeds ? await userSpan(tok, ids) : null;

  /* the prompt goes through in one pass; every word after it costs one pass */
  let feeds = { input_ids: i64(ids), attention_mask: ones(ids.length),
                position_ids: i64(ids.map((_, i) => i)) };
  let pos = ids.length;
  let prev = null;
  const steps = [];
  const replyIds = [];   /* the ids as chosen: re-tokenising the text would not round-trip */

  const t0 = performance.now();
  for(let s = 0; s < maxNew; s++){
    const out = await model.forward(feeds);

    /* the last row of the logits is the only one that predicts anything new */
    const V = out.logits.dims[2], rows = out.logits.dims[1], off = (rows - 1) * V;
    const d = out.logits.data;
    const logits = d.subarray ? d.subarray(off, off + V) : d.slice(off, off + V);

    const chosen = sample(logits);
    const piece  = tok.decode([chosen], { skip_special_tokens:false });
    /* the model's own end of turn: it decided it was finished */
    let stop = chosen === EOS || (piece.startsWith("<|") && piece.endsWith("|>"));

    if(!stop){
      const step = measure(logits, chosen, piece, tok);
      steps.push(step); replyIds.push(chosen);
      if(onStep) try{ onStep(step, steps); }catch{}
      /* otherwise, let it finish the sentence it is in and stop there */
      if(steps.length >= MIN_NEW && endsSentence(steps.map(x => x.tok).join("")))
        stop = true;
    }

    /* the previous cache has been read by this pass and can go. on webgpu
       these are real buffers, and ninety steps of them is not free. */
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
  if(onSeeds && span && steps.length){
    const fwd  = x => model.forward({ input_ids:i64(x), attention_mask:ones(x.length),
                                      position_ids:i64(x.map((_, k) => k)) });
    const free = o => { try{ o.logits.dispose(); }catch{}
      for(let i = 0; i < L; i++) try{
        o[`present.${i}.key`].dispose(); o[`present.${i}.value`].dispose();
      }catch{} };
    try{
      const t = performance.now();
      const seeds = await seedInfluence(model, tok, ids, replyIds, span, fwd, free);
      onSeeds(seeds, { ms: Math.round(performance.now() - t), passes: seeds.length + 1 });
    }catch(e){ onSeeds(null, { error: e.message }); }
  }
  return steps;
}

load();
