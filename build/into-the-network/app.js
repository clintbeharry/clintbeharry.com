// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Clint Beharry
/* ---------------------------------------------------------------------------
   The thread.

   One question at a time gets the visualisation: the stage and the question
   bubble are single elements that move into whichever exchange is current,
   because the WebGL context cannot be cloned per turn. Older exchanges keep
   their text, which is what a chat thread shows anyway once the model has
   stopped thinking.
--------------------------------------------------------------------------- */

const SUGGEST = [
  "Why is the sky blue?",
  "What is a prime number?",
  "How does a fridge keep things cold?",
  "What makes bread rise?",
];

const MB = 270;   /* q4f16: 4-bit weights, fp16 embedding table */

const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const RECORDED = (window.SEEDS || []).filter(g => g && g.q && g.reply);
const findSeed = t => RECORDED.find(g => norm(g.prompt) === norm(t));
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));

let token = 0, last = null, LIVE = null, loading = null, okToLoad = false;
const log = $("log"), thread = $("thread");
const scroll = () => { thread.scrollTop = thread.scrollHeight; };
/* Scrolling to the bottom is right while text is arriving, and wrong when a
   400px stage has just appeared: that puts its top above the fold and the
   whole sequence plays out of sight. This brings a turn's top into view. */
function showTurn(t){
  if(!t) return;
  const r = t.getBoundingClientRect(), v = thread.getBoundingClientRect();
  thread.scrollTop += (r.top - v.top) - 14;
}

/* ---- turns ---- */
function turn(role){
  const t = document.createElement("div");
  t.className = "turn " + role;
  if(role === "bot"){
    const w = document.createElement("p");
    w.className = "who";
    const mark = document.createElement("span");
    mark.className = "think";
    mark.innerHTML = "<b></b><b></b><b></b>";
    w.appendChild(mark);
    t.appendChild(w);
    const h = $("hud");
    if(h){ claim(h, w); h.textContent = ""; }
  }
  log.appendChild(t); scroll();
  return t;
}
/* The caption, not the whole line. Setting textContent on .who wiped out the
   thinking mark and the caption element sitting inside it, which is how the
   mark vanished and every later turn found no #hud to write to. */
const who = (t, s) => { const h = t.querySelector("#hud"); if(h) h.textContent = s; };

/* The two single elements, handed from turn to turn. What they leave behind
   is a copy, so scrolling back still shows what was asked. */
function claim(el, host){
  if(el.parentNode && el.parentNode.id !== "park"){
    const still = el.cloneNode(true);
    still.removeAttribute("id");
    if(el.id === "stage") still.remove(); else el.parentNode.insertBefore(still, el);
  }
  host.appendChild(el);
}

function say(t, text, cls){
  const p = document.createElement("p");
  p.className = cls || "answer";
  p.textContent = text;
  t.appendChild(p); scroll();
  return p;
}

/* ---------------------------------------------------------------------------
   The roads not taken.

   For every word of every recorded answer, the next few likeliest words the
   model did NOT use were forced in that word's place offline and the model
   let run from there. One fork deep, which is as far as a file can go: the
   whole tree is the model itself, and that is what the download is for.

   Fetched the first time an answer finishes, not with the page: it is a few
   tens of kilobytes over the wire, and most readers never fork at all.
--------------------------------------------------------------------------- */
const BRANCH = {}, WAITING = {};
window.onBranches = (i, data) => {
  BRANCH[i] = data;
  (WAITING[i] || []).forEach(r => r(data)); delete WAITING[i];
};
function loadBranches(i){
  if(BRANCH[i]) return Promise.resolve(BRANCH[i]);
  return new Promise(resolve => {
    (WAITING[i] = WAITING[i] || []).push(resolve);
    if(WAITING[i].length > 1) return;          /* already on its way */
    const s = document.createElement("script");
    s.src = "branches/b" + i + ".js";
    s.onerror = () => window.onBranches(i, null);
    document.head.appendChild(s);
  });
}

/* ---- the one question the page asks ---- */
function gate(t, text, quiet){
  return new Promise(resolve => {
    const g = document.createElement("div");
    g.className = "gate";
    g.innerHTML =
      "<p>The five questions here are recorded. Anything else runs the model "
      + "itself, in this tab: <b>" + MB + " MB</b>, once, then your browser keeps "
      + "it. Nothing you type leaves the page.</p><div class='row'></div>";
    const row = g.querySelector(".row");
    const go = document.createElement("button");
    go.className = "go"; go.textContent = "Get the model";
    const no = document.createElement("button");
    no.textContent = "Not now";
    row.append(go, no);
    t.appendChild(g); scroll();
    go.onclick = () => { g.remove(); okToLoad = true; setGate(); resolve(true); };
    no.onclick = () => {
      g.remove();
      /* in the sheet the list comes straight back, which says it better than
         a sentence would */
      if(!quiet) say(t, "Left it. The suggested questions below are already "
        + "answered and need no download.");
      resolve(false);
    };
  });
}

/* ---- the model, on first need ---- */
async function provider(onPct){
  if(LIVE) return LIVE;
  window.onLiveStatus = (msg, bad) => { if(!bad && onPct) onPct(msg); };
  if(!loading) loading = (async () => {
    const m = await import("./live.js");
    const ok = await m.load();
    if(!ok) throw new Error((window.LIVE && window.LIVE.error) || "the model would not load");
    LIVE = m; setGate(); return m;
  })();
  return loading;
}

