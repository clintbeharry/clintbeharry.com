#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Clint Beharry
"""
Record what the model would have said down the roads it did not take.

    python build/capture-branches.py --seeds build/into-the-network/seeds.js

For every word of every recorded answer, this takes the next few likeliest
words the model did NOT use, forces each one in that word's place, and lets
the model carry on from there. The result is a tree one fork deep: enough
for somebody to pick a different word in the finished text and watch the
sentence go somewhere else, with no download at all.

Deeper than one fork needs the model itself, in the browser. That is the
line this file draws: the shape of the idea is free, the whole of it costs
270 MB.

    --seeds PATH   the recording to branch from, default
                   build/into-the-network/seeds.js
    --out DIR      where the per-question files go, default
                   into-the-network/branches
    --alts N       alternates per word, default 3
    --words N      longest continuation, in words, default 10
    --model PATH   the model folder, default ./models/smol360 or $SMOL360

One file per question, fetched only when somebody actually forks. They are
mostly repeated short words and compress to roughly a quarter of their size
on the wire.

Shares the decoding and the word grouping with capture-seeds.py, because a
branch has to be the same KIND of thing as the answer it grows out of: the
same sampler, the same field size, the same idea of where one word ends and
the next begins, or the panel that opens on a branched word would not match
the panel that opened on the word beside it.
"""
import json, os, re, sys, time
import numpy as np, onnxruntime as ort
from tokenizers import Tokenizer


def _arg(flag, default):
    for i, a in enumerate(sys.argv):
        if a == flag and i + 1 < len(sys.argv):
            v = sys.argv[i + 1]; del sys.argv[i:i + 2]; return v
        if a.startswith(flag + "="):
            v = a.split("=", 1)[1]; sys.argv.remove(a); return v
    return default


M = _arg("--model", os.environ.get("SMOL360", "models/smol360"))
if not os.path.isdir(M):
    raise SystemExit("no model folder at %r. Pass --model PATH, or set SMOL360." % M)

SYSTEM = "You are a helpful assistant."
TEMP, TOP_P = 0.7, 0.92
CAND_SHOW = 8          # fewer than the main reply: a branch panel shows five
MAX_TOK = 40           # hard ceiling on one continuation, in tokens

tok = Tokenizer.from_file(os.path.join(M, "tokenizer.json"))
EOS = tok.token_to_id("<|im_end|>")

so = ort.SessionOptions(); so.log_severity_level = 3
sess = ort.InferenceSession(os.path.join(M, "onnx", "model_q4f16.onnx"), so,
                            providers=["CPUExecutionProvider"])
NL = sum(1 for i in sess.get_inputs() if i.name.endswith(".key"))
KH, HD = 5, 64
ONAMES = [o.name for o in sess.get_outputs()]


def ends_sentence(t):
    return bool(re.search(r'[.!?]["\')\]]?\s*$', t)) and not re.search(r'\d[.]\s*$', t) \
           and not re.search(r'\b[A-Za-z][.]\s*$', t)


def empty_past():
    return {f"past_key_values.{i}.{k}": np.zeros((1, KH, 0, HD), np.float16)
            for i in range(NL) for k in ("key", "value")}


def step_once(ids, past, pos):
    """One forward pass over `ids`, returning the distribution after the last
       of them and the cache to carry on with."""
    n = len(ids)
    out = sess.run(None, {
        "input_ids": np.array([ids], np.int64),
        "attention_mask": np.ones((1, pos + n), np.int64),
        "position_ids": np.arange(pos, pos + n, dtype=np.int64)[None],
        **past})
    logits = out[0][0, -1].astype(np.float32)
    nxt = {("past_key_values." + ONAMES[j].split(".", 1)[1]): out[j]
           for j in range(1, len(ONAMES))}
    z = logits - logits.max()
    pr = np.exp(z); pr /= pr.sum()
    return pr, nxt, pos + n


def field(pr, pick):
    """The model's own top candidates, minus the one taken: the taken word is
       put back at the front by the grouping, exactly as in capture-seeds."""
    out = []
    for i in np.argsort(-pr)[:60]:
        w = tok.decode([int(i)], skip_special_tokens=False)
        if "�" in w or int(i) == pick: continue
        out.append({"w": w, "p": round(float(pr[i]), 6), "id": int(i)})
        if len(out) >= CAND_SHOW: break
    return out


def sample(pr, rng):
    p = pr ** (1.0 / TEMP); p /= p.sum()
    order = np.argsort(-p)
    keep = int(np.searchsorted(np.cumsum(p[order]), TOP_P)) + 1
    return int(order[rng.choice(keep, p=p[order][:keep] / p[order][:keep].sum())])


def group_words(steps):
    """Byte for byte the rule capture-seeds.py uses, so a branch's words line
       up with the answer's words and both panels show the same shape."""
    runs = []
    for st in steps:
        if not runs or st["tok"][:1].isspace() or st["tok"][:1] in ",.;:!?)]":
            runs.append([st])
        else:
            runs[-1].append(st)
    out = []
    for g in runs:
        first = g[0]
        text = "".join(x["tok"] for x in g).strip()
        if not text: continue
        seen, fld = {text.lower()}, []
        for c in first["cands"]:
            w = c["w"].strip()
            if not w or w.lower() in seen: continue
            seen.add(w.lower()); fld.append({"w": w, "p": c["p"]})
        out.append({"tok": text,
                    "ids": [x["id"] for x in g if "id" in x],
                    "cands": ([{"w": text, "p": first["p"]}] + fld)[:CAND_SHOW],
                    "alts": [{"w": c["w"].strip(), "p": c["p"], "id": c.get("id")}
                             for c in first["cands"] if c["w"].strip()]})
    return out


