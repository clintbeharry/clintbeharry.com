/* global React, ReactDOM, PROJECTS */
/* Minimal stand-in for the design-tool's tweaks-panel.jsx. The floating
   panel only ever opens on a postMessage from a parent design-tool host
   frame (__activate_edit_mode) — on the standalone public site there is no
   such host, so the real panel can never render. This keeps just the piece
   that matters here: seeding the CSS custom properties from TWEAK_DEFAULTS. */
function useTweaks(defaults) {
  const [values] = React.useState(defaults);
  return [values, () => {}];
}
function TweaksPanel() { return null; }
function TweakSection() { return null; }
function TweakColor() { return null; }
function TweakSelect() { return null; }
function TweakRadio() { return null; }

/* global React, ReactDOM, PROJECTS, useTweaks, TweaksPanel, TweakSection, TweakColor, TweakSelect, TweakRadio */
const { useState, useEffect, useRef, useLayoutEffect } = React;

const NAME = "Clint Beharry";
const EMAIL = "clint@beharry.design";
/* the palette walks one direction — pink → red → orange → yellow — so the bar
   and the papers behind it read as one stepped gradient down the sheet */
const TINTS = ["oklch(0.6 0.13 350)", "oklch(0.633 0.127 20)", "oklch(0.667 0.123 50)", "oklch(0.7 0.12 80)"];


/* ---- Tweakable aesthetic tokens (carried over from the previous page) ---- */
const ACCENTS = { Clay: "oklch(0.72 0.13 38)", Cobalt: "oklch(0.7 0.12 256)", Forest: "oklch(0.72 0.11 158)", Plum: "oklch(0.72 0.12 330)", Ink: "oklch(0.78 0.02 260)" };
const DISPLAY_FONTS = { Amethysta: '"Amethysta", Georgia, serif', Newsreader: '"Newsreader", Georgia, serif', Spectral: '"Spectral", Georgia, serif', "Libre Caslon": '"Libre Caslon Text", Georgia, serif', "Instrument Serif": '"Instrument Serif", Georgia, serif' };
const BG_TONES = {
  Warm: { bg: "oklch(0.26 0.02 320)", surface: "oklch(0.305 0.022 320)" },
  Cool: { bg: "oklch(0.26 0.018 280)", surface: "oklch(0.305 0.02 280)" },
  Paper: { bg: "oklch(0.275 0.016 300)", surface: "oklch(0.32 0.018 300)" },
  Slate: { bg: "oklch(0.255 0.02 300)", surface: "oklch(0.3 0.022 300)" }
};
const REEL_FX = {
  "Slip to the back": "slip",
  "Deal off the top": "deal",
  "Fold reveal": "fold",
  "Chevron wipe": "chevron",
  "Shuffle-through": "shuffle",
  "Riffle": "riffle" };
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{ "accent": "Plum", "displayFont": "Amethysta", "bgTone": "Warm", "corners": "soft", "reelFx": "Slip to the back" } /*EDITMODE-END*/;

/* face order + the short metrics line; the one-line summary is pulled from
   data.js so the collapsed face and the write-up can never drift apart */
const FACES = [
{ uid: "meta-genai", title: "Generative AI Characters for Meta",
  impact: "4x character creation growth \u00b7 10x faster \u00b7 3x retention \u00b7 6 months from impasse to shipped" },
{ uid: "wsj-immersed", title: "To AI or Not to AI?",
  impact: "Self-initiated, solo design and build \u00b7 100 use cases \u00b7 4x sharing \u00b7 80% comparing with others" },
{ uid: "wonderscope", title: "Wonderscope",
  impact: "Apple Design Award \u00b7 1M+ kids taught to read \u00b7 Acquired by Amira Learning" },
{ uid: "case-study-five", title: "The Wall Street Journal VR",
  impact: "Launched at Google I/O \u00b7 Featured in CNET, Fast Company \u00b7 Design system still in use today" }];
const CARDS = FACES.map((f) => ({ ...f, desc: ((window.PROJECTS || []).find((p) => p.uid === f.uid) || {}).desc || "" }));

/* each panel's paper sits on the same hue walk as its bar, set directly:
   mixing these tints into the purple surface swings the hue through red */
const PAPERS = ["oklch(0.347 0.021 350)", "oklch(0.3457 0.0187 20)", "oklch(0.3443 0.0163 50)", "oklch(0.343 0.014 80)"];