/* ---- ask ---- */
async function ask(text){
  const my = ++token;
  if(window.stopRun) window.stopRun();

  const ut = turn("user");
  claim($("q"), ut);
  $("q").style.opacity = 0;

  const bt = turn("bot");
  bt.classList.add("working");
  who(bt, "thinking");

  const seed = findSeed(text);
  let G = seed;
  const qi = seed ? RECORDED.indexOf(seed) : -1;

  if(!G){
    if(!LIVE && !okToLoad){
      who(bt, "one thing first");
      bt.classList.remove("working");
      const yes = await gate(bt, text);
      if(!yes || my !== token) return;
      bt.classList.add("working");
      who(bt, "thinking");
    }
    const note = say(bt, "Getting the model.", "answer");
    try{
      const m = await provider(msg => { if(my === token) note.textContent = "Getting the model, " + msg + "."; });
      if(my !== token) return;
      note.textContent = "Reading your question.";
      const { q } = await m.associate(text);
      if(my !== token) return;
      const steps = await m.generate(text, undefined, (st, all) => {
        if(my === token) note.textContent = "Writing the answer, " + all.length + " words so far.";
      });
      if(my !== token) return;
      if(!steps.length) throw new Error("the model stopped before saying anything");
      G = { prompt: text, q, emerge: m.concepts(steps, q.map(x => x.w)),
            reply: m.toReply(steps), said: m.sayWhat(steps), live: true };
    }catch(e){
      if(my !== token) return;
      bt.classList.remove("working");
      who(bt, "could not answer");
      const blocked = /dynamically imported|fetch|network/i.test(e.message);
      note.textContent = blocked
        ? "The model's weights could not be fetched from here. The suggested "
          + "questions below are already answered and need no download."
        : e.message + ".";
      return;
    }
    note.remove();
  }

  if(my !== token) return;
  last = G;
  const st = $("stage");
  st.style.height = ""; st.style.opacity = "";
  claim(st, bt);
  /* twice: once now, and once after layout has taken the stage's height */
  showTurn(bt);
  requestAnimationFrame(() => showTurn(bt));
  bt.classList.remove("working");
  who(bt, "");
  answering = bt;
  const at = await window.playRun(G);
  if(my !== token) return;
  await collapse($("stage"));
  if(my !== token) return;
  await writeReply(bt, G, my, at, qi);
  if(my !== token) return;
  /* the controls belong under the finished message, the way a chat puts copy
     and retry there, not above an answer that has not been written yet */
  bt.classList.add("spoken");       /* the caption has nothing left to report */
  actions(bt);
  inspector(bt.querySelector(".reply"));
  if(qi >= 0) loadBranches(qi);
  scroll();
}

/* The engine says when the cursor exists. From that moment the page is
   answering, not working out what to answer. */
let answering = null;
window.onCursor = () => { if(answering) answering.classList.add("answering"); };

/* The sequence folded the whole network into a blinking cursor. The cursor
   is what writes, so the stage closes rather than sitting there as a spent
   frame, and the reply picks up in the thread. */
function collapse(stage){
  return new Promise(r => {
    const h = stage.offsetHeight;
    stage.style.height = h + "px";
    void stage.offsetHeight;                 /* let the start height stick */
    requestAnimationFrame(() => {
      stage.style.height = "0px";
      stage.style.opacity = "0";
    });
    setTimeout(() => { stage.style.height = ""; stage.style.opacity = "";
                       stage.remove(); $("park").appendChild(stage); r(); }, 640);
  });
}

const FAN_N = 6;        /* candidates shown per word */
/* The field opens to the RIGHT of the word, where a line of text has room,
   and settles underneath only once the word has been taken. Opening
   downwards meant the band had to be as deep as the field was tall, and the
   collapse into finished prose was a long way to fall. */
/* A fan, not a list. Stepping each candidate the same distance right and the
   same distance down drew six parallel lines at one angle, which is an angled
   list wearing a fan's clothes. They now sit on an arc that opens above and
   below the word, at reaches that differ per candidate, so the lines leave at
   real angles and real lengths. */
/* Direction and distance are two channels, and both were carrying rank, so
   the fan came out a ladder: shortest at the top, longest at the bottom,
   every word the same shape. They now carry different things.

   DISTANCE still carries probability, as surprisal, so a word the model was
   almost certain of sits right against the line and a long shot is flung out.
   Rank is mixed in at 45% only to keep neighbours from landing on top of each
   other when five candidates share nearly the same tiny probability.

   DIRECTION carries what KIND of word it is, which is real and has nothing to
   do with how likely it was. Punctuation leaves upward, word-pieces next,
   then ordinary words, then capitals downward. So the alternatives sort
   themselves by what they would have DONE to the sentence, and the same kind
   of word always leaves the same way, across the whole reply.

   SPREAD carries certainty: the arc is narrow where the model knew what came
   next and swings wide open where it did not. That is the reading available at
   a glance, before any single word is looked at. */
const FAN_SPAN0 = 76, FAN_SPAN1 = 116;  /* degrees of arc: certain, uncertain */
const FAN_MINY = 15;                    /* px, two rows may never sit closer */
const FAN_TILT  = -6;                   /* the arc's centre line, just below level */
const FAN_R0 = 44, FAN_R1 = 122;        /* and how far out each reaches */
/* cl() is the engine's clamp, declared above in the built page */
/* 0 up through 3 down. A candidate that is punctuation would have closed the
   clause; one or two characters is the model starting to spell a different
   word; a capital would have begun something new. */
const stem = (a, b) => {
  let n = 0;
  while(n < a.length && n < b.length && a[n].toLowerCase() === b[n].toLowerCase()) n++;
  return n;
};
const kindOf = w => /^[^0-9A-Za-z]/.test(w) ? 0
                  : w.length <= 2          ? 1
                  : /^[A-Z]/.test(w)       ? 3
                  :                          2;
