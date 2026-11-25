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

/* ---- the one question the page asks ---- */
function gate(t, text){
  return new Promise(resolve => {
    const g = document.createElement("div");
    g.className = "gate";
    g.innerHTML =
      "<p>Answering your own question means running the model itself, right here "
      + "in this tab. That needs its weights: <b>about " + MB + " MB</b>, downloaded "
      + "once and kept by your browser afterwards. Nothing you type is sent "
      + "anywhere.</p><div class='row'></div>";
    const row = g.querySelector(".row");
    const go = document.createElement("button");
    go.className = "go"; go.textContent = "Download and answer";
    const no = document.createElement("button");
    no.textContent = "Not now";
    row.append(go, no);
    t.appendChild(g); scroll();
    go.onclick = () => { g.remove(); okToLoad = true; resolve(true); };
    no.onclick = () => { g.remove(); say(t, "Left it. The suggested questions "
      + "below are already answered and need no download."); resolve(false); };
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
    LIVE = m; return m;
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
  await writeReply(bt, G, my, at);
  if(my !== token) return;
  /* the controls belong under the finished message, the way a chat puts copy
     and retry there, not above an answer that has not been written yet */
  bt.classList.add("spoken");       /* the caption has nothing left to report */
  actions(bt);
  inspector(bt.querySelector(".reply"));
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

  const field = step.cands.slice(0, FAN_N);
  /* Which row was taken is a question of identity, not of position. It is
     almost always the likeliest one, but when it is not, that is the most
     interesting thing on the line and the field has to be able to say so:
     the list stays in rank order and the highlight moves down it. */
  let wi = field.findIndex(c => c.w === step.tok);
  if(wi < 0){
    const taken = step.cands.find(c => c.w === step.tok);
    /* taken but not in the top few: it belongs at the bottom of the list,
       which is where its share puts it anyway */
    if(taken){ field[field.length - 1] = taken; wi = field.length - 1; }
    else wi = 0;
  }
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
    fan.appendChild(row);
  });
  tok.appendChild(fan);
  return { tok, fan, word, wi, took:field[wi] };
}

/* One line from the word to each thing it might have been. Drawn after the
   token is in the document, because where the rows land depends on how wide
   their own text is, and that is only known once laid out. */
const NS = "http://www.w3.org/2000/svg";
function wires(tok, fan, step, wi){
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
    const p = step.cands[i] ? step.cands[i].p : 0;
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
async function writeReply(bot, G, my, at){
  const p = el("p", "reply");
  const caret = el("span", "caret");
  p.appendChild(caret);
  bot.appendChild(p);
  scroll();

  for(const step of G.reply){
    if(my !== token) return;
    const { tok, fan, wi, took } = buildTok(step);
    /* A real space between words, not just the padding that holds a field
       open. Padding alone spaces the line while it is being written and then
       has nothing to relax to, so the finished answer keeps animation gaps
       and its punctuation floats off on its own. */
    if(p.querySelector(".tok") && !/^[,.;:!?)\]'’]/.test(step.tok))
      p.insertBefore(document.createTextNode(" "), caret);
    p.insertBefore(tok, caret);
    scroll();

    const w = wires(tok, fan, step, wi);
    fan.classList.add("in");
    if(w) w.classList.add("in");
    await pause(80);
    if(my !== token) return;
    await pause(Math.min(680, Math.max(70, bitsOf(took.p) * 155)));
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

    await pause(300);
    if(my !== token) return;
    tok.classList.add("set");
    await pause(40);
    fan.classList.remove("in", "out");
    fan.classList.add("rest");
    rows.forEach((c, i) => { if(i !== wi && i < 4) c.classList.add("keep"); });
    win.style.setProperty("--x", "0px");
    win.style.setProperty("--y", (REST_GAP + wi * REST_ROW) + "px");
  }
  caret.remove();
  p.classList.add("done");
  scroll();
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
  const toks = [...p.querySelectorAll(".tok")];
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
  const hover = (x, y) => {
    const r = inPanel();
    if(r && x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 4 && y <= r.bottom + 6) return;
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
  p.addEventListener("touchstart", e => {
    const t = e.touches[0]; if(!t) return;
    slid = false; pinned = -1; measure(); apply(hit(t.clientX, t.clientY));
  }, { passive:true });
  p.addEventListener("touchmove", e => {
    const t = e.touches[0]; if(!t) return;
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

/* ---- composer ---- */
function chips(){
  const all = RECORDED.map(g => g.prompt)
    .concat(SUGGEST.filter(s => !findSeed(s)));
  all.forEach(text => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "chip"; b.textContent = text;
    b.onclick = () => { openChips(false); chipHold = false; $("msg").blur(); ask(text); };
    li.appendChild(b); $("chips").appendChild(li);
  });
}
function submit(){
  const v = $("msg").value.trim();
  if(!v) return;
  $("msg").value = ""; $("send").disabled = true;
  openChips(false); $("msg").blur();
  ask(v);
}
/* The suggestions are shown when somebody reaches for the box, not before.
   A chip press has to survive the blur that the press itself causes, so a
   pointer going down on the list holds them open until the click lands. */
const bar = document.querySelector(".bar");
const openChips = v => bar.classList.toggle("open", v);
let chipHold = false;
$("chips").addEventListener("pointerdown", () => { chipHold = true; });
$("msg").addEventListener("focus", () => openChips(true));
$("msg").addEventListener("blur", () => setTimeout(() => {
  if(!chipHold) openChips(false);
  chipHold = false;
}, 60));

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
