# clintbeharry.com

Personal site, and the home of **Word Network**, an interactive explanation of
how language models generate text.

---

## Word Network

Generative models present finished things. These pieces show the field of
possibilities each finished thing was drawn from, using the model's own
numbers, running in the visitor's own browser. No server, no API key, nothing
sent anywhere.

Both pieces run `SmolLM2-360M-Instruct` as a quantized ONNX export, about
270MB, fetched once and cached by the browser. Suggested questions are
pre-recorded and play immediately with no download at all.

### Episode 1 · What It Almost Said

**[clintbeharry.com/word-network/](https://clintbeharry.com/word-network/)**

A reply is built one word at a time. At each position the field of candidates
opens below the line and the word taken rises out of it. Timing carries
meaning: a word the model was certain of appears instantly, an uncertain one
holds long enough that its alternatives can be read, so the pace of a sentence
becomes a readout of hesitation.

Words the person typed are weighted by removing each one and re-running the
real reply, so the influence shown is causal rather than correlational.

- [`word-network/live.js`](word-network/live.js) · inference and the
  leave-one-out measurement
- [`word-network/index.html`](word-network/index.html) · the page
- `word-network/runs.js` · recorded model output (generated data)

### Episode 2 · Into the Network

**[clintbeharry.com/into-the-network/](https://clintbeharry.com/into-the-network/)**

A five-step sequence taking a question all the way through: the words arrive
and are located in the embedding space, each reaches into its own
neighbourhood, the network wires itself and is re-projected, it compresses into
a blinking cursor, and the reply writes itself into the thread with every word
still carrying the field it came from.

The finished answer stays explorable. Dragging along it swells the words back
open around your finger, restoring the alternatives and their percentages.

- [`into-the-network/live.js`](into-the-network/live.js) · a hand-written
  decode loop, because `generate()` does not return logits and the logits are
  the entire piece. One forward pass per word, KV cache threaded by hand, the
  full distribution read at every position before anything is sampled.
- [`build/into-the-network/engine.js`](build/into-the-network/engine.js) · the
  visualization: layout, the five steps, the fold into the cursor
- [`build/into-the-network/app.js`](build/into-the-network/app.js) · the chat
  interface and the word-by-word writer
- [`build/into-the-network/shell.html`](build/into-the-network/shell.html) ·
  page shell and styles
- `build/into-the-network/seeds.js` · recorded questions (generated data)

### What is real, and what is staging

Stated on the pages themselves, because the distinction is the point.

**Real:** the candidate words and their shares, from the model's full
distribution over all 49,152 tokens rather than a shortlist. The neighbourhoods
in recorded questions, which are nearest neighbours in the actual embedding
matrix, sampled one per direction so the whole neighbourhood shows rather than
its densest side. The four sets of axes in step three, which are principal
components 1-3, 4-6, 7-9 and 10-12 of the whole cloud's embeddings, with the
share of the variance each one carries printed in its own caption. The
branches, which are real continuations from a forced token. The surprisal
figures. The leave-one-out word weights.

**Staging:** the box, the collapse into the cursor, the spreading front. These
are devices for legibility and are named as such on the page.

### Building it

```
python build/capture-seeds.py    --model <a local SmolLM2 export> "Your question?"
python build/capture-axes.py     --model <a local SmolLM2 export>
python build/capture-branches.py --model <a local SmolLM2 export>
python build/build-into-the-network.py
```

`capture-seeds.py` records a question offline against a local copy of the
model, reading the ONNX export and the tokenizer from disk so nothing is
downloaded. It pulls the embedding matrix straight out of the ONNX graph as an
initializer, so no PyTorch checkpoint is needed either.
`capture-axes.py` decomposes the whole cloud once and writes each word's
position on principal components 1 through 12, which is what step three's four
views read. `capture-branches.py` forces each of the likeliest words the model
did not use into its place and lets the model carry on, which is what makes the
finished answer forkable without a download.
`build-into-the-network.py` inlines the sources into the published page.

### Built with

- [SmolLM2-360M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct)
  by Hugging Face, Apache-2.0. Fetched by the visitor's browser at runtime; no
  weights are stored in this repository.
- [Transformers.js](https://github.com/huggingface/transformers.js), Apache-2.0,
  loaded from a CDN at runtime.
- [three.js](https://threejs.org), MIT, loaded from a CDN at runtime.

The recorded data files (`runs.js`, `seeds.js`) are output produced by running
SmolLM2 and are included so the pages work without a download.

---

## License

The code in this repository is released under the MIT License (see
[LICENSE](LICENSE)). That covers:

- `into-the-network/`
- `word-network/`
- `build/`

**Not covered:** the personal and portfolio content of the site, which remains
© 2026 Clint Beharry, all rights reserved. That includes
`clintbeharry-resume.pdf`, the written portfolio copy in `data.js`, and the
images and video under `media/`, along with `og-image.png` and
`apple-touch-icon.png`.

Third-party components keep their own licenses, listed under "Built with"
above. None are vendored into this repository; all are fetched at runtime.
