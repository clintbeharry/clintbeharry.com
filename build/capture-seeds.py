#!/usr/bin/env python3
"""
Record questions for into-the-network/, using a local copy of the model.

    python build/capture-seeds.py "Why is the sky blue?" "What makes bread rise?"

Reads the ONNX export and the tokenizer from a folder on disk. Nothing is
downloaded, which is the point: huggingface.co is unreachable from the
sandboxes this project is built in, and it needs to be reachable from
nowhere at all.

    --model PATH   the model folder, default ./models/smol360 or $SMOL360.
                   It needs tokenizer.json and onnx/model_q4f16.onnx.
    --out PATH     where to write, default build/into-the-network/seeds.js
    --seed N       decode seed, default 7

Needs: numpy, onnxruntime, tokenizers, onnx, wordfreq.

Two kinds of data come out of this, and they are not the same quality as
what a browser can produce. The reply is the model's own next-token
distribution either way. The NEIGHBOURHOODS are the difference: here the
real embedding matrix is on disk, so a word's neighbours are its actual
nearest neighbours in that matrix. In a browser that matrix is not
reachable, and the page falls back to measuring something else.

Run build/build-into-the-network.py afterwards to fold the result into
the page.
"""
import json, math, os, re, sys, time
import numpy as np, onnxruntime as ort
from tokenizers import Tokenizer

def _model_dir():
    """--model wins, then $SMOL360, then a models/smol360 next to the repo.
       Read before the model is loaded, which is why it is not in argparse."""
    for i, a in enumerate(sys.argv):
        if a == "--model" and i + 1 < len(sys.argv):
            d = sys.argv[i + 1]; del sys.argv[i:i + 2]; return d
        if a.startswith("--model="):
            d = a.split("=", 1)[1]; sys.argv.remove(a); return d
    return os.environ.get("SMOL360", "models/smol360")


M      = _model_dir()
if not os.path.isdir(M):
    raise SystemExit("no model folder at %r. Pass --model PATH, or set SMOL360." % M)
SYSTEM = "You are a helpful assistant."
TEMP, TOP_P, MIN_NEW, MAX_NEW = 0.7, 0.92, 20, 88
ASSOC_SHOW, ASSOC_POOL, ASSOC_WORDS = 13, 45, 12
REPLY_STEPS, CAND_SHOW, EMERGE_SHOW = 6, 13, 12

WORD  = re.compile(r"^[A-Za-z][A-Za-z'-]{1,}$")
TYPED = re.compile(r"^[A-Za-z][A-Za-z'-]*$")
is_word, is_typed = lambda w: bool(WORD.match(w)), lambda w: bool(TYPED.match(w))
STOP = set("""a an the is are was were be been being am of to in on at by for with from into over
under about as it its this that these those there here and or but not no so such then than you
your yours we our they them their he she his her i me my if when while how why what which who whom
can could will would shall should may might must do does did done have has had get got make makes
made very just only also more most other others some any each all both much many""".split())

def embedding_matrix(model_dir):
    """The input embedding table, read straight out of the ONNX graph.

    It is an initializer in the exported model, so no separate download and
    no PyTorch checkpoint is needed. Taken from the q4f16 export, where this
    one tensor is left at fp16 rather than quantized, because quantizing it
    wrecks the output distribution."""
    import onnx
    from onnx import numpy_helper
    m = onnx.load(os.path.join(model_dir, "onnx", "model_q4f16.onnx"))
    for init in m.graph.initializer:
        if len(init.dims) == 2 and 40000 < init.dims[0] < 60000:
            return numpy_helper.to_array(init).astype(np.float32)
    raise SystemExit("no vocabulary-sized tensor in the graph; wrong model?")


tok = Tokenizer.from_file(M + "/tokenizer.json")
EOS = 2                                    # <|im_end|>
emb = embedding_matrix(M)
embn = emb / np.maximum(np.linalg.norm(emb, axis=1, keepdims=True), 1e-9)