/* a stable wobble per word, so the arc is never mechanically even and the
   same word always sits the same way */
const wobble = w => {
  let h = 2166136261;
  for(let i = 0; i < w.length; i++){ h ^= w.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000 - .5;
};
const REST_GAP = 4, REST_ROW = 11;   /* these two match --gap and --row */
const MAX_CH = 13;      /* a long one is clipped so it cannot shove the line apart */
const pause = ms => new Promise(r => setTimeout(r, ms));
const share = p => p >= .995 ? (Math.floor(p * 1000) / 10).toFixed(1) + "%"
               : p >= .1   ? (p * 100).toFixed(0) + "%"
               : p >= .001 ? (p * 100).toFixed(1) + "%"
               : p >= .00005 ? (p * 100).toFixed(2) + "%" : "<0.01%";
const bitsOf = p => Math.log2(1 / Math.max(p, 1e-9));
const el = (t, c) => { const e = document.createElement(t); if(c) e.className = c; return e; };

/* One word: the field it was chosen from, and the word rising out of it. */
function buildTok(step){
  const tok = el("span", "tok");
  const word = el("span", "word");
  word.textContent = step.tok;
  tok.appendChild(word);

  /* Rank order, by share, every time. The recording puts the word that was
     taken first and the rest behind it, and the decoding was not greedy, so
     in about one step in six the word taken is NOT the likeliest one and the
     list was opening with a 0.8% word above an 8.8% one. Which row was taken
     is a question of identity, not of position: the list is sorted and the
     highlight moves down it. */
  const ranked = step.cands.slice().sort((a, b) => b.p - a.p);
  const field = ranked.slice(0, FAN_N);
  let wi = field.findIndex(c => c.w === step.tok);
  if(wi < 0){
    /* Taken from further down than the field reaches. Rather than quietly
       dropping a row to make space, it is added below the others, so a word
       the model reached a long way for is visibly a long way down. */
    const taken = ranked.find(c => c.w === step.tok);
    if(taken){ field.push(taken); wi = field.length - 1; }
    else wi = 0;
  }
  const far = wi >= FAN_N;
  const clip = w => w.length > MAX_CH ? w.slice(0, MAX_CH - 1) + "\u2026" : w;
  /* the line spaces itself so every field has somewhere to sit, plus a little
     over, because words butted together read as one word */
  const widest = Math.max(step.tok.length, ...field.map(c => clip(c.w).length));
  tok.style.setProperty("--pad",
    (0.45 + (widest - step.tok.length) / 2).toFixed(2) + "ch");

  /* how wide the whole arc opens: how surprised the model was by its own
     first choice, which is the plainest certainty figure the piece has */
  const span = FAN_SPAN0 + (FAN_SPAN1 - FAN_SPAN0)
                         * cl(bitsOf(field[0].p) / 3.2);

  /* Where each one leaves. Kind pulls it toward its own quarter of the arc,
     and an even share of the arc keeps it off its neighbours: kind alone put
     four capitals on the same ray, stacked at nearly equal reach, which is a
     collision rather than a grouping. Order is by kind, so the quarters still
     read top to bottom even when the even share dominates. */
  const rank = i => {
    const w = field[i].w;
    /* a candidate sharing a stem with the word taken is a near miss, a
       different ending on the same thought, so it sits next to it; a word
       that shares nothing is a real fork and swings away. After that, by how
       long the word is, which is the one thing left that is a property of the
       candidate rather than of its odds. */
    return kindOf(w) * 100 + (stem(w, step.tok) >= 3 ? 0 : 40)
         + Math.min(w.length, 14) * 2;
  };
  const order = field.map((c, i) => i).sort((a, b) => rank(a) - rank(b) || a - b);
  const place = field.map((c, i) => {
    const slot  = field.length > 1 ? order.indexOf(i) / (field.length - 1) : .5;
    const u     = .68 * slot + .32 * (kindOf(c.w) + .5) / 4;
    const f     = field.length > 1 ? i / (field.length - 1) : 0;
    return {
      a: FAN_TILT + span * (.5 - u) + wobble(c.w) * span * .11,
      R: FAN_R0 + (FAN_R1 - FAN_R0)
                * (.55 * cl(bitsOf(c.p) / 8) + .45 * f) + wobble(c.w) * 16
    };
  });
  /* and a last pass so nothing overlaps: reaches differ, but two rows on
     nearly the same ray still land on top of each other. Push the pair apart
     in the only direction that matters for reading, and keep the reach. */
  const ys = place.map((q, i) => ({ i, y: -Math.sin(q.a * Math.PI / 180) * q.R }))
                  .sort((m, n) => m.y - n.y);
  for(let i = 1; i < ys.length; i++){
    const d = ys[i].y - ys[i - 1].y;
    if(d < FAN_MINY){ ys[i].y += FAN_MINY - d; }
  }
  ys.forEach(({ i, y }) => {
    const q = place[i];
    q.a = -Math.asin(cl(y / q.R, -.94, .94)) * 180 / Math.PI;
  });

  const fan = el("span", "fan");
  field.forEach((c, i) => {
    const row = el("i");
    row.appendChild(document.createTextNode(clip(c.w)));
    const sh = el("s"); sh.textContent = share(c.p); row.appendChild(sh);
    /* opacity still carries probability, but off a higher floor: the long
       shots were landing near invisible, and a candidate worth nothing is
       still worth seeing */
    row.style.setProperty("--o", (.24 + Math.sqrt(c.p) * .66).toFixed(3));
    const a = place[i].a * Math.PI / 180, R = place[i].R;
    row.style.setProperty("--cx", "0%");       /* reach out to the right */
    row.style.setProperty("--x", (Math.cos(a) * R).toFixed(1) + "px");
    row.style.setProperty("--y", (-Math.sin(a) * R).toFixed(1) + "px");
    if(i === wi) row.classList.add("win");
    if(far && i === wi) row.classList.add("far");
    fan.appendChild(row);
  });
  tok.appendChild(fan);
  return { tok, fan, word, wi, field, took:field[wi] };
}

/* One line from the word to each thing it might have been. Drawn after the
   token is in the document, because where the rows land depends on how wide
   their own text is, and that is only known once laid out. */
const NS = "http://www.w3.org/2000/svg";
function wires(tok, fan, field, wi){
  const tb = tok.getBoundingClientRect();
  const rows = [...fan.children];
  if(!rows.length || !tb.width) return null;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "wires");
  const ox = tb.width / 2, oy = tb.height;      /* the word's bottom centre */
  let deepest = 0;
  rows.forEach((row, i) => {
    const rb = row.getBoundingClientRect();
    const x = rb.left - tb.left, y = rb.top - tb.top + rb.height / 2;
    deepest = Math.max(deepest, y);
    const ln = document.createElementNS(NS, "line");
    ln.setAttribute("x1", ox.toFixed(1)); ln.setAttribute("y1", oy.toFixed(1));
    ln.setAttribute("x2", (x - 3).toFixed(1)); ln.setAttribute("y2", y.toFixed(1));
    const p = field[i] ? field[i].p : 0;
    ln.setAttribute("stroke", i === wi ? "#d97757" : "#8a8a8a");
    /* the likelier the candidate, the heavier the line to it */
    ln.setAttribute("stroke-width", (0.5 + Math.sqrt(p) * 2.1).toFixed(2));
    ln.setAttribute("stroke-opacity", (0.2 + Math.sqrt(p) * 0.68).toFixed(2));
    svg.appendChild(ln);
  });
  svg.setAttribute("width", Math.max(1, tb.width));
  svg.setAttribute("height", Math.max(1, deepest + 4));
  tok.appendChild(svg);
  return svg;
}