def prompt_ids(text):
    return tok.encode("<|im_start|>system\n" + SYSTEM + "<|im_end|>\n"
                      "<|im_start|>user\n" + text + "<|im_end|>\n"
                      "<|im_start|>assistant\n", add_special_tokens=False).ids


def retell(text, seed):
    """The answer again, at the token level and with ids kept, so a branch can
       be spliced into the exact prefix the recording came from."""
    rng = np.random.default_rng(seed)
    past, pos, steps = empty_past(), 0, []
    ids = prompt_ids(text)
    while len(steps) < 88:
        pr, past, pos = step_once(ids, past, pos)
        pick = sample(pr, rng)
        piece = tok.decode([pick], skip_special_tokens=False)
        if pick == EOS or (piece.startswith("<|") and piece.endswith("|>")):
            break
        steps.append({"tok": piece, "id": pick, "p": round(float(pr[pick]), 6),
                      "cands": field(pr, pick)})
        ids = [pick]
        if len(steps) >= 20 and ends_sentence("".join(s["tok"] for s in steps)):
            break
    return steps


def carry_on(prefix, forced, rng, max_words):
    """Force one token in place of the one taken, then let the model run."""
    past, pos, steps = empty_past(), 0, []
    pr, past, pos = step_once(prefix, past, pos)
    cands = field(pr, forced)
    steps.append({"tok": tok.decode([forced], skip_special_tokens=False),
                  "p": round(float(pr[forced]), 6), "cands": cands})
    ids = [forced]
    while len(steps) < MAX_TOK:
        pr, past, pos = step_once(ids, past, pos)
        pick = sample(pr, rng)
        piece = tok.decode([pick], skip_special_tokens=False)
        if pick == EOS or (piece.startswith("<|") and piece.endswith("|>")):
            break
        steps.append({"tok": piece, "p": round(float(pr[pick]), 6),
                      "cands": field(pr, pick)})
        ids = [pick]
        said = "".join(s["tok"] for s in steps)
        if ends_sentence(said): break
        if len(group_words(steps)) > max_words: break
    words = group_words(steps)[:max_words]
    for w in words:
        w.pop("ids", None); w.pop("alts", None)
        for c in w["cands"]: c.pop("id", None)
    return words


def branches_for(text, seed, alts, max_words):
    told = retell(text, seed)
    words = group_words(told)
    base = prompt_ids(text)
    out, prefix = {}, list(base)
    for k, w in enumerate(words):
        ranked = sorted(w["alts"], key=lambda c: -c["p"])
        taken = w["tok"].lower()
        picks, seen = [], {taken}
        for c in ranked:
            if c["w"].lower() in seen: continue
            seen.add(c["w"].lower()); picks.append(c)
            if len(picks) >= alts: break
        rows = []
        for j, c in enumerate(picks):
            rng = np.random.default_rng(seed * 9173 + k * 131 + j)
            reply = carry_on(prefix, c["id"], rng, max_words)
            if not reply: continue
            rows.append({"w": c["w"], "p": c["p"], "reply": reply})
        if rows: out[str(k)] = rows
        prefix = prefix + w["ids"]
    return {"prompt": text, "words": [w["tok"] for w in words], "at": out}


if __name__ == "__main__":
    seeds_path = _arg("--seeds", "build/into-the-network/seeds.js")
    out_dir = _arg("--out", "into-the-network/branches")
    alts = int(_arg("--alts", "3"))
    max_words = int(_arg("--words", "10"))
    only = _arg("--only", "")
    seed = int(_arg("--seed", "7"))

    src = open(seeds_path, encoding="utf-8").read()
    seeds = json.loads(src[src.index("=") + 1:].rstrip().rstrip(";"))
    os.makedirs(out_dir, exist_ok=True)

    for i, g in enumerate(seeds):
        if only and only not in g["prompt"]: continue
        t0 = time.time()
        b = branches_for(g["prompt"], seed, alts, max_words)
        # the recording and the retelling have to be the same answer, or a
        # branch would be spliced into a prefix that is not on the page
        mine = b["words"][:len(g["reply"])]
        theirs = [w["tok"] for w in g["reply"]]
        same = mine == theirs
        p = os.path.join(out_dir, "b%d.js" % i)
        b["words"] = theirs
        b["at"] = {k: v for k, v in b["at"].items() if int(k) < len(theirs)}
        with open(p, "w", encoding="utf-8") as f:
            f.write("window.onBranches(%d,%s);\n"
                    % (i, json.dumps(b, separators=(",", ":"))))
        print("%-40s %5.1fs  %3d forks  %5.0fKB  %s"
              % (g["prompt"][:40], time.time() - t0, sum(len(v) for v in b["at"].values()),
                 os.path.getsize(p) / 1024, "ok" if same else "MISMATCH"), flush=True)
        if not same:
            print("   recorded:", " ".join(theirs[:12]))
            print("   retold:  ", " ".join(mine[:12]))
