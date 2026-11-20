#!/usr/bin/env python3
"""
Capture recorded questions for into-the-network/.

Run this anywhere with normal internet and a few GB of disk:

    pip install torch transformers
    python build/capture-seeds.py "Why is the sky blue?" "What makes bread rise?"

It writes into-the-network/seeds.js. Questions already in that file are kept
unless you pass --replace, so you can add one at a time.

WHY THIS EXISTS
---------------
The page can answer anything typed into it, by running the model in the
visitor's own browser. That costs a 300MB download before the first answer.
Most visitors will click a suggested question, watch, and leave, so the
recorded questions are what the page actually shows most people, and they
need to play instantly.

A capture also does something the live path cannot. Here we have the real
embedding matrix, so a word's neighbours are its actual nearest neighbours in
that matrix and their directions come from a projection of it. In the browser
that table is not available, so the live path measures something else (how
strongly each of your words predicts a candidate). Both are honest; this one
is the stronger claim, and it is the one the page's "what is real here" line
describes when it plays a recorded run.

DECODE SETTINGS
---------------
Deliberately identical to into-the-network/live.js, so a recorded answer and
a live one are the same kind of object and hesitate in the same way. If you
change them there, change them here.
"""

import argparse, json, math, os, re, sys

MODEL      = "HuggingFaceTB/SmolLM2-360M-Instruct"
SYSTEM     = "You are a helpful assistant."
TEMP       = 0.7
TOP_P      = 0.92
MIN_NEW    = 20
MAX_NEW    = 88

ASSOC_SHOW   = 13    # neighbours kept per question word
ASSOC_POOL   = 45    # nearest neighbours considered before sampling by direction
ASSOC_WORDS  = 9     # question words the sequence can seat on its line
REPLY_STEPS  = 6     # words step five animates; the rest is printed under it
CAND_SHOW    = 13    # candidates kept per reply step
EMERGE_SHOW  = 12

STOP = set("""a an the is are was were be been being am of to in on at by for with from into
over under about as it its this that these those there here and or but not no so such then than
you your yours we our they them their he she his her i me my if when while how why what which who
whom can could will would shall should may might must do does did done have has had get got make
makes made very just only also more most other others some any each all both much many""".split())

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(HERE, "into-the-network", "seeds.js")   # a build source, not served

WORD  = re.compile(r"^[A-Za-z][A-Za-z'-]{1,}$")   # neighbours and concepts
TYPED = re.compile(r"^[A-Za-z][A-Za-z'-]*$")      # the person's own words
is_word  = lambda w: bool(WORD.match(w))
# "a" and "I" are poor neighbours but they are still words somebody typed, and
# a question reaching the screen as "What is prime number" is simply wrong.
is_typed = lambda w: bool(TYPED.match(w))


def whole_sentences(text):
    """Back up to the last finished sentence. The decode loop stops on one when
       it can, but a reply that runs into the token cap stops wherever it is,
       and a dangling clause reads as a broken page rather than an answer."""
    m = list(re.finditer(r"""[.!?]["')\]]?(?=\s|$)""", text))
    return text[:m[-1].end()].strip() if m else text.strip()


def group_words(steps):
    """Tokens are not words. "Bread" is two of them, and animating six tokens
       put "B" and "read" on the line as separate words. A word's field is its
       FIRST token's distribution, because that is the choice that committed
       to the word."""
    runs = []
    for st in steps:
        opens = not runs or st["tok"][:1].isspace() or st["tok"][:1] in ",.;:!?)]"
        if opens: runs.append([st])
        else: runs[-1].append(st)
    out = []
    for g in runs:
        first = g[0]
        text = "".join(x["tok"] for x in g).strip() or first["tok"]
        seen, field = {text.lower()}, []
        for c in first["cands"]:
            w = c["w"].strip() or c["w"]          # the tokenizer's leading space
            if w.lower() in seen: continue        # which, trimmed, collides
            seen.add(w.lower())
            field.append({"w": w, "p": c["p"]})
        out.append({"tok": text,
                    "cands": ([{"w": text, "p": first["p"]}] + field)[:CAND_SHOW]})
    return out


def ends_sentence(text):
    """A sentence end, but not a decimal point or an initial. Same rule as live.js."""
    return (re.search(r"[.!?][\"')\]]?\s*$", text)
            and not re.search(r"\d[.]\s*$", text)
            and not re.search(r"\b[A-Za-z][.]\s*$", text))


def pca2(X):
    """Two components, centred. X is [n, d]; returns [n, 2]."""
    import torch
    X = X - X.mean(0, keepdim=True)
    # full SVD is cheap at these sizes and avoids a power-iteration seed
    U, S, V = torch.linalg.svd(X, full_matrices=False)
    return X @ V[:2].T


