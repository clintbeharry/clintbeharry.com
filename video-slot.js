/* Video support for <image-slot>.

   Two paths, because the slot's persistence channel caps out around a couple
   of MB — far too small for an mp4 baked in as a data URL:

   1. DECLARED (persistent). window.SLOT_VIDEOS maps a slot id to a video file
      in the project: { "wonderscope-car-0": "media/wonderscope.mp4" }. These
      mount on load and survive reloads, shares, and exports.
   2. DROPPED (session only). Drop an mp4/webm/mov on a slot and it plays
      immediately from an object URL so you can check the crop and timing —
      but it is gone on reload. To keep it, hand the file over and it gets
      added to the project and declared in SLOT_VIDEOS.

   Either way it mounts muted, looping, and autoplaying over the slot's frame. */
(() => {
  const OK = /^video\/(mp4|webm|quicktime|x-m4v)$/i;
  // Production ("data-static" on <html>): no design-tool host is ever
  // present, so the Replace/Clear authoring controls and the file-drop
  // capture listener are dead chrome — this flag turns them off.
  const STATIC = document.documentElement.hasAttribute('data-static');
  const session = {};                       // slot id -> object URL
  const hidden = {};                        // slot id -> video suppressed this session

  const declared = () => window.SLOT_VIDEOS || {};
  const srcFor = (id) => hidden[id] ? null : session[id] || declared()[id] || null;

  const style = document.createElement('style');
  style.textContent =
    '.vslot{position:absolute;inset:0;z-index:4}' +
    '.vslot video{display:block;width:100%;height:100%;object-fit:contain;object-position:top center}' +
    '.vslot .vslot-ctl{position:absolute;top:8px;right:8px;z-index:22;display:flex;gap:6px;opacity:0;' +
    'transition:opacity .12s}' +
    '.vslot:hover .vslot-ctl,.preel:hover .vslot-ctl{opacity:1}' +
    '.vslot button{appearance:none;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;' +
    'background:rgba(0,0,0,.65);color:#fff;font:11px/1 system-ui,sans-serif}' +
    '.vslot .tag{border-radius:6px;padding:5px 8px;background:rgba(0,0,0,.6);color:#fff;' +
    'font:10px/1.2 system-ui,sans-serif;pointer-events:none}' +
    '.vslot-note{position:absolute;left:8px;bottom:8px;z-index:7;max-width:calc(100% - 16px);' +
    'color:#3b3a36;font:11px/1.35 system-ui,sans-serif;background:rgba(255,255,255,.9);' +
    'padding:5px 7px;border-radius:5px;pointer-events:none}';
  document.head.appendChild(style);

  function host(slot) {
    const p = slot.parentElement;
    if (!p) return null;
    if (getComputedStyle(p).position === 'static') p.style.position = 'relative';
    return p;
  }

  /* image-slot recomputes data-filled on its own renders, and the reel's
     cross-fade reads it — keep it pinned while a video owns the slot */
  function pin(slot) {
    if (slot._vsPinned) return;
    slot._vsPinned = new MutationObserver(() => {
      if (srcFor(slot.id) && !slot.hasAttribute('data-filled')) slot.setAttribute('data-filled', '');
    });
    slot._vsPinned.observe(slot, { attributes: true, attributeFilter: ['data-filled'] });
  }

  function mount(slot) {
    const url = srcFor(slot.id);
    const h = host(slot);
    if (!h) return;
    let wrap = h.querySelector(':scope > .vslot');
    if (!url) {
      if (wrap) wrap.remove();
      if (slot._vsPinned) { slot._vsPinned.disconnect(); slot._vsPinned = null; }
      if (slot._vsIO) { slot._vsIO.disconnect(); slot._vsIO = null; }
      return;
    }
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'vslot';
      const v = document.createElement('video');
      v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
      v.preload = 'metadata';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      wrap.appendChild(v);
      const ctl = document.createElement('div');
      ctl.className = 'vslot-ctl';
      wrap.appendChild(ctl);
      h.appendChild(wrap);
    }
    const v = wrap.querySelector('video');
    if (v.getAttribute('src') !== url) { v.src = url; v.play().catch(() => {}); }
    /* decode only what's worth decoding. two gates, both cheap:
         1. off-screen (with a 300px lead-in so it's already running by the time
            it scrolls in — the earlier stutter came from gating too tightly)
         2. inside a collapsed case study, whose body has no laid-out height
       the observer is attached ONCE per slot; mount() runs on every mutation. */
    if (!slot._vsIO && 'IntersectionObserver' in window) {
      slot._vsIO = new IntersectionObserver((es) => {
        es.forEach((e) => { slot._vsNear = e.isIntersecting; sync(slot); });
      }, { rootMargin: '0px' });
      slot._vsIO.observe(slot);
      slot._vsNear = true;
    }
    sync(slot);
    const ctl = wrap.querySelector('.vslot-ctl');
    /* CRITICAL: build the controls ONCE and leave the nodes alone. mount() runs
       on every DOM mutation (the page animates constantly), and rebuilding the
       buttons between mousedown and mouseup swallowed the click entirely. */
    const temp = !!session[slot.id];
    // Production: no design-tool host, so Replace/Clear (and the "preview
    // only" tag) are authoring chrome with nothing behind them — skip
    // building the controls at all.
    if (!STATIC && !ctl._built) {
      ctl._built = true;
      const tag = document.createElement('span');
      tag.className = 'tag'; tag.textContent = 'Preview only — not saved';
      ctl.appendChild(tag);
      ctl._tag = tag;
      /* every video — declared or dropped — gets the same two controls, so the
         slot never looks locked: Replace picks a new file for this session,
         Clear steps the video aside and hands the frame back to <image-slot>
         (its own Browse / Edit / Replace controls then work as usual). */
      const btn = (label, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label;
        /* pointerdown, not click: the sheet's own tap detection and React's
           re-renders can tear the frame down before a click completes */
        b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); fn(); });
        b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); });
        ctl.appendChild(b);
      };
      btn('Replace', () => pick(slot));
      btn('Clear', () => {
        if (session[slot.id]) { URL.revokeObjectURL(session[slot.id]); delete session[slot.id]; }
        if (declared()[slot.id]) hidden[slot.id] = true;
        slot.removeAttribute('data-filled');
        mount(slot);
      });
    }
    if (ctl._tag) ctl._tag.style.display = temp ? '' : 'none';
    slot.setAttribute('data-filled', '');
    pin(slot);
  }

  /* play/pause to match visibility. a collapsed panel's body reports no height,
     which is the same signal the accordion itself animates on. */
  function sync(slot) {
    const h = host(slot);
    const v = h && h.querySelector(':scope > .vslot video');
    if (!v) return;
    const body = slot.closest('.pnl-body');
    const open = !body || body.getBoundingClientRect().height > 4;
    const want = slot._vsNear !== false && open;
    if (want && v.paused) v.play().catch(() => {});
    else if (!want && !v.paused) v.pause();
  }

  /* the accordion animates height, so re-check a beat after any toggle */
  document.addEventListener('click', () => {
    setTimeout(() => document.querySelectorAll('image-slot').forEach(sync), 900);
  }, true);

  /* file picker for Replace — same session-only path as a drop */
  function pick(slot) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'video/*,image/*';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      if (!OK.test(f.type)) {                 // an image: hand the frame back to the slot
        hidden[slot.id] = true;
        if (session[slot.id]) { URL.revokeObjectURL(session[slot.id]); delete session[slot.id]; }
        mount(slot);
        note(slot, 'Cleared the video — drop “' + f.name + '” on the frame to use it as a still.');
        return;
      }
      delete hidden[slot.id];
      if (session[slot.id]) URL.revokeObjectURL(session[slot.id]);
      session[slot.id] = URL.createObjectURL(f);
      mount(slot);
      note(slot, 'Playing “' + f.name + '” for this session. Send me the file to store it here permanently.');
    });
    inp.click();
  }

  function renderAll() {
    document.querySelectorAll('image-slot').forEach((s) => { if (s.id) mount(s); });
  }

  function note(slot, msg) {
    const h = host(slot);
    if (!h) return;
    const d = document.createElement('div');
    d.className = 'vslot-note'; d.textContent = msg;
    h.appendChild(d);
    setTimeout(() => d.remove(), 6000);
  }

  /* capture phase: a video file never reaches image-slot's own drop handler */
  if (!STATIC) document.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !OK.test(f.type)) return;
    const path = e.composedPath ? e.composedPath() : [e.target];
    const slot = path.find((n) => n && n.tagName === 'IMAGE-SLOT');
    if (!slot) return;
    e.preventDefault(); e.stopPropagation();
    slot.removeAttribute('data-over');
    if (!slot.id) return;
    if (session[slot.id]) URL.revokeObjectURL(session[slot.id]);
    delete hidden[slot.id];
    session[slot.id] = URL.createObjectURL(f);
    mount(slot);
    note(slot, 'Playing “' + f.name + '” for this session. Send me the file to store it here permanently.');
  }, true);

  let pending = 0;
  new MutationObserver(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; renderAll(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.mountSlotVideos = renderAll;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderAll);
  } else renderAll();
})();