/* The reply, written into the thread a word at a time. Pace carries meaning:
   a word the model was sure of barely pauses, an uncertain one holds long
   enough that its field can be read. */
async function writeReply(bot, G, my, at, qi){
  const p = el("p", "reply");
  const caret = el("span", "caret");
  p.appendChild(caret);
  p.__q = qi; p.__base = G.reply; p.__forks = [];
  bot.appendChild(p);
  scroll();
  await writeWords(p, caret, G.reply, my, 1);
  caret.remove();
  p.classList.add("done");
  scroll();
}

/* The words themselves, one at a time, into whatever paragraph and from
   wherever the caret is. Written once for the first answer and again for
   every branch taken out of it, because a branch has to arrive the same way
   the answer did: watching the new path being chosen is the whole argument,
   and a tail that merely appeared would make the choice look like a result
   rather than a decision. `rate` runs the second pass quicker, since by then
   nobody is learning how this works, they are following a fork. */
async function writeWords(p, caret, steps, my, rate){
  for(const step of steps){
    if(my !== token) return;
    const { tok, fan, wi, took, field } = buildTok(step);
    /* A real space between words, not just the padding that holds a field
       open. Padding alone spaces the line while it is being written and then
       has nothing to relax to, so the finished answer keeps animation gaps
       and its punctuation floats off on its own. */
    if(p.querySelector(".tok") && !/^[,.;:!?)\]'’]/.test(step.tok))
      p.insertBefore(document.createTextNode(" "), caret);
    p.insertBefore(tok, caret);
    /* into the word while its field is open, so the cursor sits at the point
       all the lines to the candidates start from */
    tok.appendChild(caret);
    scroll();

    const w = wires(tok, fan, field, wi);
    fan.classList.add("in");
    if(w) w.classList.add("in");
    await pause(80 * rate);
    if(my !== token) return;
    await pause(Math.min(680, Math.max(70, bitsOf(took.p) * 155)) * rate);
    if(my !== token) return;

    /* the one taken travels up and left onto the line; the rest slide left
       and down into the trace they leave behind, keeping their rank order so
       the trace reads the same way the panel will */
    const rows = [...fan.children];
    const win = rows[wi];
    rows.forEach((row, i) => {
      row.style.setProperty("--cx", "-50%");
      row.style.setProperty("--x", "0px");
      row.style.setProperty("--y", (REST_GAP + i * REST_ROW) + "px");
    });
    win.style.setProperty("--y", (-(tok.offsetHeight - 2)) + "px");
    /* the lines go when the words they point at go, or the moment between
       the field fading and the row settling is a spray of naked lines */
    if(w) w.classList.remove("in");
    fan.classList.add("out");

    /* the share it was taken at, rising away: a few of them are in the air
       at once, so the line reads as a run of decisions rather than one */
    const lift = el("span", "lift");
    lift.textContent = share(took.p);
    tok.appendChild(lift);
    requestAnimationFrame(() => lift.classList.add("go"));
    setTimeout(() => lift.remove(), 2700);

    await pause(300 * rate);
    if(my !== token) return;
    tok.classList.add("set");
    p.appendChild(caret);          /* and back to the end of the line */
    await pause(40);
    fan.classList.remove("in", "out");
    fan.classList.add("rest");
    rows.forEach((c, i) => { if(i !== wi && i < 4) c.classList.add("keep"); });
    win.style.setProperty("--x", "0px");
    win.style.setProperty("--y", (REST_GAP + wi * REST_ROW) + "px");
  }
}