def word_vector(tok, emb, word):
    """One vector for a whole word, averaged over its pieces.

    The leading space matters: this tokenizer treats ' water' and 'water' as
    different tokens, and the one that appears mid-sentence is the spaced one.
    """
    ids = tok(" " + word, add_special_tokens=False)["input_ids"]
    if not ids:
        ids = tok(word, add_special_tokens=False)["input_ids"]
    if not ids:
        return None
    v = emb[ids].mean(0)
    n = v.norm()
    return v / n if n > 0 else None


def neighbourhood(tok, emb, embn, word, vocab_words):
    """The word's real nearest neighbours, sampled one per direction.

    Taking the top 13 by similarity alone returns the densest side of the
    neighbourhood: thirteen casing and plural variants of the same word. The
    circle is divided into sectors instead and the nearest neighbour in each
    is kept, so the whole neighbourhood shows.
    """
    import torch
    v = word_vector(tok, emb, word)
    if v is None:
        return []

    sims = embn @ v
    order = torch.argsort(sims, descending=True)

    picked, seen = [], {word.lower()}
    for idx in order.tolist():
        w = vocab_words.get(idx)
        if not w or w.lower() in seen:
            continue
        # a word is not its own neighbour, nor is its plural worth a slot
        if w.lower().rstrip("s") == word.lower().rstrip("s"):
            continue
        seen.add(w.lower())
        picked.append((idx, w, float(sims[idx])))
        if len(picked) >= ASSOC_POOL:
            break
    if not picked:
        return []

    V = torch.stack([emb[i] for i, _, _ in picked])
    P = pca2(V)

    lo = min(s for _, _, s in picked)
    hi = max(s for _, _, s in picked)
    span = (hi - lo) or 1.0

    # one per sector, nearest first
    sectors = {}
    for k, (idx, w, s) in enumerate(picked):
        ang = math.atan2(float(P[k][1]), float(P[k][0]))
        sec = int((ang + math.pi) / (2 * math.pi) * ASSOC_SHOW) % ASSOC_SHOW
        if sec not in sectors or s > sectors[sec][2]:
            sectors[sec] = (ang, w, s)

    out = []
    for sec in sorted(sectors):
        ang, w, s = sectors[sec]
        rel = (s - lo) / span                 # 1 = closest in this neighbourhood
        r = 0.12 + (1 - rel) * 0.80           # the page reads relatedness back out of this
        out.append({"w": w, "xy": [round(math.cos(ang) * r, 3),
                                   round(math.sin(ang) * r, 3)]})
    return out[:ASSOC_SHOW]


def generate(model, tok, text, seed):
    """One forward pass per word, keeping the whole distribution at each step."""
    import torch
    torch.manual_seed(seed)

    prompt = tok.apply_chat_template(
        [{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}],
        add_generation_prompt=True, tokenize=False)
    ids = tok(prompt, add_special_tokens=False, return_tensors="pt")["input_ids"]

    steps, past, cur = [], None, ids
    eos = model.config.eos_token_id
    eos = eos if isinstance(eos, list) else [eos]

    for _ in range(MAX_NEW):
        with torch.no_grad():
            out = model(input_ids=cur, past_key_values=past, use_cache=True)
        past = out.past_key_values
        logits = out.logits[0, -1].float()

        probs = torch.softmax(logits, -1)
        # nucleus sampling at temperature, over the same shortlist live.js uses
        sl = torch.softmax(logits / TEMP, -1)
        sv, si = torch.sort(sl, descending=True)
        keep = int(torch.searchsorted(torch.cumsum(sv, 0), TOP_P).item()) + 1
        pick = si[torch.multinomial(sv[:keep] / sv[:keep].sum(), 1)].item()

        piece = tok.decode([pick], skip_special_tokens=False)
        if pick in eos or (piece.startswith("<|") and piece.endswith("|>")):
            break

        top = torch.topk(logits, 60)
        cands = []
        for l, i in zip(top.values.tolist(), top.indices.tolist()):
            w = tok.decode([i], skip_special_tokens=False)
            if "�" in w:
                continue
            cands.append({"w": w, "p": round(float(probs[i]), 6)})
            if len(cands) >= CAND_SHOW:
                break

        # kept per TOKEN here; grouped into words, with the word taken lifted
        # to the front of its field, once the whole reply exists
        steps.append({"tok": piece, "p": round(float(probs[pick]), 6),
                      "cands": [c for c in cands if c["w"] != piece]})

        cur = torch.tensor([[pick]])
        if len(steps) >= MIN_NEW and ends_sentence("".join(s["tok"] for s in steps)):
            break

    return steps