# Only tokens that stand as a word on their own. Matching every token pulled
# in mid-word fragments ("Ther", "pr", "PRI") and rare junk with interior
# capitals ("ManagementPlaneProtection"), all of which sit near in embedding
# space and say nothing as a neighbour. A leading U+0120 is this tokenizer's
# mark for "this piece begins a word".
GMARK = chr(0x120)
# Lowercase only, and a word people actually use. "Ther", "Aqu" and "PRI"
# are word-initial tokens that are not words; capitalisation is what gives
# most of them away, and an English frequency list catches the rest. The
# cost is a handful of legitimate proper nouns, which read oddly as
# neighbours anyway.
from wordfreq import top_n_list
REAL = set(top_n_list("en", 40000))
STANDALONE = re.compile(r"^[a-z][a-z'-]{2,}$")
vocab_words = {}
for w, i in tok.get_vocab().items():
    if not w.startswith(GMARK):
        continue
    t = w[1:]
    if STANDALONE.match(t) and t in REAL:
        vocab_words[i] = t

so = ort.SessionOptions(); so.log_severity_level = 3
sess = ort.InferenceSession(os.path.join(M, "onnx", "model_q4f16.onnx"), so,
                            providers=["CPUExecutionProvider"])
NL = sum(1 for i in sess.get_inputs() if i.name.endswith(".key"))
KH, HD = 5, 64

def ends_sentence(t):
    return bool(re.search(r'[.!?]["\')\]]?\s*$', t)) and not re.search(r'\d[.]\s*$', t) \
           and not re.search(r'\b[A-Za-z][.]\s*$', t)

def whole_sentences(t):
    m = list(re.finditer(r'[.!?]["\')\]]?(?=\s|$)', t))
    return t[:m[-1].end()].strip() if m else t.strip()

def generate(text, seed):
    rng = np.random.default_rng(seed)
    prompt = ("<|im_start|>system\n" + SYSTEM + "<|im_end|>\n"
              "<|im_start|>user\n" + text + "<|im_end|>\n<|im_start|>assistant\n")
    ids = tok.encode(prompt, add_special_tokens=False).ids
    past = {f"past_key_values.{i}.{k}": np.zeros((1, KH, 0, HD), np.float16)
            for i in range(NL) for k in ("key", "value")}
    cur, pos, steps = np.array([ids], np.int64), len(ids), []
    while len(steps) < MAX_NEW:
        n = cur.shape[1]
        feed = {"input_ids": cur,
                "attention_mask": np.ones((1, pos), np.int64),
                "position_ids": np.arange(pos - n, pos, dtype=np.int64)[None], **past}
        out = sess.run(None, feed)
        names = [o.name for o in sess.get_outputs()]
        logits = out[0][0, -1].astype(np.float32)
        past = {("past_key_values." + names[j].split(".", 1)[1]): out[j]
                for j in range(1, len(names))}
        # nucleus sampling at temperature, over the whole distribution
        z = logits - logits.max()
        p = np.exp(z / TEMP); p /= p.sum()
        order = np.argsort(-p)
        keep = int(np.searchsorted(np.cumsum(p[order]), TOP_P)) + 1
        pick = int(order[rng.choice(keep, p=p[order][:keep] / p[order][:keep].sum())])
        piece = tok.decode([pick], skip_special_tokens=False)
        if pick == EOS or (piece.startswith("<|") and piece.endswith("|>")):
            break
        pr = np.exp(z); pr /= pr.sum()           # the model's own probabilities
        top = np.argsort(-pr)[:60]
        cands = []
        for i in top:
            w = tok.decode([int(i)], skip_special_tokens=False)
            if "�" in w or int(i) == pick: continue
            cands.append({"w": w, "p": round(float(pr[i]), 6)})
            if len(cands) >= CAND_SHOW: break
        steps.append({"tok": piece, "p": round(float(pr[pick]), 6), "cands": cands})
        cur, pos = np.array([[pick]], np.int64), pos + 1
        if len(steps) >= MIN_NEW and ends_sentence("".join(s["tok"] for s in steps)):
            break
    return steps

def group_words(steps):
    runs = []
    for st in steps:
        if not runs or st["tok"][:1].isspace() or st["tok"][:1] in ",.;:!?)]": runs.append([st])
        else: runs[-1].append(st)
    out = []
    for g in runs:
        first = g[0]
        # A run that is nothing but whitespace is not a word. Falling back to
        # the raw token kept its space, which is exactly what this is meant to
        # remove, so such a run is dropped rather than patched up.
        text = "".join(x["tok"] for x in g).strip()
        if not text: continue
        seen, field = {text.lower()}, []
        for c in first["cands"]:
            w = c["w"].strip()
            if not w or w.lower() in seen: continue
            seen.add(w.lower()); field.append({"w": w, "p": c["p"]})
        out.append({"tok": text, "cands": ([{"w": text, "p": first["p"]}] + field)[:CAND_SHOW]})
    return out

