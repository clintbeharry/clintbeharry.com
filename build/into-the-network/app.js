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
const OPEN_X = 18, OPEN_STEP_X = 13, OPEN_Y = 0, OPEN_ROW = 15;
const REST_GAP = 7, REST_ROW = 12;   /* these two match --gap and --row */
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
  const clip = w => w.length > MAX_CH ? w.slice(0, MAX_CH - 1) + "\u2026" : w;
  /* the line spaces itself so every field has somewhere to sit, plus a little
     over, because words butted together read as one word */
  const widest = Math.max(step.tok.length, ...field.map(c => clip(c.w).length));
  tok.style.setProperty("--pad",
    (0.45 + (widest - step.tok.length) / 2).toFixed(2) + "ch");

  const fan = el("span", "fan");
  field.forEach((c, i) => {
    const row = el("i");
    row.appendChild(document.createTextNode(clip(c.w)));
    const sh = el("s"); sh.textContent = share(c.p); row.appendChild(sh);
    row.style.setProperty("--o", (.16 + Math.sqrt(c.p) * .7).toFixed(3));
    row.style.setProperty("--cx", "0%");       /* hang to the right */
    row.style.setProperty("--x", (OPEN_X + i * OPEN_STEP_X) + "px");
    row.style.setProperty("--y", (OPEN_Y + i * OPEN_ROW) + "px");
    if(i === 0) row.classList.add("win");
    fan.appendChild(row);
  });
  tok.appendChild(fan);
  return { tok, fan, word };
}

/* One line from the word to each thing it might have been. Drawn after the
   token is in the document, because where the rows land depends on how wide
   their own text is, and that is only known once laid out. */
const NS = "http://www.w3.org/2000/svg";
function wires(tok, fan, step){
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
    ln.setAttribute("stroke", i === 0 ? "#d97757" : "#8a8a8a");
    ln.setAttribute("stroke-width", (0.6 + Math.sqrt(p) * 1.1).toFixed(2));
    ln.setAttribute("stroke-opacity", (0.14 + Math.sqrt(p) * 0.55).toFixed(2));
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
    const { tok, fan } = buildTok(step);
    /* A real space between words, not just the padding that holds a field
       open. Padding alone spaces the line while it is being written and then
       has nothing to relax to, so the finished answer keeps animation gaps
       and its punctuation floats off on its own. */
    if(p.querySelector(".tok") && !/^[,.;:!?)\]'’]/.test(step.tok))
      p.insertBefore(document.createTextNode(" "), caret);
    p.insertBefore(tok, caret);
    scroll();

    const w = wires(tok, fan, step);
    fan.classList.add("in");
    if(w) w.classList.add("in");
    await pause(80);
    if(my !== token) return;
    await pause(Math.min(680, Math.max(70, bitsOf(step.cands[0].p) * 155)));
    if(my !== token) return;

    /* the one taken travels up and left onto the line; the rest slide left
       and down into the trace they leave behind */
    const rows = [...fan.children];
    const win = rows[0];
    win.style.setProperty("--cx", "-50%");
    win.style.setProperty("--x", "0px");
    win.style.setProperty("--y", (-(tok.offsetHeight - 2)) + "px");
    rows.forEach((row, i) => {
      if(i === 0) return;
      row.style.setProperty("--cx", "-50%");
      row.style.setProperty("--x", "0px");
      row.style.setProperty("--y", (REST_GAP + i * REST_ROW) + "px");
    });
    fan.classList.add("out");

    /* the share it was taken at, rising away: a few of them are in the air
       at once, so the line reads as a run of decisions rather than one */
    const lift = el("span", "lift");
    lift.textContent = share(step.cands[0].p);
    tok.appendChild(lift);
    requestAnimationFrame(() => lift.classList.add("go"));
    setTimeout(() => lift.remove(), 2700);

    await pause(300);
    if(my !== token) return;
    tok.classList.add("set");
    await pause(40);
    if(w) w.classList.remove("in");
    fan.classList.remove("in", "out");
    fan.classList.add("rest");
    rows.forEach((c, i) => { if(i && i < 4) c.classList.add("keep"); });
    win.style.setProperty("--x", "0px");
    win.style.setProperty("--y", REST_GAP + "px");
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
  let boxes = null;

  /* measured in the settled layout and held for the gesture: the words move
     as the bulge opens, and chasing their live positions makes the thing
     under the pointer squirm away from it */
  const measure = () => {
    boxes = toks.map(t => {
      const r = t.getBoundingClientRect();
      return { x:(r.left + r.right) / 2, y:(r.top + r.bottom) / 2, h:r.height };
    });
  };
  const apply = idx => {
    toks.forEach((t, i) => {
      const d = idx < 0 ? 99 : Math.abs(i - idx);
      /* room opens almost fully for the neighbours, so their fields have
         somewhere to go; how brightly those fields show falls away faster,
         so the word under the pointer is plainly the one being read */
      t.style.setProperty("--spread", d === 0 ? 1 : d === 1 ? .92 : d === 2 ? .7 : 0);
      t.style.setProperty("--mag",    d === 0 ? 1 : d === 1 ? .45 : d === 2 ? .16 : 0);
    });
    p.classList.toggle("inspect", idx >= 0);
  };
  const nearest = (x, y) => {
    if(!boxes) measure();
    let best = -1, bd = Infinity;
    boxes.forEach((b, i) => {
      const dy = Math.abs(b.y - y);
      if(dy > b.h * 1.3) return;                 /* another line */
      const d = Math.abs(b.x - x) + dy * .5;
      if(d < bd){ bd = d; best = i; }
    });
    return bd < 200 ? best : -1;
  };
  const move = (x, y) => apply(nearest(x, y));
  const off = () => { apply(-1); boxes = null; };

  p.addEventListener("pointerenter", measure);
  p.addEventListener("pointermove", e => {
    if(e.pointerType !== "touch") move(e.clientX, e.clientY);
  });
  p.addEventListener("pointerleave", off);
  p.addEventListener("touchstart", e => {
    measure(); const t = e.touches[0]; if(t) move(t.clientX, t.clientY);
  }, { passive:true });
  p.addEventListener("touchmove", e => {
    const t = e.touches[0]; if(t) move(t.clientX, t.clientY);
  }, { passive:true });
  p.addEventListener("touchend", off);
  p.addEventListener("touchcancel", off);
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
    b.onclick = () => ask(text);
    li.appendChild(b); $("chips").appendChild(li);
  });
}
function submit(){
  const v = $("msg").value.trim();
  if(!v) return;
  $("msg").value = ""; $("send").disabled = true;
  ask(v);
}
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