/* ---------------------------------------------------------------------------
   The finished answer, reopened.

   Every word still carries the field it was chosen from. Once the sentence
   has settled they are out of the way, but they are the whole point, so
   moving a pointer or dragging a finger along the line swells the words back
   open around wherever you are: full at the word itself, less either side,
   gone two words out. The line opens its band once so the fields have
   somewhere to be, and the bulge travels along inside it.
--------------------------------------------------------------------------- */
function inspector(p){
  if(!p) return;
  /* Called again after every fork, and the paragraph is the same paragraph:
     attaching a second set of listeners to it would leave the first set
     holding a list of words that no longer exists. The word list is what
     gets replaced, not the wiring. */
  if(p.__ins){ p.__ins(); return; }
  let toks = [...p.querySelectorAll(".tok")];
  if(!toks.length) return;
  p.classList.add("ready");

  /* Offsets inside the paragraph, not viewport coordinates, so scrolling
     never invalidates them. Nothing in the finished text moves any more, so
     one measurement holds for the life of the paragraph. */
  let boxes = null;
  const measure = () => {
    const pr = p.getBoundingClientRect();
    boxes = toks.map(t => {
      const r = t.getBoundingClientRect();
      return { x:(r.left + r.right) / 2 - pr.left,
               y:(r.top + r.bottom) / 2 - pr.top,
               w:r.width, h:r.height };
    });
  };

  /* the bulge: full size under the pointer, falling away over two words
     either side, so the eye is led along the sentence rather than snapped to
     one word */
  const LENS = [1, .5, .22];
  const GROW = .13;
  /* and the way the displacement is handed back. Each word is pushed out by
     half its own growth plus all the growth between it and the focus, which
     is what keeps the gaps even; that total would otherwise shift the whole
     rest of the line sideways, and a word that has drifted is a word you
     aim at and miss. So it is walked back to nothing over the next three,
     compressing three gaps by a pixel or two each, which nobody sees. */
  const TAIL = [.6, .28, .1];

  let at = -1, pinned = -1;
  const apply = idx => {
    if(idx === at) return;
    at = idx;
    if(!boxes) measure();
    const grow = i => {
      const d = Math.abs(i - idx);
      return d > 2 ? 0 : boxes[i].w * GROW * LENS[d];
    };
    /* how far word i has to move to give the growth between it and the focus
       somewhere to go */
    const shove = i => {
      if(idx < 0 || i === idx) return 0;
      const dir = i < idx ? -1 : 1;
      let sum = grow(idx) / 2;
      for(let j = Math.min(i, idx) + 1; j < Math.max(i, idx); j++) sum += grow(j);
      const d = Math.abs(i - idx);
      if(d <= 2) return dir * (sum + grow(i) / 2);
      return dir * sum * (TAIL[d - 3] || 0);
    };
    toks.forEach((t, i) => {
      const d = idx < 0 ? 99 : Math.abs(i - idx);
      const lens = d > 2 ? 0 : LENS[d];
      t.style.setProperty("--lens", lens);
      t.style.setProperty("--push", shove(i).toFixed(2) + "px");
      t.style.setProperty("--hide", idx < 0 ? 0 : (.66 * (1 - lens)).toFixed(3));
      /* only one field at a time. Five overlapping fields were unreadable,
         and reading one is the whole point of stopping on a word. */
      t.style.setProperty("--mag", d === 0 ? 1 : 0);
      t.classList.toggle("at", d === 0);
      if(d !== 0) t.classList.remove("up");
    });
    p.classList.toggle("inspect", idx >= 0);
    if(idx >= 0) place(toks[idx]);
  };

  /* The panel hangs under its word, unless that would put it off the bottom
     of the thread, and it is centred on the word, unless that would put it
     past the edge of the column. Both are read from the laid-out panel rather
     than guessed from the word's position, because how big it is depends on
     how long the words inside it are. */
  const place = t => {
    const fan = t.querySelector(".fan");
    if(!fan) return;
    fan.style.setProperty("--nudge", "0px");
    t.classList.remove("up");
    requestAnimationFrame(() => {
      if(!t.classList.contains("at")) return;
      const view = document.getElementById("thread").getBoundingClientRect();
      let r = fan.getBoundingClientRect();
      if(r.bottom > view.bottom - 10 && r.height < t.getBoundingClientRect().top - view.top)
        t.classList.add("up");
      r = fan.getBoundingClientRect();
      const over = Math.max(0, r.right - (view.right - 12))
                 - Math.max(0, (view.left + 12) - r.left);
      if(over) fan.style.setProperty("--nudge", (-over).toFixed(1) + "px");
    });
  };

  /* Which word the pointer is on. A word owns the full height of its line and
     the gap to its neighbours, so there is nowhere along a line that answers
     with nothing: sliding never flickers through a dead spot. */
  const hit = (cx, cy) => {
    if(!boxes) measure();
    const pr = p.getBoundingClientRect();
    const x = cx - pr.left, y = cy - pr.top;
    if(x < -40 || y < -30 || x > pr.width + 40 || y > pr.height + 30) return -1;
    let best = -1, bd = Infinity;
    boxes.forEach((b, i) => {
      const dy = Math.abs(b.y - y);
      if(dy > b.h * .85) return;                       /* a different line */
      const dx = Math.max(0, Math.abs(b.x - x) - b.w / 2);
      const d = dx + dy * .25;
      if(d < bd){ bd = d; best = i; }
    });
    return bd < 90 ? best : -1;
  };

  /* Hovering follows the pointer. A click holds a word still so its field can
     actually be read, because a field that vanishes the moment you look away
     from the word cannot be read at all. Clicking it again lets go. */
  /* The panel hangs over whatever is below the word, so a pointer moving down
     into it to read it would otherwise land on the words behind and take the
     panel away mid-sentence. Inside its own panel, nothing changes. */
  const inPanel = () => {
    if(at < 0) return null;
    const f = toks[at].querySelector(".fan");
    return f ? f.getBoundingClientRect() : null;
  };
  const onPanel = (x, y) => {
    const r = inPanel();
    return !!r && x >= r.left - 6 && x <= r.right + 6
               && y >= r.top - 4 && y <= r.bottom + 6;
  };
  const hover = (x, y) => {
    if(onPanel(x, y)) return;
    /* Holding a word open does not freeze the paragraph: the pointer goes on
       working, and off every other word it falls back to the one being held.
       Only one is ever open, so a second click moves the hold rather than
       adding to it. */
    const i = hit(x, y);
    apply(i < 0 ? pinned : i);
  };
  const pin = (x, y) => {
    const i = hit(x, y);
    pinned = (i < 0 || i === pinned) ? -1 : i;
    apply(pinned < 0 ? i : pinned);
  };

  p.addEventListener("pointermove", e => {
    if(e.pointerType !== "touch") hover(e.clientX, e.clientY);
  });
  p.addEventListener("pointerleave", () => apply(pinned));
  p.addEventListener("click", e => pin(e.clientX, e.clientY));

  /* On a finger there is no hover, so the drag IS the gesture: the bulge
     tracks the finger, and where it is lifted is where it stays. */
  let slid = false;
  /* A finger landing in the open panel is reaching for a row in it, not for
     whatever word the panel happens to be lying on top of. Without this the
     touch picked the word behind, the panel moved out from under the finger,
     and the tap arrived nowhere: on a phone the panel was unusable. */
  p.addEventListener("touchstart", e => {
    const t = e.touches[0]; if(!t) return;
    if(onPanel(t.clientX, t.clientY)) return;
    slid = false; pinned = -1; measure(); apply(hit(t.clientX, t.clientY));
  }, { passive:true });
  p.addEventListener("touchmove", e => {
    const t = e.touches[0]; if(!t) return;
    if(onPanel(t.clientX, t.clientY)) return;
    slid = true; apply(hit(t.clientX, t.clientY));
  }, { passive:true });
  p.addEventListener("touchend", () => { pinned = at; }, { passive:true });

  /* letting go of it: anywhere else, or escape */
  addEventListener("pointerdown", e => {
    if(pinned >= 0 && !p.contains(e.target)){ pinned = -1; apply(-1); }
  }, true);
  addEventListener("keydown", e => {
    if(e.key === "Escape" && at >= 0){ pinned = -1; apply(-1); }
  });
  addEventListener("resize", () => { boxes = null; });

  /* ---- the roads not taken, from inside the panel ----
     A row is a branch. Hovering one dims everything the sentence said after
     that word and lays the other sentence out underneath it, so both paths
     are there at once and neither has to be remembered. Taking one rewrites
     the tail. Letting go puts it back, because a tree you have to tidy up
     after is not one anybody explores. */
  const rowsOf = t => [...t.querySelectorAll(".fan i")];
  let ghost = null;
  const clearGhost = () => {
    p.classList.remove("ghosting");
    toks.forEach(t => t.classList.remove("doomed"));
    if(ghost){ ghost.remove(); ghost = null; }
  };
  const showGhost = (k, row) => {
    clearGhost();
    p.classList.add("ghosting");
    toks.forEach((t, i) => { if(i >= k) t.classList.add("doomed"); });
    ghost = el("p", "ghost");
    /* enough of the run-up to hear the sentence turn, not the whole thing
       again: the paragraph it belongs to is directly above it */
    const lead = toks.slice(Math.max(0, k - 5), k)
      .map(t => t.querySelector(".word").textContent)
      .join(" ").replace(/ ([,.;:!?)\]'’])/g, "$1");
    const was = el("span", "was");
    was.textContent = (k > 5 ? "… " : "") + lead;
    if(k) ghost.appendChild(was);
    row.reply.forEach((w, i) => {
      const sp = el("span", i === 0 ? "turn" : "");
      sp.textContent = ((i || k) && !/^[,.;:!?)\]'’]/.test(w.tok) ? " " : "") + w.tok;
      ghost.appendChild(sp);
    });
    p.appendChild(ghost);
    /* clear of the panel, which is hanging over the paragraph at this moment
       and would otherwise be sitting on top of the thing it opened */
    requestAnimationFrame(() => {
      if(!ghost) return;
      const fan = toks[k] && toks[k].querySelector(".fan");
      const pr = p.getBoundingClientRect();
      const fr = fan && fan.getBoundingClientRect();
      const drop = fr && fr.height ? Math.max(10, fr.bottom - pr.bottom + 14) : 10;
      ghost.style.marginTop = drop.toFixed(0) + "px";
      ghost.classList.add("in");
    });
  };

  /* Which branch a row is, if there is one. A row is takeable when the file
     has a continuation recorded for it: the word taken has none, because it
     is the path you are already on, and neither has anything inside a branch,
     which is where the recording stops and the model would have to start. */
  const branchAt = (k, row) => {
    const d = BRANCH[p.__q];
    if(!d || p.__forks.length) return null;
    const rows = d.at[String(k)];
    if(!rows) return null;
    const w = row.firstChild.nodeValue.trim();
    return rows.find(r => r.w === w) || null;
  };
  const origAt = k => {
    const b = p.__base;
    return b && b[k] ? b[k].tok : null;
  };

  p.addEventListener("pointerover", e => {
    const row = e.target.closest(".fan i");
    if(!row || at < 0) return;
    const k = at, br = branchAt(k, row);
    if(br) showGhost(k, br);
    else clearGhost();
  });
  p.addEventListener("pointerout", e => {
    if(e.relatedTarget && p.contains(e.relatedTarget) &&
       e.relatedTarget.closest(".fan")) return;
    clearGhost();
  });
  p.addEventListener("click", e => {
    const row = e.target.closest(".fan i");
    if(!row || at < 0) return;
    e.stopPropagation();
    const k = at, br = branchAt(k, row);
    if(br){ clearGhost(); takeFork(p, k, br); return; }
    const back = row.firstChild.nodeValue.trim();
    if(p.__forks.length && back === origAt(k)) { clearGhost(); unFork(p, k); }
  }, true);

  /* every row the file can actually follow says so, quietly */
  const mark = () => {
    const d = BRANCH[p.__q];
    if(!d) return;
    toks.forEach((t, k) => {
      const can = !p.__forks.length && d.at[String(k)];
      rowsOf(t).forEach(r => {
        const w = r.firstChild.nodeValue.trim();
        r.classList.toggle("go", !!(can && can.some(x => x.w === w)));
        r.classList.toggle("back", !!(p.__forks.length && w === origAt(k)));
      });
    });
  };
  /* what a fork hands back: the new words, nothing measured, nothing lit */
  p.__ins = () => {
    toks = [...p.querySelectorAll(".tok")];
    /* the words that survived a fork still carry whatever the lens last left
       on them, and a paragraph half dimmed by a pointer that has gone is not
       a paragraph anybody asked for */
    toks.forEach(t => {
      t.style.removeProperty("--lens");
      t.style.removeProperty("--hide");
      t.style.removeProperty("--push");
      t.classList.remove("at", "up", "doomed");
    });
    boxes = null; at = -1; pinned = -1;
    p.classList.remove("inspect");
    p.classList.add("ready");
    clearGhost(); mark();
  };
  if(BRANCH[p.__q]) mark(); else loadBranches(p.__q).then(mark);
}

/* Take the fork: everything the sentence said after that word goes, and the
   other one writes itself in its place at twice the speed. The words before
   the fork are untouched, so the paragraph above it does not move. */
/* Everything from this word on, and the space that was holding it apart from
   the one before, which the rewrite puts back itself. */
function cutAfter(p, from){
  while(p.lastChild && p.lastChild !== from) p.lastChild.remove();
  from.remove();
  while(p.lastChild && p.lastChild.nodeType === 3 && !p.lastChild.nodeValue.trim())
    p.lastChild.remove();
}

async function takeFork(p, k, br){
  const my = token;
  const toks = [...p.querySelectorAll(".tok")];
  const from = toks[k];
  if(!from) return;
  p.classList.remove("inspect", "ready");
  cutAfter(p, from);
  p.__forks = [{ at:k, w:br.w }];
  const caret = el("span", "caret");
  p.appendChild(caret);
  p.classList.remove("done");
  await writeWords(p, caret, br.reply, my, .55);
  if(my !== token) return;
  caret.remove();
  p.classList.add("done");
  [...p.querySelectorAll(".tok")].forEach((t, i) => {
    t.classList.toggle("mine", i >= k);
    t.style.setProperty("--depth", p.__forks.length - 1);
  });
  inspector(p);
  scroll();
}

/* And back. The model's own word is still a row in that word's field, so
   going back is the same gesture as going: no second idea to learn. */
async function unFork(p, k){
  const my = token;
  const rest = p.__base.slice(k);
  const toks = [...p.querySelectorAll(".tok")];
  const from = toks[k];
  if(!from || !rest.length) return;
  p.classList.remove("inspect", "ready");
  cutAfter(p, from);
  p.__forks = [];
  const caret = el("span", "caret");
  p.appendChild(caret);
  p.classList.remove("done");
  await writeWords(p, caret, rest, my, .45);
  if(my !== token) return;
  caret.remove();
  p.classList.add("done");
  [...p.querySelectorAll(".tok")].forEach(t => t.classList.remove("mine"));
  inspector(p);
  scroll();
}

function actions(t){
  if(t.querySelector(".acts")) return;
  const a = document.createElement("div");
  a.className = "acts";
  const mk = (key, label) => {
    const b = document.createElement("button");
    b.dataset.a = key; b.textContent = label;
    a.appendChild(b); return b;
  };
  /* Pause steered the sequence, which by now has finished and gone. Replay
     is the only thing left that means anything here. */
  mk("replay", "Replay").onclick = () => { if(last) ask(last.prompt); };
  t.appendChild(a);
}

/* ---- composer ----
   The sheet is the same panel the words open into, and reads the same way:
   a choice on the left, what it costs on the right. The recorded questions
   cost nothing, so they say nothing; the one that costs a download says so
   in the only unit that matters. */
function chips(){
  const all = RECORDED.map(g => g.prompt)
    .concat(SUGGEST.filter(s => !findSeed(s)));
  all.forEach(text => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "ask";
    const sp = document.createElement("span"); sp.textContent = text;
    b.appendChild(sp);
    b.onclick = () => { closeSheet(); $("msg").blur(); ask(text); };
    li.appendChild(b); $("chips").appendChild(li);
  });
  $("ownsize").textContent = MB + " MB";
  setGate();
  $("own").onclick = () => {
    if(okToLoad){ closeSheet(); $("msg").focus(); return; }
    offer();
  };
}