def capture(model, tok, emb, embn, vocab_words, text, seed):
    import torch
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z'-]*", text) if is_typed(w)][:ASSOC_WORDS]
    if not words:
        raise SystemExit("no usable words in: " + text)

    q = []
    for w in words:
        assoc = neighbourhood(tok, emb, embn, w, vocab_words)
        if assoc:
            q.append({"w": w, "assoc": assoc})
    if not q:
        raise SystemExit("no neighbourhoods for: " + text)

    steps = generate(model, tok, text, seed)
    if not steps:
        raise SystemExit("the model said nothing for: " + text)

    said = whole_sentences("".join(s["tok"] for s in steps))
    reply = group_words(steps)

    # concepts the answer reaches for that the question never mentioned
    asked = {w.lower() for w in words}
    emerge, seen = [], set()
    # from the answer itself first, since those are the words it actually
    # used, then from the ones it nearly used
    for raw in (re.findall(r"[A-Za-z][A-Za-z'-]*", said)
                + [c["w"] for s in steps for c in s["cands"]]):
        w = raw.strip()
        if not is_word(w):
            continue
        k = w.lower()
        if k in asked or k in seen or k in STOP:
            continue
        seen.add(k)
        emerge.append(w)
        if len(emerge) >= EMERGE_SHOW:
            break
    return {"prompt": text, "q": q, "emerge": emerge[:EMERGE_SHOW],
            "reply": reply[:REPLY_STEPS], "said": said}


def check(g):
    """Fail here rather than silently on the page."""
    assert g["q"] and all(x["assoc"] for x in g["q"]), "a question word has no neighbours"
    assert g["reply"], "no reply steps"
    for r in g["reply"]:
        assert r["cands"] and r["cands"][0]["w"] == r["tok"], \
            "the word taken is not first in its candidate list"
        assert all(c["w"] == c["w"].strip() for c in r["cands"]), \
            "a candidate still carries the tokenizer's space"
        assert all("p" in c and "w" in c for c in r["cands"]), "a candidate is malformed"
    for x in g["q"]:
        for a in x["assoc"]:
            assert len(a["xy"]) == 2 and math.hypot(*a["xy"]) <= 1.0, \
                "a neighbour sits outside the unit circle, which the page reads as relatedness"
    assert g["said"], "no reply text"


def load_existing():
    if not os.path.exists(OUT):
        return []
    raw = open(OUT, encoding="utf-8").read()
    i, j = raw.find("["), raw.rfind("]")
    return json.loads(raw[i:j + 1]) if i >= 0 else []


def main():
    ap = argparse.ArgumentParser(description="Capture recorded questions for into-the-network/")
    ap.add_argument("questions", nargs="+")
    ap.add_argument("--seed", type=int, default=7, help="decode seed (default 7)")
    ap.add_argument("--replace", action="store_true",
                    help="re-capture questions already in seeds.js")
    args = ap.parse_args()

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError:
        sys.exit("needs torch and transformers:  pip install torch transformers")

    print("loading " + MODEL + " ...", flush=True)
    tok = AutoTokenizer.from_pretrained(MODEL)
    model = AutoModelForCausalLM.from_pretrained(MODEL, torch_dtype=torch.float32)
    model.eval()

    emb = model.get_input_embeddings().weight.detach().float()
    embn = emb / emb.norm(dim=1, keepdim=True).clamp(min=1e-9)

    # the vocabulary, once, so neighbour lookup is not a decode per candidate
    vocab_words = {}
    for w, i in tok.get_vocab().items():
        s = w.replace("Ġ", " ").strip()
        if is_word(s):
            vocab_words[i] = s
    print("%d word-like tokens of %d" % (len(vocab_words), emb.shape[0]), flush=True)

    seeds = load_existing()
    have = {g["prompt"].lower(): k for k, g in enumerate(seeds)}

    for text in args.questions:
        if text.lower() in have and not args.replace:
            print("already captured, skipping: " + text)
            continue
        print("capturing: " + text, flush=True)
        g = capture(model, tok, emb, embn, vocab_words, text, args.seed)
        check(g)
        print("   %d words, %d reply steps, said: %s" %
              (len(g["q"]), len(g["reply"]), g["said"][:70]), flush=True)
        if text.lower() in have:
            seeds[have[text.lower()]] = g
        else:
            have[text.lower()] = len(seeds)
            seeds.append(g)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.SEEDS=" + json.dumps(seeds, separators=(",", ":")) + ";\n")
    print("wrote %s  (%d questions, %.0fKB)" %
          (os.path.normpath(OUT), len(seeds), os.path.getsize(OUT) / 1024))
    print("\nseeds.js is inlined into index.html at build time. Rebuild with:"
          "\n    python build/build-into-the-network.py")


if __name__ == "__main__":
    main()
