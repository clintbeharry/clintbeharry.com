/* ---------------------------------------------------------------------------
   The page around the sequence.

   Two ways in, and the difference matters. A recorded question plays at once
   from a capture, so the piece can be seen without downloading anything. A
   typed question is worked out here, in this tab, which means waiting for the
   weights the first time and then roughly a forward pass per word. Both end
   up in the same shape, so the sequence itself cannot tell them apart.
--------------------------------------------------------------------------- */

const SUGGEST = [
  "Why is the sky blue?",
  "What is a prime number?",
  "How does a fridge keep things cold?",
  "What makes bread rise?",
];

const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const RECORDED = (window.SEEDS || []).filter(g => g && g.q && g.reply);
const findSeed = t => RECORDED.find(g => norm(g.prompt) === norm(t));

let token = 0;        /* which ask is current */
let last = null;      /* so Replay has something to replay */
let LIVE = null;      /* the provider module, imported on first need */
let loading = null;   /* the one in-flight load */

/* ---- status ---- */
/* Two separate things: what the model is, which does not change, and what it
   is doing, which does. Kept apart so a load state cannot overwrite the
   provenance, and so the page never offers to answer anything while the
   weights are at 7%. */
const PROV = "SmolLM2-360M-Instruct · onnx q4";
function status(msg, bad){
  $("status").innerHTML = PROV + "<br>" +
    (bad ? '<span style="color:#c6613f">' + msg + "</span>" : msg);
}
window.onLiveStatus = (msg, bad) => {
  status(msg, bad);
  if(window.LIVE && window.LIVE.phase === "loading") pulse(msg);
};
function pulse(t){ $("idlePulse").textContent = t || ""; }
const showIdle = on => $("idle").classList.toggle("off", !on);
function idleSays(head, body){
  $("idle").querySelector("div").innerHTML =
    '<p><b>' + esc(head) + '</b>' + body + '</p><p class="pulse" id="idlePulse"></p>';
}

/* ---- chips ---- */
function chips(){
  const add = (text, kind) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "chip" + (kind === "live" ? " needs" : "");
    b.innerHTML = "";
    b.appendChild(document.createTextNode(text));
    const tag = document.createElement("i");
    tag.textContent = kind === "live" ? "runs here" : "recorded";
    b.appendChild(tag);
    b.onclick = () => ask(text);
    li.appendChild(b);
    $("chips").appendChild(li);
  };
  RECORDED.forEach(g => add(g.prompt, "recorded"));
  SUGGEST.filter(s => !findSeed(s)).forEach(s => add(s, "live"));
}

/* ---- the model, on first need ---- */
async function provider(){
  if(LIVE) return LIVE;
  if(!loading) loading = (async () => {
    const m = await import("./live.js");
    const ok = await m.load();
    if(!ok) throw new Error(window.LIVE && window.LIVE.error
      ? window.LIVE.error : "the model would not load");
    LIVE = m; return m;
  })();
  return loading;
}

/* ---- ask ---- */
async function ask(text){
  const my = ++token;
  if(window.stopRun) window.stopRun();
  $("answer").classList.remove("in");
  $("replay").disabled = true; $("pause").disabled = true;
  $("step").textContent = "";
  $("hud").innerHTML = "";

  const seed = findSeed(text);
  if(seed){
    showIdle(false);
    last = seed;
    await perform(seed, my);
    return;
  }

  /* everything else is computed in this tab */
  showIdle(true);
  $("q").style.opacity = 0;
  pulse("waiting for the weights");
  let G;
  try{
    const m = await provider();
    if(my !== token) return;
    pulse("reading your question");
    const { q, truncated } = await m.associate(text);
    if(my !== token) return;

    /* The sequence needs the whole reply before it can start: step three
       seats the concepts the answer reaches for, so they have to exist
       first. That is the wait, and it is counted out rather than hidden. */
    const steps = await m.generate(text, undefined, (st, all) => {
      if(my !== token) return;
      pulse("working out the answer, " + all.length + " words so far");
    });
    if(my !== token) return;
    if(!steps.length) throw new Error("the model stopped before saying anything");

    G = {
      prompt: text,
      q,
      emerge: [],
      reply: m.toReply(steps),
      said: steps.map(s => s.tok).join("").trim(),
      live: true,
      truncated,
    };
  }catch(e){
    if(my !== token) return;
    status(e.message, true);
    /* The commonest failure is not a broken page. It is this page being read
       somewhere the weights cannot be fetched from, which is worth saying
       plainly rather than reporting as an error the reader caused. */
    const blocked = /dynamically imported|fetch|network|load/i.test(e.message);
    idleSays(blocked ? "The model cannot be reached from here."
                     : "That did not work.",
      blocked
        ? " Typed questions need the weights, which come from a CDN this copy "
          + "of the page is not allowed to reach. On the hosted copy they "
          + "download once and are cached. The recorded question below plays "
          + "either way, with no model needed."
        : " " + esc(e.message) +
          ". The recorded question below still plays without the model.");
    return;
  }
  if(my !== token) return;
  pulse("");
  showIdle(false);
  last = G;
  await perform(G, my);
}

const esc = s => String(s).replace(/[&<>]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));

async function perform(G, my){
  $("pause").disabled = false;
  $("pause").textContent = "Pause";
  if(window.setPaused) window.setPaused(false);
  await window.playRun(G);
  if(my !== token) return;
  $("replay").disabled = false;
  $("pause").disabled = true;

  /* the sequence shows the first few words being chosen; the reply itself is
     longer than that, so it lands here in full once the point has been made */
  $("answerWho").textContent = (G.live ? "live in this tab" : "recorded")
    + " · " + G.reply.length + " of these words shown above";
  $("said").textContent = G.said || "";
  $("answer").classList.add("in");
}

/* ---- controls ---- */
$("replay").onclick = () => { if(last) ask(last.prompt); };
$("pause").onclick = e => {
  const p = !window.isPaused();
  window.setPaused(p);
  e.target.textContent = p ? "Play" : "Pause";
};
function submit(){
  const v = $("msg").value.trim();
  if(!v) return;
  $("msg").value = ""; $("send").disabled = true;
  ask(v);
}
$("msg").addEventListener("keydown", e => { if(e.key === "Enter") submit(); });
$("msg").addEventListener("input", () => { $("send").disabled = !$("msg").value.trim(); });
$("send").onclick = submit;

/* ---- boot ---- */
chips();
status("recorded questions ready, no download needed");
$("hint").textContent = RECORDED.length
  ? "The recorded question plays straight away. Anything you type is run on the "
    + "model itself, which downloads about 300MB the first time and is cached "
    + "after that. Nothing you type leaves your browser."
  : "Anything you type is run on the model itself, which downloads about 300MB "
    + "the first time and is cached after that.";
/* the per-run wording is set by the sequence as each run opens; until then
   the line says only what is true of every run */
$("note").innerHTML = "<b>What is real here.</b> The candidates and their shares "
  + "in step five are the model's actual next-token distributions. The box, the "
  + "collapse and the spreading front are staging. Ask something and this line "
  + "will say what is measured in that particular run.";