const MARK = "linear-gradient(180deg," + TINTS.join(",") + ")";

const PILLARS = [
{ key: "biz", num: "01", label: "Business",
  text: "Entrepeneurial designer who founded companies and designed products from scratch across 3 acquisitions & 2 spin-outs." },
{ key: "design", num: "02", label: "Design",
  text: "Behavior is the medium, and my flows, loops, and emotional journeys are imaginatively crafted on top of behavioral science." },
{ key: "tech", num: "03", label: "Engineering",
  text: "Deep systems-thinker building the cutting-edge from AI to XR, technically anchored on a degree in computer engineering." }];

const ABOUT_FACTS = [
{ k: "Disciplines", v: "Product design, systems design, prototyping, research" },
{ k: "Tools", v: "Figma, Unity, Framer, code prototypes, a lot of paper" },
{ k: "Recognition", v: "Two design-team patents, occasional speaker" }];

/* problem and impact carry a single image; process and solution can hold up
   to three, so `imgs` drives how many slots each row offers */
const SECTIONS = [
{ key: "problem", ix: "1", label: "Problem", imgs: 1 },
{ key: "process", ix: "2", label: "Process", imgs: 3 },
{ key: "solution", ix: "3", label: "Solution", imgs: 3 },
{ key: "impact", ix: "4", label: "Impact", imgs: 1 }];

/* watch data-filled on every image-slot inside a box — it flips as the user
   drops or clears — and report which indices currently hold an image */
function useFilled(box) {
  const [filled, setFilled] = useState([]);
  useEffect(() => {
    const el = box.current;if (!el) return;
    const read = () => setFilled(
      Array.from(el.querySelectorAll("image-slot")).
      map((s, n) => s.hasAttribute("data-filled") ? n : -1).filter((n) => n >= 0));
    read();
    const mo = new MutationObserver(read);
    el.querySelectorAll("image-slot").forEach((s) =>
    mo.observe(s, { attributes: true, attributeFilter: ["data-filled"] }));
    return () => mo.disconnect();
  }, []);
  return filled;
}

/* the media in each slot has its own proportions — read them so the frame can
   take the showing item's shape instead of cropping everything to one ratio */
