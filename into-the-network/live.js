// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Clint Beharry
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

  /* q4 and q4f16 hold the same 4-bit weights. What differs is the embedding
     table, which quantizers leave at full precision because squashing it
     wrecks the output distribution, and which is about half the download at
     this model size. fp16 there costs nothing visible and saves ~115MB.
     q4 stays as the fallback: fp16 support on the wasm path is not a given,
     and a working answer beats a smaller one. */
  for(const [device, dtype] of [["webgpu","q4f16"], ["webgpu","q4"], ["wasm","q4"]]){
    try{
      say(`loading on ${device}`);
      state.tok   = await T.AutoTokenizer.from_pretrained(MODEL, { progress_callback: pc });
      state.model = await T.AutoModelForCausalLM.from_pretrained(MODEL,
                      { dtype, device, progress_callback: pc });
      state.device = device; state.dtype = dtype;
      state.phase  = "ready";
      state.ready  = true;
      state.pct    = 100;
      say(`${device} · sampled t=${TEMP} top_p=${TOP_P} · live in this tab`);
      settle(true); return true;
    }catch(e){
      state.error = `${device}/${dtype}: ${e.message}`;
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

/* Episode one started the download the moment this module was imported,
   because that page could not answer anything without it. This page can: the
   recorded question needs no weights at all. So the load is left to the page,
   which calls it the first time somebody types something, and a visitor who
   only watches never fetches 300MB. */

/* ===========================================================================
   Episode 2 additions.

   The sequence needs two things episode 1 never asked for: a neighbourhood
   around each of the person's words, and those neighbourhoods arranged so
   that direction carries meaning.

   The recorded questions carry a real MDS projection of the embedding matrix.
   That table is ~590KB and is not on this page, so a typed question cannot
   have it. What a typed question CAN have, for free, is this: the prompt goes
   through the model in one pass, and that pass computes a distribution at
   every position, not just the last. Only the last row predicts the reply, so
   generate() reads it and throws the rest away. The rest is the useful part
   here. The row at the end of "heat" is the model saying what it expects to
   follow "heat" in this sentence, which is a neighbourhood by any reasonable
   reading, and every candidate's value in every row is a real measurement.

   So each candidate gets a feature vector: how strongly each of the person's
   words predicts it. Two candidates land near each other when the question
   predicts them alike. Direction is therefore measured, not decorative. It
   just measures something different from the embedding projection, and the
   page says so rather than claiming otherwise.
=========================================================================== */

const ASSOC_SHOW = 13;   /* neighbours kept per word, matching the captures */
const ASSOC_POOL = 64;   /* read this many before discarding non-words */
const ASSOC_WORDS = 12;  /* question words the sequence can seat on its line */
const REPLY_STEPS = 6;   /* words step five animates; the rest is printed */

/* Real words only. The candidate list is full of punctuation, fragments and
   casing variants, none of which say anything as a neighbour. */
const isWord = w => /^[A-Za-z][A-Za-z'-]{1,}$/.test(w);
/* The person's own words are held to a looser rule: "a" and "I" are poor
   neighbours but they are still words somebody typed, and a question that
   arrives on screen as "What is prime number" is just wrong. */
const isTyped = w => /^[A-Za-z][A-Za-z'-]*$/.test(w);

/* Token positions grouped into words. A piece that does not open with a space
   continues the word before it, which is how this tokenizer marks boundaries.
   The position that matters for a word is its LAST token: that is the row that
   predicts what comes after the whole word rather than after its first half. */
/* Grouping tokens by "does this piece start with a space" drops words whose
   pieces do not follow that rule, and "What makes bread rise?" came back as
   three words rather than four. So the span is decoded back into text, each
   token's character range is kept, and the words are found in the TEXT. Every
   word the person typed is then guaranteed a row, whatever the tokenizer did
   to it. The row that matters is the one holding the word's LAST character:
   that is the position predicting what follows the whole word. */
function wordsOf(tok, ids, span){
  const piece = [];
  let text = "";
  for(let i = span.start; i < span.end; i++){
    const s = tok.decode([ids[i]], { skip_special_tokens:false });
    piece.push({ i, a:text.length, b:text.length + s.length });
    text += s;
  }
  const out = [];
  for(const m of text.matchAll(/[A-Za-z][A-Za-z'-]*/g)){
    if(!isTyped(m[0])) continue;
    const end = m.index + m[0].length - 1;
    const p = piece.find(p => end >= p.a && end < p.b);
    if(p) out.push({ w: m[0], at: p.i });
  }
  return out;
}

/* Two components, by power iteration on the covariance. The feature space is
   one dimension per question word, so this is an 8x8 problem at most and the
   exact method does not matter; what matters is that it is deterministic, so
   the same question lands the same way twice. */
function pca2(F){
  const n = F.length, m = F[0].length;
  if(n < 2 || m < 2)
    return F.map((_, i) => [Math.cos(i * 2.39996), Math.sin(i * 2.39996)]);
  const mu = new Float64Array(m);
  for(const r of F) for(let j = 0; j < m; j++) mu[j] += r[j] / n;
  const X = F.map(r => Array.from(r, (v, j) => v - mu[j]));
  const C = Array.from({ length:m }, () => new Float64Array(m));
  for(const r of X) for(let a = 0; a < m; a++) for(let b = 0; b < m; b++) C[a][b] += r[a]*r[b]/n;

  const mul = v => {
    const o = new Float64Array(m);
    for(let a = 0; a < m; a++){ let s = 0; for(let b = 0; b < m; b++) s += C[a][b]*v[b]; o[a] = s; }
    return o;
  };
  const unit = v => { const s = Math.sqrt(v.reduce((a,x)=>a+x*x,0)) || 1; return Array.from(v, x => x/s); };
  const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);

  let e1 = unit(Array.from({ length:m }, (_,i) => Math.sin(i+1)));
  for(let it = 0; it < 80; it++) e1 = unit(mul(e1));
  let e2 = unit(Array.from({ length:m }, (_,i) => Math.cos(i+2)));
  for(let it = 0; it < 80; it++){
    const v = Array.from(mul(e2)), d = dot(v, e1);
    e2 = unit(v.map((x,i) => x - d*e1[i]));      /* held orthogonal to the first */
  }
  return X.map(r => [dot(r, e1), dot(r, e2)]);
}

/* The neighbourhoods, from one forward pass over the prompt. */
export async function associate(text){
  if(!state.ready) throw new Error("the model is not loaded");
  const { tok, model, T } = state;
  const i64 = a => new T.Tensor("int64", BigInt64Array.from(a, v => BigInt(v)), [1, a.length]);

  let prompt;
  try{
    prompt = tok.apply_chat_template(
      [{ role:"system", content:SYSTEM }, { role:"user", content:text }],
      { add_generation_prompt:true, tokenize:false });
  }catch{ prompt = text; }

  const enc = await tok(prompt, { add_special_tokens:false });
  const ids = Array.from(enc.input_ids.data, Number);
  const span = await userSpan(tok, ids);
  let words = wordsOf(tok, ids, span);
  if(!words.length) throw new Error("no words to place");
  const truncated = words.length > ASSOC_WORDS;
  words = words.slice(0, ASSOC_WORDS);

  const out = await model.forward({
    input_ids: i64(ids),
    attention_mask: i64(new Array(ids.length).fill(1)),
    position_ids: i64(ids.map((_, i) => i)),
  });
  const V = out.logits.dims[2], d = out.logits.data;
  const row = i => { const o = i*V; return d.subarray ? d.subarray(o, o+V) : d.slice(o, o+V); };

  /* the candidates each word expects after it */
  const rows = words.map(w => row(w.at));
  const per = rows.map(lg => {
    const { idx, val } = topK(lg, ASSOC_POOL);
    const keep = [];
    for(let i = 0; i < ASSOC_POOL && keep.length < ASSOC_SHOW; i++){
      if(idx[i] < 0) continue;
      const w = tok.decode([idx[i]], { skip_special_tokens:false }).trim();
      if(!isWord(w)) continue;
      if(keep.some(c => c.w.toLowerCase() === w.toLowerCase())) continue;
      keep.push({ id: idx[i], w, l: val[i] });
    }
    return keep;
  });

  /* one feature vector per candidate: its logit in every one of those rows */
  const uni = [...new Set(per.flatMap(p => p.map(c => c.id)))];
  const F = uni.map(id => rows.map(r => r[id]));
  for(const k in out) try{ out[k].dispose(); }catch{}

  const P = pca2(F);
  const at = new Map(uni.map((id, i) => [id, P[i]]));

  /* Angle from the projection, radius from the probability. The engine reads
     relatedness back out of the radius, so the two have to be packed into one
     vector: unit direction scaled by how far down the distribution the word
     sits. Both halves are measured; they measure different things. */
  const q = words.map((w, wi) => {
    const cands = per[wi];
    if(!cands.length) return { w: w.w, assoc: [] };
    const ls = cands.map(c => c.l), mx = Math.max(...ls), mn = Math.min(...ls);
    const cen = [0, 0];
    for(const c of cands){ const v = at.get(c.id); cen[0] += v[0]/cands.length; cen[1] += v[1]/cands.length; }
    return { w: w.w, assoc: cands.map((c, k) => {
      const v = at.get(c.id);
      let dx = v[0]-cen[0], dy = v[1]-cen[1];
      let h = Math.hypot(dx, dy);
      /* a candidate sitting on its own centroid has no direction to give;
         fan those out by rank rather than stacking them on the word */
      if(h < 1e-6){ const a = k*2.39996; dx = Math.cos(a); dy = Math.sin(a); h = 1; }
      const rel = mx === mn ? .5 : (c.l-mn)/(mx-mn);
      const r = .14 + (1-rel)*.78;
      return { w: c.w, xy: [ +(dx/h*r).toFixed(3), +(dy/h*r).toFixed(3) ] };
    })};
  }).filter(x => x.assoc.length);

  return { q, truncated };
}

/* Tokens are not words. "Bread" is two of them, and animating six tokens put
   "B" and "read" on the line as separate words, which reads as a broken page
   rather than as how tokenizers work. Steps are grouped into words first, and
   the sequence animates six WORDS.

   A word's field is its FIRST token's distribution, because that is the
   choice that committed to the word. The alternatives in that field stay as
   the model saw them, which is to say as tokens; only the winner is shown
   whole. */
function words(steps){
  const out = [];
  for(const st of steps){
    const opens = !out.length || /^[\s]/.test(st.tok) || /^[,.;:!?)\]]/.test(st.tok);
    if(opens) out.push([st]); else out[out.length-1].push(st);
  }
  return out.map(g => ({ text: g.map(s => s.tok).join(""), first: g[0] }));
}

export function toReply(steps, n = REPLY_STEPS){
  return words(steps).slice(0, n).map(g => {
    const st = g.first;
    const P = st.cands.map(([w, l]) => ({ w, p: +(st.p * Math.exp(l - st.l)).toFixed(6) }));
    /* The sequence treats cands[0] as the word taken. Sampling means that is
       not always the favourite, so the pick is lifted to the front rather
       than assumed to be there. */
    const i = P.findIndex(c => c.w === st.tok);
    if(i >= 0) P.splice(i, 1);
    P.sort((a, b) => b.p - a.p);
    /* Candidates arrive with the tokenizer's leading space on them. Centred
       in the field that space shifts the word off its own line, and once
       trimmed some of them collide, so the duplicates go too. */
    const whole = g.text.trim() || g.text;
    const seen = new Set([whole.toLowerCase()]);
    const field = [];
    for(const c of P){
      const w = c.w.trim() || c.w, k = w.toLowerCase();
      if(seen.has(k)) continue;
      seen.add(k); field.push({ w, p: c.p });
    }
    return { tok: whole, cands: [{ w: whole, p: st.p }, ...field].slice(0, 13) };
  });
}

/* Words the answer reached for that the question never mentioned. These seat
   the cloud in step three, so an empty list leaves it thin. Taken from the
   answer first, since those are the words it actually used, then from the
   ones it nearly used. */
const STOP = new Set(("a an the is are was were be been being am of to in on at by for with from "
 + "into over under about as it its this that these those there here and or but not no so such "
 + "then than you your yours we our they them their he she his her i me my if when while how why "
 + "what which who whom can could will would shall should may might must do does did done have "
 + "has had get got make makes made very just only also more most other others some any each all "
 + "both much many").split(" "));

export function concepts(steps, qWords, n = 12){
  const asked = new Set(qWords.map(w => w.toLowerCase()));
  const seen = new Set(), out = [];
  const pools = [ (sayWhat(steps).match(/[A-Za-z][A-Za-z'-]*/g) || []),
                  steps.flatMap(s => s.cands.map(c => c[0])) ];
  for(const pool of pools){
    for(const raw of pool){
      const w = raw.trim(), k = w.toLowerCase();
      if(!isWord(w) || STOP.has(k) || asked.has(k) || seen.has(k)) continue;
      seen.add(k); out.push(w);
      if(out.length >= n) return out;
    }
  }
  return out;
}

/* The whole reply, cut back to its last finished sentence. The decode loop
   stops on a sentence end when it can, but a reply that runs into the token
   cap stops wherever it happens to be, and a dangling clause reads as a
   broken page rather than as an answer. */
export function sayWhat(steps){
  const t = steps.map(s => s.tok).join("").trim();
  const m = [...t.matchAll(/[.!?]["')\]]?(?=\s|$)/g)];
  return m.length ? t.slice(0, m[m.length-1].index + m[m.length-1][0].length).trim() : t;
}

export const LIMITS = { REPLY_STEPS, ASSOC_WORDS };
