#!/usr/bin/env python3
"""
Build into-the-network/index.html from its sources.

    python build/build-into-the-network.py

The page is one file on purpose: the sequence, the page around it and the
recorded questions are inlined, so a visitor fetches one document and three.js.
Only live.js stays separate, because it is imported on demand and most
visitors never need it.

Run this after build/capture-seeds.py adds a question.
"""
import io, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(HERE, "into-the-network")
OUT  = os.path.join(HERE, "..", "into-the-network", "index.html")
THREE = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"

PARTS = {
    "/* SEEDS_HERE */":  "seeds.js",
    "/* ENGINE_HERE */": "engine.js",
    "/* APP_HERE */":    "app.js",
}

def read(name):
    return io.open(os.path.join(SRC, name), encoding="utf-8").read()

def build(three_url):
    html = read("shell.html")
    for marker, name in PARTS.items():
        if marker not in html:
            raise SystemExit("shell.html is missing " + marker)
        html = html.replace(marker, read(name))
    return html.replace("THREE_URL", three_url)

if __name__ == "__main__":
    html = build(THREE)
    io.open(OUT, "w", encoding="utf-8").write(html)
    print("wrote %s  (%.0fKB)" % (os.path.normpath(OUT), len(html.encode()) / 1024))
