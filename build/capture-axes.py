#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Clint Beharry
"""
Give step three four real sets of axes instead of one rearranged twice.

    python build/capture-axes.py --seeds build/into-the-network/seeds.js

The recording carried one two-dimensional projection per word, and the page
drew it four times under four different layout rules while captioning them
"dimensions 1-3", "4-6", "7-9" and "10-12". The views differed; the numbers
behind them did not. This writes the numbers.

Every word the cloud shows (the question's own words, every neighbour of
each, and the words the answer reached for) is embedded, the whole set is
centred and decomposed once, and each word is projected onto principal
components 1-3, 4-6, 7-9 and 10-12. Four views, four genuinely different
readings of the same 960 numbers, and the caption arc the piece already has
becomes true rather than decorative: the first components separate things
cleanly, and by the tenth there is nearly nothing left to separate them by.

Components rather than raw axes on purpose. A single raw dimension of an
embedding matrix is not a thing anybody has an interpretation of, and a few
of them carry outlier magnitudes that would flatten every view they appear
in. Components are ordered by how much of the variance they explain, which
is exactly the quantity the four captions are claiming to walk down.

    --seeds PATH   the recording to add axes to, read and rewritten in place
    --model PATH   the model folder, default ./models/smol360 or $SMOL360

Only adds. The replies, the fields and the neighbourhoods are untouched, so
the branch files keep lining up with the answers they grew out of.
"""
import json, os, re, sys
import numpy as np
from tokenizers import Tokenizer


def _arg(flag, default):
    for i, a in enumerate(sys.argv):
        if a == flag and i + 1 < len(sys.argv):
            v = sys.argv[i + 1]; del sys.argv[i:i + 2]; return v
        if a.startswith(flag + "="):
            v = a.split("=", 1)[1]; sys.argv.remove(a); return v
    return default


M = _arg("--model", os.environ.get("SMOL360", "models/smol360"))
SEEDS = _arg("--seeds", "build/into-the-network/seeds.js")
TRIPLES = 4                 # how many views step three walks through
DIMS = TRIPLES * 3

if not os.path.isdir(M):
    raise SystemExit("no model folder at %r. Pass --model PATH, or set SMOL360." % M)

tok = Tokenizer.from_file(os.path.join(M, "tokenizer.json"))


def embedding_matrix(model_dir):
    """The input embedding table, straight out of the ONNX graph, exactly as
       capture-seeds.py reads it: an initializer, no checkpoint needed."""
    import onnx
    from onnx import numpy_helper
    m = onnx.load(os.path.join(model_dir, "onnx", "model_q4f16.onnx"))
    for init in m.graph.initializer:
        if len(init.dims) == 2 and 40000 < init.dims[0] < 60000:
            return numpy_helper.to_array(init).astype(np.float32)
    raise SystemExit("no vocabulary-sized tensor in the graph; wrong model?")


emb = embedding_matrix(M)


def vec(word):
    ids = tok.encode(" " + word, add_special_tokens=False).ids or \
          tok.encode(word, add_special_tokens=False).ids
    return emb[ids].mean(0) if ids else None


WORDY = re.compile(r"^[A-Za-z][A-Za-z'-]{1,}$")


def cloud_words(g):
    """The same set the page builds, in the same order: the question's words,
       then every neighbour of each, then the pool the answer draws on."""
    out, seen = [], set()
    def take(w, force=False):
        w = (w or "").strip()
        k = w.lower()
        if not w or k in seen: return
        if not force and not WORDY.match(w): return
        seen.add(k); out.append(w)
    for d in g["q"]:
        take(d["w"], True)
    for d in g["q"]:
        for a in d["assoc"]:
            take(a["w"], True)
    for w in g.get("emerge", []):
        take(w)
    for r in g["reply"]:
        for c in r["cands"]:
            take(c["w"])
    return out


def axes_for(g):
    words = cloud_words(g)
    keep, V = [], []
    for w in words:
        v = vec(w)
        if v is not None:
            keep.append(w); V.append(v)
    X = np.stack(V)
    X = X - X.mean(0, keepdims=True)
    # one decomposition for the whole cloud, so the four views are four slices
    # of the same reading rather than four unrelated pictures
    _, S, Vt = np.linalg.svd(X, full_matrices=False)
    P = X @ Vt[:DIMS].T
    # each view normalised on its own, or components 10-12 would be a dot in
    # the middle of a box sized for components 1-3
    out = {}
    scale = []
    for t in range(TRIPLES):
        blk = P[:, t * 3:(t + 1) * 3]
        s = np.percentile(np.abs(blk), 96) or 1.0
        scale.append(float(s))
        P[:, t * 3:(t + 1) * 3] = np.clip(blk / s, -1.15, 1.15)
    for i, w in enumerate(keep):
        # two decimals: the box is a few hundred units across, so the third
        # is below a pixel and only costs the page weight
        out[w] = [round(float(x), 2) for x in P[i]]
    var = (S ** 2) / float((S ** 2).sum())
    share = [round(float(var[t * 3:(t + 1) * 3].sum()), 4) for t in range(TRIPLES)]
    return out, share


if __name__ == "__main__":
    src = open(SEEDS, encoding="utf-8").read()
    head = src[:src.index("=") + 1]
    seeds = json.loads(src[src.index("=") + 1:].rstrip().rstrip(";"))

    for g in seeds:
        ax, share = axes_for(g)
        g["axes"] = ax
        g["var"] = share
        print("%-40s %4d words  variance per view %s"
              % (g["prompt"][:40], len(ax),
                 " ".join("%.1f%%" % (s * 100) for s in share)), flush=True)

    with open(SEEDS, "w", encoding="utf-8") as f:
        f.write(head + json.dumps(seeds, separators=(",", ":")) + ";\n")
    print("rewrote %s  (%.0fKB)" % (SEEDS, os.path.getsize(SEEDS) / 1024))
