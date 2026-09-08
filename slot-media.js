/* every dropped image, exported to a real file in the project so the page
   no longer depends on the session sidecar. slot id -> file. */
window.SLOT_IMAGES = {
  "meta-genai-process": "media/meta-genai-process.webp",
  "meta-genai-problem": "media/meta-genai-problem.webp",
  "meta-genai-solution-1": "media/meta-genai-solution-1.webp",
  "meta-genai-impact": "media/meta-genai-impact.webp",
  "meta-genai-solution-2": "media/meta-genai-solution-2.webp",
  "meta-genai-car-1": "media/meta-genai-car-1.webp",
  "meta-genai-car-0": "media/meta-genai-car-0.webp",
  "meta-genai-car-2": "media/meta-genai-car-2.webp",
  "meta-genai-solution": "media/meta-genai-solution.webp",
  "wsj-immersed-problem-1": "media/wsj-immersed-problem-1.webp",
  "wsj-immersed-process": "media/wsj-immersed-process.webp",
  "case-study-five-car-0": "media/wsj3-car-0.webp",
  "case-study-five-car-3": "media/wsj3-car-3.webp",
  "case-study-five-car-1": "media/wsj3-car-1.webp",
  "case-study-five-problem": "media/wsj3-problem.webp",
  "case-study-five-process": "media/wsj3-process.webp",
  "case-study-five-process-1": "media/wsj3-process-1.webp",
  "case-study-five-process-2": "media/wsj3-process-2.webp",
  "case-study-five-solution": "media/wsj3-solution.webp",
  "case-study-five-solution-1": "media/wsj3-solution-1.webp",
  "case-study-five-solution-2": "media/wsj3-solution-2.webp",
  "wonderscope-problem-1": "media/wonderscope-problem-1.webp",
  "wonderscope-process": "media/wonderscope-process.webp",
  "wonderscope-process-1": "media/wonderscope-process-1.webp",
  "wonderscope-process-2": "media/wonderscope-process-2.webp",
  "wonderscope-solution": "media/wonderscope-solution.webp",
  "wonderscope-solution-1": "media/wonderscope-solution-1.webp",
  "wonderscope-solution-2": "media/wonderscope-solution-2.webp",
  "wonderscope-solution-3": "media/wonderscope-solution-3.webp",
  "wonderscope-impact": "media/wonderscope-impact.webp",
  "wonderscope-impact-1": "media/wonderscope-impact-1.webp",
  "wonderscope-impact-2": "media/wonderscope-impact-2.webp"
};

/* Clear on a file-backed slot: image-slot's clear only drops the dropped value
   and then falls back to src=, so the picture came straight back. Watch for the
   clear (the slot loses data-filled while its src still points at a file) and
   pull the src too, for this session. */
addEventListener('pointerdown', (e) => {
  const b = e.target.closest && e.target.closest('button[data-act="clear"]');
  const root = b && b.getRootNode();
  const slot = root && root.host;
  if (!slot || slot.tagName !== 'IMAGE-SLOT' || !slot.getAttribute('src')) return;
  slot._omFileSrc = slot.getAttribute('src');
  if (slot.id && window.SLOT_IMAGES) delete window.SLOT_IMAGES[slot.id];
  setTimeout(() => slot.removeAttribute('src'), 0);
}, true);