/* The one decision the page puts to anybody, asked where it comes up rather
   than after they have typed something and had it refused. */
async function offer(){
  const sheet = $("sheet").firstElementChild;
  const keep = [...sheet.children];
  keep.forEach(c => { c.style.display = "none"; });
  const yes = await gate(sheet, "", true);
  keep.forEach(c => { c.style.display = ""; });
  if(yes){
    closeSheet();
    $("msg").focus();
  }
}
function submit(){
  const v = $("msg").value.trim();
  if(!v) return;
  $("msg").value = ""; $("send").disabled = true;
  closeSheet(); $("msg").blur();
  ask(v);
}
/* Until the model is here there is nothing to type into: the five recorded
   questions are the only things the page can answer, and a box that raises a
   keyboard and shoves the whole screen up to let somebody write a question it
   will then refuse is a box that lied. Read-only keeps the keyboard down on a
   phone and the caret away on a desktop, while the box still takes focus, so
   reaching for it still opens the list and the keyboard arrives at the moment
   typing starts meaning something. */
function setGate(){
  const shut = !okToLoad && !LIVE;
  const m = $("msg");
  m.readOnly = shut;
  /* short enough to survive a phone: the sheet opening above it says what
     adding the model costs, which is the half that needs the room */
  m.placeholder = shut ? "Pick a question, or add the model"
                       : "Ask anything. The model loads when you send.";
  bar.classList.toggle("gated", shut);
}