function useRatios(box) {
  const [ratios, setRatios] = useState({});
  useEffect(() => {
    const el = box.current;if (!el) return;
    const read = () => {
      const next = {};
      el.querySelectorAll("image-slot").forEach((s, n) => {
        const v = s.parentElement && s.parentElement.querySelector(".vslot video");
        const im = s.shadowRoot && s.shadowRoot.querySelector(".frame img");
        if (v && v.videoWidth) next[n] = v.videoWidth / v.videoHeight;else
        if (im && im.naturalWidth) next[n] = im.naturalWidth / im.naturalHeight;
      });
      setRatios((prev) => {
        const ka = Object.keys(prev),kb = Object.keys(next);
        if (ka.length === kb.length && kb.every((k) => prev[k] === next[k])) return prev;
        return next;
      });
    };
    read();
    /* the interval alone is a visible jump on load: the frame holds its 4/3
       placeholder until the first poll lands, then snaps to the media's real
       shape. watch every frame until the images have decoded, then fall back
       to the slow poll for later drops. */
    let raf = 0;const t0 = performance.now();
    const tick = () => {
      read();
      if (performance.now() - t0 < 2000) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const t = setInterval(read, 1400);
    return () => {cancelAnimationFrame(raf);clearInterval(t);};
  }, []);
  return ratios;
}

/* a bare URL in the copy becomes a link that opens in its own window, marked
   with the same corner arrow the footer links use — no underline */
const URL_RE = /(https?:\/\/[^\s<>()]+)/g;
/* [label](url) sets the label as the link text, so a long share URL can read as
   a sentence; a bare url still prints itself */
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
function linkify(text, key) {
  if (typeof text !== "string") return text;
  const ms = [...text.matchAll(new RegExp(MD_LINK_RE.source, "g"))];
  if (ms.length) {
    const out = [];
    let last = 0;
    for (const m of ms) {
      if (m.index > last) out.push(<React.Fragment key={String(key) + "-t" + m.index}>{linkify(text.slice(last, m.index), String(key) + "t" + m.index)}</React.Fragment>);
      out.push(
      <a className="pb-link" key={String(key) + "-l" + m.index} href={m[2]} target="_blank" rel="noopener noreferrer">
        {m[1]}
        <svg className="ext" viewBox="0 0 14 14" aria-hidden="true"><path d="M5 2h7v7" /><path d="M12 2 4.5 9.5" /><path d="M9 12H2V5" /></svg>
      </a>);
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(<React.Fragment key={String(key) + "-tend"}>{linkify(text.slice(last), String(key) + "tend")}</React.Fragment>);
    return out;
  }
  if (!new RegExp(URL_RE.source).test(text)) return text;
  return text.split(URL_RE).map((part, i) =>
  /^https?:\/\//.test(part) ?
  <a className="pb-link" key={String(key) + "-" + i} href={part} target="_blank" rel="noopener noreferrer">
    {part.replace(/^https?:\/\//, "").replace(/\/$/, "")}
    <svg className="ext" viewBox="0 0 14 14" aria-hidden="true"><path d="M5 2h7v7" /><path d="M12 2 4.5 9.5" /><path d="M9 12H2V5" /></svg>
  </a> :
  <React.Fragment key={String(key) + "-" + i}>{part}</React.Fragment>);
}

/* a body row's images use the same reel as the cover: one animated gif plays
   on its own, two or three stills cross-fade in place. staggered so rows in
   an open case study don't all turn over on the same beat. every row gets the
   full set of slots so stills can be added anywhere, not just where the data
   happened to ask for a stack. */
/* a few rows carry a second, standalone media frame under the main deck:
   card uid -> section key -> how many extra frames */
const EXTRA_SHOTS = { wonderscope: { solution: 1 } };

function Shots({ uid, sectionKey, max, ix }) {
  const extra = (EXTRA_SHOTS[uid] || {})[sectionKey] || 0;
  if (extra) return (
    <div className="pb-media">
      <ShotsReel uid={uid} sectionKey={sectionKey} max={max} ix={ix} />
      {Array.from({ length: extra }, (_, x) =>
      <Reel key={"x" + x} slotId={(n) => uid + "-" + sectionKey + "-extra" + (x || "") + (n ? "-" + n : "")}
      count={1} hold={REEL_HOLD + (ix + 1) * 600} className="pb-shots"
      hint="Video, gif, or image" />)}
    </div>);

  return <ShotsReel uid={uid} sectionKey={sectionKey} max={max} ix={ix} />;
}

function ShotsReel({ uid, sectionKey, max, ix }) {
  return (
    <Reel key={sectionKey} slotId={(n) => uid + "-" + sectionKey + (n ? "-" + n : "")}
    count={Math.max(max || 1, REEL_SLOTS)} hold={REEL_HOLD + ix * 600} className="pb-shots"
    hint="Video, gif, or up to 3 stills" />);

}

/* every image on the page is a reel: drop ONE animated gif and it simply
   plays, or several stills and they cross-fade on a timer. only slots the
   user has actually filled join the rotation, so unused slots never fade
   the frame to an empty placeholder. */
const REEL_SLOTS = 4,REEL_HOLD = 3600;

function Reel({ slotId, count = REEL_SLOTS, hold = REEL_HOLD, className = "", hint }) {
  const box = useRef(null);
  const filled = useFilled(box);
  const ratios = useRatios(box);
  /* one height for the whole reel — the tallest item's — so a slideshow never
     reflows the page mid-cycle; shorter items letterbox inside it */
  const own = filled.map((n) => ratios[n]).filter(Boolean);
  const frameRatio = own.length ? Math.min(...own) : null;
  /* always keep ONE spare slot past the last filled one, so a fully loaded
     reel still offers an add tile on hover (capped so it can't grow forever) */
  const total = Math.min(Math.max(count, (filled.length ? Math.max(...filled) + 1 : 0) + 1), 8);
  const [i, setI] = useState(0);

  /* a lone image (the gif case) holds still; two or more cross-fade.
     one timeout per step, keyed on the step — so every slide gets the full
     hold even when a re-render (a drop, a video mounting) lands mid-cycle */
  useEffect(() => {
    if (filled.length < 2) {setI(0);return;}
    const t = setTimeout(() => setI((v) => (v + 1) % filled.length), hold);
    return () => clearTimeout(t);
  }, [i, filled.length, hold]);

  const showing = filled.length ? filled[i % filled.length] : -1;
  /* the card that just left the top of the deck: held for the length of the
     transition so a mode can fly it out, fade it, or wipe it away */
  const [leaving, setLeaving] = useState(-1);
  const wasShowing = useRef(showing);
  useEffect(() => {
    if (wasShowing.current === showing) return;
    const gone = wasShowing.current;
    wasShowing.current = showing;
    if (gone < 0) return;
    setLeaving(gone);
    const t = setTimeout(() => setLeaving(-1), 900);
    return () => clearTimeout(t);
  }, [showing]);
  const isFilled = (n) => filled.indexOf(n) >= 0;
  /* a native file drag never re-evaluates :hover (the pointer left the
     document to start the drag), so the empty tiles also open on dragenter —
     otherwise a dropped file always lands on the full-bleed frame 0. */
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const drag = {
    onDragEnter: () => {depth.current++;setDragging(true);},
    onDragOver: (ev) => {ev.preventDefault();setDragging(true);},
    onDragLeave: () => {if (--depth.current <= 0) {depth.current = 0;setDragging(false);}},
    onDrop: () => {depth.current = 0;setDragging(false);} };

  /* empty slots need somewhere reachable to live, or they could never be
     filled: on hover or drag they lay out as a row of tiles over the face.
     --e counts only the frames that actually BECOME tiles — the full-bleed
     .on frame is never one, so the row is at most count-1 wide and fits. */
  let e = -1;
  return (
    <div className={"preel " + className + (dragging ? " dragging" : "")} ref={box} {...drag}
    style={{ aspectRatio: frameRatio || undefined, "--kmax": Math.min(Math.max(filled.length - 1, 0), 2) }}
    onClick={(e2) => e2.stopPropagation()}>
      {Array.from({ length: total }).map((_, n) => {
        const empty = !isFilled(n);
        /* nothing dropped yet: slot 0 is the full-size drop target */
        const on = n === showing || showing < 0 && n === 0;
        const tile = empty && !on;
        if (tile) e++;
        /* depth in the deck: 0 is the card on top, 1 the one behind it, and so
           on around the cycle — the stack transform is driven off it */
        const pos = filled.indexOf(n);
        const k = pos < 0 ? null : (pos - i % filled.length + filled.length) % filled.length;
        return (
          <div key={n} style={tile ? { "--e": e } : k !== null ? { "--k": k, "--ar": ratios[n] || null } : null}
          className={"preel-frame" + (empty ? " empty" : "") + (on ? " on" : "") + (k !== null ? " card" : "") + (n === leaving ? " leaving" : "")}>
            <image-slot id={slotId(n)} shape="rect" fit="contain"
            src={(window.SLOT_IMAGES || {})[slotId(n)] || undefined}
            placeholder={n === 0 ? hint : " "}></image-slot>
          </div>);

      })}
    </div>);

}

function Pleat({ card, idx, open, onToggle }) {
  const full = PROJECTS.find((p) => p.uid === card.uid) || {};
  return (
    <article className={"pnl leaf" + (open ? " open" : "")} id={card.uid} style={{ "--tint": TINTS[idx % TINTS.length], "--paper": PAPERS[idx % PAPERS.length], "--i": idx }}
    data-screen-label={card.title}>
      <div className="pnl-face" role="button" tabIndex={0} aria-expanded={open} aria-controls={card.uid + "-body"}
      onKeyDown={(e) => {if (e.key === "Enter" || e.key === " ") {e.preventDefault();onToggle(e.currentTarget);}}}>
        <Reel slotId={(n) => card.uid + "-car-" + n}
        hint="Image, gif, or mp4 — loops automatically" />
        <div className="pnl-copy">
          <h3 className="pnl-title">{card.title}</h3>
          <p className="pnl-desc">{card.desc}</p>
          <span className="pnl-impact"><svg className="rule" viewBox="-8 -8 16 16" aria-hidden="true"><circle className="mk-dot" r="2" /><circle className="mk-ring" r="8" /><circle className="mk-ring mk-ring2" r="8" /></svg>{card.impact}</span>
          <p className="pnl-role mono"><svg className="pin" viewBox="0 0 12 16" aria-hidden="true"><path d="M6 .8c-2.7 0-4.9 2.2-4.9 4.9 0 3.5 4.9 9.5 4.9 9.5s4.9-6 4.9-9.5C10.9 3 8.7.8 6 .8z" /><circle cx="6" cy="5.7" r="1.9" /></svg>{full.role}</p>
        </div>
      </div>
      <div className="pnl-body" id={card.uid + "-body"} aria-hidden={!open}>
        <div className="pnl-clip">
          <div className="pnl-inner">
            {SECTIONS.map((s, i) => {
              /* a blank line in the copy starts a new paragraph */
              const paras = (full[s.key] || "").split(/\n\n+/);
              const para2p = (para, n) =>
                  <p key={n}>{para.split(/\n/).map((line, l) => {
                    /* {bunny} in the copy renders the quiz's own mark: the peace
                       sign layered behind the smiley so it reads as bunny ears */
                    const inl = line.split("{bunny}").flatMap((chunk, ci) => {
                      const parts = chunk.split("**").map((frag, m) => m % 2 ? <em key={l + "e" + ci + m}>{linkify(frag)}</em> : linkify(frag, l + "f" + ci + m));
                      return ci ? [<span className="bunny" key={l + "b" + ci} aria-label="peace sign behind a smiling face" role="img"><span className="bunny-ears" aria-hidden="true">✌️</span><span className="bunny-face" aria-hidden="true">🙂</span></span>, parts] : [parts];
                    });
                    /* a line opening "A. " reads as a list item: it indents, and a
                       wrap hangs under the text rather than back at the letter */
                    if (/^[A-Z]\.\s/.test(line)) return <span className="pb-li" key={l}>{inl}</span>;
                    return <React.Fragment key={l}>{l ? <br /> : null}{inl}</React.Fragment>;
                  })}</p>;
              return (
                <div className="pb-row" key={s.key}>
                  <Shots uid={card.uid} sectionKey={s.key} max={s.imgs} ix={i} />
                  <div className="pb-copy">
                    <div className="pb-num"><span className="ix mono">{s.ix}</span> {s.label}</div>
                    {paras.map(para2p)}
                  </div>
                </div>);

            })}
          </div>
        </div>
      </div>
      <div className="crease" aria-hidden="true"
      style={idx + 1 < CARDS.length ? { "--tint-next": TINTS[idx + 1], "--paper-next": PAPERS[idx + 1] } : null}><i className="crease-bar" /></div>
    </article>);

}

/* 50px bands. the count is measured, not fixed: each band carries a
   permanent compositing layer (see the css), so 400 of them would be
   gigabytes of layer memory and 400 gradients to repaint every frame — the
   choppiness. GROUND_MIN covers first paint before the measure lands. */
const GROUND_MIN = 24;

function PaperWork() {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef(null);
  const cancelRun = useRef(null);

  /* the impact marks ripple forever. ten of them repainting at once — most of
     them scrolled well out of sight — starve everything else on the page (a
     playing cover video drops a third of its frames). only the marks actually
     on screen are allowed to run. */
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => e.target.toggleAttribute("data-live", e.isIntersecting));
    }, { threshold: 0.01 });
    sheet.querySelectorAll(".pnl-impact").forEach((m) => io.observe(m));
    return () => io.disconnect();
  }, []);

  const docTop = (el) => {let t = 0;while (el) {t += el.offsetTop;el = el.offsetParent;}return t;};
  const ease = (p) => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

  /* One hand-driven timeline: every frame writes all five panel heights and
     then corrects the scroll, so the paper visibly stretches and the case study
     you clicked cannot drift while it happens. */
  const toggleFrom = (target) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    // a click mid-flight retargets instead of being swallowed: the run in
    // progress is snapped to its end and the new one starts from live heights
    if (cancelRun.current) cancelRun.current();
    const nextOpen = !open;
    const pnl = target && target.closest ? target.closest(".pnl") : null;
    let anchorY = pnl ? pnl.getBoundingClientRect().top : null;
    /* closing: the clicked study's top is often far above the viewport (you were
       reading its body), and holding that offset would leave the collapsed face
       off-screen. pull the anchor back into a band near the top of the window so
       the study you clicked inside is what you land on. */
    if (!nextOpen && anchorY != null) {
      const band = Math.max(24, Math.min(window.innerHeight * 0.4, 220));
      anchorY = Math.min(Math.max(anchorY, 24), band);
    }

    const clips = Array.from(sheet.querySelectorAll(".pnl-clip"));
    const plan = clips.map((clip, i) => {
      const from = clip.getBoundingClientRect().height;
      clip.style.height = "auto";
      const natural = clip.scrollHeight;
      clip.style.height = from + "px";
      return { clip, from, to: nextOpen ? natural : 0, delay: nextOpen ? i * 46 : (clips.length - 1 - i) * 38 };
    });

    setOpen(nextOpen);

    const DUR = 420;
    const root = document.documentElement;
    const prevBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto"; // smooth scrolling would swallow the corrections
    let stopped = false;
    const fix = () => {
      if (!pnl || anchorY == null) return;
      const t = docTop(pnl) - anchorY;
      if (Math.abs(t - window.scrollY) > 0.5) window.scrollTo(0, t);
    };
    const release = () => {
      stopped = true;
      if (cancelRun.current === cancel) cancelRun.current = null;
      root.style.scrollBehavior = prevBehavior;
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
    };
    const cancel = () => {
      plan.forEach(({ clip, to }) => {clip.style.height = nextOpen ? "auto" : to + "px";});
      release();
    };
    cancelRun.current = cancel;
    window.addEventListener("wheel", cancel, { passive: true, once: true });
    window.addEventListener("touchstart", cancel, { passive: true, once: true });

    const t0 = performance.now();
    const frame = (now) => {
      if (stopped) return;
      const t = now - t0;
      let allDone = true;
      plan.forEach(({ clip, from, to, delay }) => {
        const p = Math.max(0, Math.min(1, (t - delay) / DUR));
        if (p < 1) allDone = false;
        clip.style.height = from + (to - from) * ease(p) + "px";
      });
      fix();
      if (allDone) {
        plan.forEach(({ clip, to }) => {clip.style.height = nextOpen ? "auto" : to + "px";});
        fix();
        requestAnimationFrame(() => {fix();release();});
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  /* the ground's three zones: vertical stripes beside the nav/hero and the
     about/footer, zigzag beside the case studies. Both end zones keep a fixed
     height as the sheet opens, so the middle simply stretches. */
  const [bands, setBands] = useState(GROUND_MIN);
  React.useEffect(() => {
    const s = sheetRef.current;
    if (!s) return;
    const measure = () => {
      /* the zigzag lives strictly between the folds: it starts just below the
         half-fold band above the first case study and stops just above the one
         below the last, so both bands sit on plain ground */
      const lead = s.querySelector(".crease-lead");
      /* the band below the last case study is the last crease inside .pleats —
         .crease-trail sits up under the nav, so it must not be used here */
      const folds = [...s.querySelectorAll(".pleats > .pnl > .crease")];
      const trail = folds[folds.length - 1];
      if (!lead || !trail) return;
      const top = s.getBoundingClientRect().top;
      const l = lead.getBoundingClientRect();
      const t = trail.getBoundingClientRect();
      const gt = l.bottom - top,gb = s.offsetHeight - (t.top - top);
      if (t.top - top <= gt) return;
      /* rounded to whole pixels: a fractional zone top put every band on a
         fractional offset, which is what let device-pixel snapping drift */
      s.style.setProperty("--gt", Math.round(gt) + "px");
      s.style.setProperty("--gb", Math.round(gb) + "px");
      /* enough bands to fill the zone, +2 for the skew overhang. rounded up to
         a block of 8 and only ever grown, so an open/close never adds or
         removes nodes mid-animation. */
      const need = Math.ceil((s.offsetHeight - gt - gb) / 48) + 2;
      setBands((b) => Math.max(b, Math.ceil(need / 8) * 8));
      /* the two nav bars get a solid ground behind them in the stripe colour —
         quiet emphasis at both ends without competing with the chevrons.
         measured off the leaves themselves so the fill stops at the nav and
         never runs behind the hero or the about copy. */
      const nav = s.querySelector(".nav-leaf"),foot = s.querySelector(".contact-leaf");
      /* the field runs past the nav to cover the half fold beside it, so the
         ground ends on the same line the paper creases on */
      const leadC = s.querySelector(".crease-lead");
      const trailC = s.querySelector(".crease-trail");
      const lh = leadC ? Math.round(leadC.getBoundingClientRect().height) : 8;
      const th = trailC ? Math.round(trailC.getBoundingClientRect().height) : 8;
      if (nav) s.style.setProperty("--nh", Math.round(nav.getBoundingClientRect().height) + lh + "px");
      if (foot) s.style.setProperty("--fh", Math.round(foot.getBoundingClientRect().height) + th + "px");
      s.style.setProperty("--nfold", lh + "px");
      s.style.setProperty("--ffold", th + "px");
      /* the two half folds that bound the case studies: the lead crease sits
         just above the first, the last pleat crease just below the last. the
         chevron zone starts and stops on those lines, so the fields fill
         exactly the fold bands themselves. */
      s.style.setProperty("--lfold", Math.round(l.height) + "px");
      s.style.setProperty("--tfold", Math.round(t.height) + "px");
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    return () => ro.disconnect();
  }, []);

  /* the sheet folds when the click lands on a case-study section — or on the
     ground beside it, since the chevrons animate with the fold and so read as
     part of the control */
  /* a text selection ends in a click, so a drag-to-highlight would toggle the
     fold. remember where the pointer went down and bail if it moved more than
     a few pixels, or if a selection is live inside the sheet. */
  const downAt = useRef(null);
  const onSheetPointerDown = (e) => {downAt.current = { x: e.clientX, y: e.clientY };};
  const onSheetClick = (e) => {
    const d = downAt.current;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    const t = e.target;
    if (t.closest("a, button, input, .leaf-static")) return;
    if (t.closest(".ground")) {
      /* anchor the stretch to whichever case study the pointer is level with,
         so the paper opens around where you clicked rather than jumping */
      const y = e.clientY;
      const pnls = Array.from(sheetRef.current.querySelectorAll(".pnl"));
      const near = pnls.find((p) => p.getBoundingClientRect().bottom >= y) || pnls[0];
      toggleFrom(near);
      return;
    }
    if (!t.closest(".pnl")) return;
    toggleFrom(t);
  };

  return (
    <section className="paper-section">
      <div className="shell">
        <div ref={sheetRef} className={"sheet" + (open ? " open" : "")} onClick={onSheetClick}
        onPointerDown={onSheetPointerDown}
        style={{ "--mark": MARK }}>

          <i className="ground ground-flat ground-top" aria-hidden="true" />
          <i className="ground ground-solid ground-fold-top" aria-hidden="true" />
          <i className="ground ground-solid ground-nav" aria-hidden="true" />
          <div className="ground ground-diag" aria-hidden="true">
            {Array.from({ length: bands }).map((_, i) => <i key={i} />)}
          </div>
          <i className="ground ground-flat ground-bot" aria-hidden="true" />
          <i className="ground ground-solid ground-fold-bot" aria-hidden="true" />
          <i className="ground ground-solid ground-foot" aria-hidden="true" />

          <header className="leaf leaf-static nav-leaf">
            <a href="#top" className="brand">{NAME}</a>
            <nav className="topnav hero-links">
              <a href={"mailto:" + EMAIL}>Email</a>
              <a href="https://www.linkedin.com/" target="_blank" rel="noopener">LinkedIn</a>
              <a href="https://read.cv/" target="_blank" rel="noopener">Resume</a>
            </nav>
          </header>
          <div className="crease crease-trail" aria-hidden="true"><i className="crease-bar" /></div>

          <section className="leaf leaf-static hero-leaf" id="top">
            <div className="hero-copy">
              <h1 className="hero-line"><span className="nb">Lead Product Designer</span><span className="nb">for <span className="kw">AI</span> &amp; <span className="kw">Social</span> projects</span></h1>
              <span className="pnl-impact hero-impact"><svg className="rule" viewBox="-8 -8 16 16" aria-hidden="true"><circle className="mk-dot" r="2" /><circle className="mk-ring" r="8" /><circle className="mk-ring mk-ring2" r="8" /></svg><span className="hi-text"><span className="nb">Led previous companies to</span> <span className="nb">3 acquisitions &amp; 2 spin-outs.</span></span></span>
            </div>
            <div className="hero-meta">
              <span className="mono hero-loc"><svg className="pin" viewBox="0 0 12 16" aria-hidden="true"><path d="M6 .8c-2.7 0-4.9 2.2-4.9 4.9 0 3.5 4.9 9.5 4.9 9.5s4.9-6 4.9-9.5C10.9 3 8.7.8 6 .8z" /><circle cx="6" cy="5.7" r="1.9" /></svg>Portland, OR<br />Open to Relocation/Remote</span>
            </div>
          </section>
          <div className="crease crease-lead" aria-hidden="true" style={{ "--ink": TINTS[0], "--paper": PAPERS[0] }}><i className="crease-bar" /></div>

          <div className="pleats" id="work">
            {CARDS.map((c, i) => <Pleat card={c} idx={i} key={c.uid} open={open} onToggle={toggleFrom} />)}
          </div>

          <section className="leaf leaf-static about-leaf" id="about">
            <span className="leaf-eyebrow mono about-eyebrow">About</span>
            <div className="about-grid">
              <div className="about-body">
                <ul className="about-list">
                  <li>Most product designers can make an interface look good, especially with AI tools today. Few can sit in a room where engineering, leadership, and users all disagree, and walk out with a plan everyone can build from.</li>
                  <li>I craft unifying strategies, backed by a computer engineering background, research with social scientists on how technology changes behavior, and fifteen years building businesses across web, mobile, XR, and now AI.</li>
                  <li>I don’t just use AI tools to design, I deeply investigate AI models and build the AI tooling.</li>
                  <li>I don’t judge AI as good or bad, I curiously explore what this inevitable technology means for humanity.</li>
                  <li>I treat a wrong assumption as data, not failure, and follow it to where the real value is, even if that reshapes the product’s whole thesis.</li>
                  <li>I design for behavior and the business model, and while I find flow in crafting beautiful interfaces they are ultimately a mediary.</li>
                  <li>I step up to what the product needs, job description or not, because I love what I do and the ownership follows naturally.</li>
                </ul>
              </div>
              <dl className="about-facts">
                {ABOUT_FACTS.map((f) =>
                <div key={f.k}><dt className="mono">{f.k}</dt><dd>{f.v}</dd></div>
                )}
              </dl>
            </div>
          </section>
          <div className="crease crease-lead" aria-hidden="true"><i className="crease-bar" /></div>

          <footer className="leaf leaf-static contact-leaf" id="contact">
            <div className="contact-grid">
              <div className="contact-links">
                <a href={"mailto:" + EMAIL}>Email</a>
                <a href="https://www.linkedin.com/" target="_blank" rel="noopener">LinkedIn</a>
                <a href="https://read.cv/" target="_blank" rel="noopener">Resume</a>
              </div>
            </div>
            <div className="contact-base mono">© {new Date().getFullYear()} <span className="cb-name">{NAME}</span></div>
          </footer>
        </div>
      </div>
    </section>);

}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  useEffect(() => {document.title = NAME + " \u2014 Product Design";}, []);
  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty("--accent", ACCENTS[t.accent] || ACCENTS.Clay);
    r.style.setProperty("--font-display", DISPLAY_FONTS[t.displayFont] || DISPLAY_FONTS.Amethysta);
    const tone = BG_TONES[t.bgTone] || BG_TONES.Warm;
    r.style.setProperty("--bg", tone.bg);
    r.style.setProperty("--surface", tone.surface);
    r.style.setProperty("--radius", t.corners === "sharp" ? "0px" : t.corners === "round" ? "14px" : "4px");
    r.dataset.reelFx = REEL_FX[t.reelFx] || "slip";
  }, [t]);
  return (
    <>
      <main><PaperWork /></main>
      <TweaksPanel>
        <TweakSection label="Accent" />
        <TweakColor label="Accent color" value={ACCENTS[t.accent]} options={Object.values(ACCENTS)}
        onChange={(v) => setTweak("accent", Object.keys(ACCENTS).find((k) => ACCENTS[k] === v) || "Clay")} />
        <TweakSection label="Typography" />
        <TweakSelect label="Headline font" value={t.displayFont} options={Object.keys(DISPLAY_FONTS)}
        onChange={(v) => setTweak("displayFont", v)} />
        <TweakSection label="Surface" />
        <TweakSelect label="Background tone" value={t.bgTone} options={Object.keys(BG_TONES)}
        onChange={(v) => setTweak("bgTone", v)} />
        <TweakRadio label="Image corners" value={t.corners} options={["sharp", "soft", "round"]}
        onChange={(v) => setTweak("corners", v)} />
        <TweakSection label="Slideshows" />
        <TweakSelect label="Slide transition" value={t.reelFx} options={Object.keys(REEL_FX)}
        onChange={(v) => setTweak("reelFx", v)} />
      </TweaksPanel>
    </>);
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);