def pca2(X):
    X = X - X.mean(0, keepdims=True)
    U, S, V = np.linalg.svd(X, full_matrices=False)
    return X @ V[:2].T

def neighbourhood(word):
    ids = tok.encode(" " + word, add_special_tokens=False).ids or \
          tok.encode(word, add_special_tokens=False).ids
    if not ids: return []
    v = emb[ids].mean(0); n = np.linalg.norm(v)
    if n == 0: return []
    sims = embn @ (v / n)
    picked, seen = [], {word.lower()}
    for idx in np.argsort(-sims):
        w = vocab_words.get(int(idx))
        if not w or w.lower() in seen: continue
        # a word's own inflections are not a neighbourhood: heat, heated and
        # heating say nothing heat does not. Variants of OTHER words are fine.
        a, b = w.lower(), word.lower()
        if a.startswith(b) or b.startswith(a): continue
        seen.add(w.lower()); picked.append((int(idx), w, float(sims[idx])))
        if len(picked) >= ASSOC_POOL: break
    if not picked: return []
    P = pca2(np.stack([emb[i] for i, _, _ in picked]))
    lo = min(s for _, _, s in picked); hi = max(s for _, _, s in picked)
    span = (hi - lo) or 1.0
    sect = {}
    for k, (idx, w, s) in enumerate(picked):
        ang = math.atan2(float(P[k][1]), float(P[k][0]))
        i = int((ang + math.pi) / (2 * math.pi) * ASSOC_SHOW) % ASSOC_SHOW
        if i not in sect or s > sect[i][2]: sect[i] = (ang, w, s)
    out = []
    for i in sorted(sect):
        ang, w, s = sect[i]
        r = 0.12 + (1 - (s - lo) / span) * 0.80
        out.append({"w": w, "xy": [round(math.cos(ang) * r, 3), round(math.sin(ang) * r, 3)]})
    return out[:ASSOC_SHOW]

def capture(text, seed=7):
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z'-]*", text) if is_typed(w)][:ASSOC_WORDS]
    q = [{"w": w, "assoc": a} for w in words for a in [neighbourhood(w)] if a]
    steps = generate(text, seed)
    said = whole_sentences("".join(s["tok"] for s in steps))
    asked = {w.lower() for w in words}
    em, seen = [], set()
    for raw in re.findall(r"[A-Za-z][A-Za-z'-]*", said) + \
               [c["w"] for s in steps for c in s["cands"]]:
        w = raw.strip(); k = w.lower()
        if not is_word(w) or k in asked or k in seen or k in STOP: continue
        seen.add(k); em.append(w)
        if len(em) >= EMERGE_SHOW: break
    g = {"prompt": text, "q": q, "emerge": em,
         "reply": group_words(steps)[:REPLY_STEPS], "said": said}
    assert g["q"] and all(x["assoc"] for x in g["q"]), "a question word has no neighbours"
    for r in g["reply"]:
        assert r["cands"][0]["w"] == r["tok"], "the word taken is not first in its field"
        assert all(c["w"] == c["w"].strip() for c in r["cands"]), "a candidate kept its space"
    for x in g["q"]:
        for a in x["assoc"]:
            assert math.hypot(*a["xy"]) <= 1.0, "a neighbour sits outside the unit circle"
    return g

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("questions", nargs="+")
    ap.add_argument("--out", default="build/into-the-network/seeds.js")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    out = []
    for text in args.questions:
        t0 = time.time()
        g = capture(text, args.seed)
        out.append(g)
        print("%-38s %5.1fs  %d words  %s" %
              (text, time.time() - t0, len(g["q"]), g["said"][:44]), flush=True)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("window.SEEDS=" + json.dumps(out, separators=(",", ":")) + ";\n")
    print("wrote %s  (%d questions, %.0fKB)" %
          (args.out, len(out), os.path.getsize(args.out) / 1024))
    print("now run:  python build/build-into-the-network.py")
