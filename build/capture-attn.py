#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Clint Beharry
"""
Record where the model actually looks, from the weights rather than a proxy.

    python build/capture-attn.py --seeds build/into-the-network/seeds.js

The attention in this export is fused into one GroupQueryAttention op per
layer, so there is no softmax tensor to read and no obvious way in. There is
a way in. The op takes its post-rotary Q as a named tensor, and the matching
K is already a graph output, because the model hands back its KV cache. Add
the Q tensors as graph outputs, run the prompt once, and the attention is a
matmul and a softmax away, computed here rather than inside the op.

What comes out is the real thing, which is the point, and the real thing is
not what people expect. Most of the mass in the later layers goes to the
first token and to the newlines of the chat template. That is the attention
sink: a head with nothing to contribute still has to put its softmax
somewhere, and the first token is where it goes. A piece that drew a tidy
heatmap over the content words would be drawing a story rather than a
measurement.

    --seeds PATH   the recording to add attention to, rewritten in place
    --model PATH   the model folder, default ./models/smol360 or $SMOL360
    --layers L,L   which layers to record, default 0,8,15,23,31

Only adds. Replies, fields, neighbourhoods and axes are untouched, so the
branch files keep lining up with the answers they grew out of.
"""
import json, os, sys
import numpy as np, onnx, onnxruntime as ort
from onnx import helper, TensorProto
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
LAYERS = [int(x) for x in _arg("--layers", "0,8,15,23,31").split(",")]
SYSTEM = "You are a helpful assistant."
NH, KVH, HD, SCALE = 15, 5, 64, 0.125        # straight off the op's attributes

if not os.path.isdir(M):
    raise SystemExit("no model folder at %r. Pass --model PATH, or set SMOL360." % M)

tok = Tokenizer.from_file(os.path.join(M, "tokenizer.json"))

QNAME = "/model/layers.%d/attn/q_rotary/RotaryEmbedding/output_0"
m = onnx.load(os.path.join(M, "onnx", "model_q4f16.onnx"))
for L in LAYERS:
    m.graph.output.append(
        helper.make_tensor_value_info(QNAME % L, TensorProto.FLOAT16, None))
so = ort.SessionOptions(); so.log_severity_level = 3
sess = ort.InferenceSession(m.SerializeToString(), so,
                            providers=["CPUExecutionProvider"])
OUT = [o.name for o in sess.get_outputs()]
NL = sum(1 for i in sess.get_inputs() if i.name.endswith(".key"))


def look(text):
    """One forward pass over the whole prompt, and the attention row at the
       last position: what the model is looking at in the instant before it
       says anything."""
    prompt = ("<|im_start|>system\n" + SYSTEM + "<|im_end|>\n"
              "<|im_start|>user\n" + text + "<|im_end|>\n<|im_start|>assistant\n")
    ids = tok.encode(prompt, add_special_tokens=False).ids
    S = len(ids)
    past = {f"past_key_values.{i}.{k}": np.zeros((1, KVH, 0, HD), np.float16)
            for i in range(NL) for k in ("key", "value")}
    res = sess.run(None, {"input_ids": np.array([ids], np.int64),
                          "attention_mask": np.ones((1, S), np.int64),
                          "position_ids": np.arange(S, dtype=np.int64)[None],
                          **past})
    get = lambda n: res[OUT.index(n)]

    out = []
    for L in LAYERS:
        Q = get(QNAME % L).astype(np.float32).reshape(1, S, NH, HD)[0, -1]   # (NH,HD)
        K = get("present.%d.key" % L).astype(np.float32)[0]                  # (KVH,S,HD)
        rows = np.empty((NH, S), np.float32)
        for h in range(NH):
            s = Q[h] @ K[h // (NH // KVH)].T * SCALE
            s -= s.max()
            e = np.exp(s); rows[h] = e / e.sum()
        avg = rows.mean(0)
        assert abs(float(avg.sum()) - 1.0) < 1e-3, "a layer's attention did not sum to 1"
        out.append({
            "l": L,
            "a": [round(float(x), 4) for x in avg],
            # how much each head puts on the very first token, which is the
            # whole of the sink and the most surprising number here
            "sink": [round(float(x), 3) for x in rows[:, 0]],
        })
    toks = [tok.decode([i], skip_special_tokens=False) for i in ids]
    return {"toks": toks, "at": out,
            # where the question itself sits inside all that scaffolding
            "ask": [len(tok.encode(prompt[:prompt.index(text)],
                                   add_special_tokens=False).ids),
                    len(tok.encode(prompt[:prompt.index(text) + len(text)],
                                   add_special_tokens=False).ids)]}


if __name__ == "__main__":
    src = open(SEEDS, encoding="utf-8").read()
    head = src[:src.index("=") + 1]
    seeds = json.loads(src[src.index("=") + 1:].rstrip().rstrip(";"))

    for g in seeds:
        g["attn"] = look(g["prompt"])
        a = g["attn"]
        top = sorted(range(len(a["at"][-1]["a"])),
                     key=lambda j: -a["at"][-1]["a"][j])[:3]
        print("%-40s %3d tokens, question at %s  last layer looks at %s"
              % (g["prompt"][:40], len(a["toks"]), a["ask"],
                 ", ".join("%s %.0f%%" % (repr(a["toks"][j]),
                                          a["at"][-1]["a"][j] * 100) for j in top)),
              flush=True)

    with open(SEEDS, "w", encoding="utf-8") as f:
        f.write(head + json.dumps(seeds, separators=(",", ":")) + ";\n")
    print("rewrote %s  (%.0fKB)" % (SEEDS, os.path.getsize(SEEDS) / 1024))