/* The sheet is shown when somebody reaches for the box, not before. A press
   inside it has to survive the blur that the press itself causes, so a
   pointer going down on the sheet holds it open until the click lands. */
const bar = document.querySelector(".bar");
const openChips = v => bar.classList.toggle("open", v);
const closeSheet = () => { openChips(false); chipHold = false; };
let chipHold = false;
$("sheet").addEventListener("pointerdown", () => { chipHold = true; });
$("msg").addEventListener("focus", () => openChips(true));
$("msg").addEventListener("blur", () => setTimeout(() => {
  if(!chipHold) openChips(false);
  chipHold = false;
}, 60));
addEventListener("pointerdown", e => {
  if(!bar.contains(e.target)) closeSheet();
}, true);

$("msg").addEventListener("keydown", e => { if(e.key === "Enter") submit(); });
$("msg").addEventListener("input", () => { $("send").disabled = !$("msg").value.trim(); });
$("send").onclick = submit;

/* ---------------------------------------------------------------------------
   Capture mode:  …/into-the-network/?capture

   The recorded questions have to be computed somewhere with the weights, and
   the only machine in this project that can reach them is whichever browser
   is reading this page. So it captures them itself: run each question once,
   and hand back a seeds.js to commit. Questions already recorded are kept
   untouched, because a capture made offline carries real embedding-matrix
   neighbourhoods and this one cannot.
--------------------------------------------------------------------------- */
/* The words a question should arrive with, by the rule the page uses now. A
   recorded question whose words do not match this was captured under an older
   rule, which is how "What is a prime number?" reached the screen as four
   words. Checking rather than assuming means a change to how words are found
   re-records exactly the questions it affects and leaves the rest alone. An
   offline capture carries neighbourhoods a browser cannot compute, so not
   overwriting one needlessly is worth the check. */
