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

/* ---- turns ---- */
function turn(role){
  const t = document.createElement("div");
  t.className = "turn " + role;
  if(role === "bot"){
    const w = document.createElement("p");
    w.className = "who";
    t.appendChild(w);
  }
  log.appendChild(t); scroll();
  return t;
}
const who = (t, s) => { t.querySelector(".who").textContent = s; };

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
  claim($("stage"), bt);
  bt.classList.remove("working");
  who(bt, "");
  actions(bt);
  await window.playRun(G);
  if(my !== token) return;
  say(bt, G.said || "");
  const r = bt.querySelector(".acts [data-a=replay]");
  if(r) r.disabled = false;
  const p = bt.querySelector(".acts [data-a=pause]");
  if(p) p.disabled = true;
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
  const rep = mk("replay", "Replay"); rep.disabled = true;
  const pau = mk("pause", "Pause");
  rep.onclick = () => { if(last) ask(last.prompt); };
  pau.onclick = () => {
    const p = !window.isPaused();
    window.setPaused(p);
    pau.textContent = p ? "Play" : "Pause";
  };
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