const typedWords = t => (t.match(/[A-Za-z][A-Za-z'-]*/g) || []).map(w => w.toLowerCase());
const stale = g => typedWords(g.prompt).join(" ") !== g.q.map(x => x.w.toLowerCase()).join(" ");

async function captureAll(){
  /* ?capture        fills in what is missing, and anything now out of date
     ?capture=all    records everything again, whatever its state */
  const all = /capture=all/.test(location.search);
  const want = RECORDED.map(g => g.prompt).concat(SUGGEST.filter(s => !findSeed(s)));
  const keep = new Map();
  if(!all) RECORDED.forEach(g => { if(!stale(g)) keep.set(norm(g.prompt), g); });
  const todo = want.filter(t => !keep.has(norm(t)));
  const t = turn("bot");
  who(t, "capture mode");
  if(!todo.length){ say(t, "Everything is already recorded."); return; }
  const old = todo.filter(x => RECORDED.some(g => norm(g.prompt) === norm(x)));
  const note = say(t, "About to capture " + todo.length + " question"
    + (todo.length === 1 ? "" : "s")
    + (old.length ? ", " + old.length + " of them recorded already but out of date" : "")
    + ". Keeping " + keep.size + " as they are. A few minutes; leave this tab open.");
  if(!okToLoad && !(await gate(t, ""))) return;
  const done = new Map();
  try{
    const m = await provider(msg => note.textContent = "Getting the model, " + msg + ".");
    for(const q of todo){
      note.textContent = "Capturing: " + q;
      const a = await m.associate(q);
      const steps = await m.generate(q, undefined, (st, all) => {
        note.textContent = "Capturing: " + q + "  (" + all.length + " words)";
      });
      done.set(norm(q), { prompt:q, q:a.q, emerge:m.concepts(steps, a.q.map(x => x.w)),
                 reply:m.toReply(steps), said:m.sayWhat(steps), from:"browser" });
      say(t, "\u2713 " + q + "\n   " + m.sayWhat(steps));
    }
  }catch(e){ note.textContent = "Stopped: " + e.message; return; }
  /* rebuilt in the order the chips are in, not the order they were captured */
  const out = want.map(t => done.get(norm(t)) || keep.get(norm(t))).filter(Boolean);
  const js = "window.SEEDS=" + JSON.stringify(out) + ";\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([js], { type:"text/javascript" }));
  a.download = "seeds.js";
  a.textContent = "Download seeds.js  (" + out.length + " questions, "
                + Math.round(js.length / 1024) + "KB)";
  a.style.cssText = "color:var(--clay);display:inline-block;margin-top:12px";
  t.appendChild(a);
  note.textContent = "Done. Commit this over build/into-the-network/seeds.js "
    + "and rebuild.";
  scroll();
}

chips();
if(location.search.includes("capture")) captureAll();
