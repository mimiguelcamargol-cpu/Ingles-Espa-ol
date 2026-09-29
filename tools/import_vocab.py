#!/usr/bin/env python3
"""Convierte un CSV (en,es,pos,level,example) en data/vocab.json.
Uso: python3 tools/import_vocab.py mi_lista.csv [--merge]
Niveles: B1.1 B1.2 B2.1 B2.2 C1.1 C1.2 (ampliable en data/levels.json).
Cabecera opcional. --merge conserva las palabras que ya existen."""
import csv, json, sys, os
src = sys.argv[1]; merge = "--merge" in sys.argv
dst = os.path.join(os.path.dirname(__file__), "..", "data", "vocab.json")
rows = {}
if merge and os.path.exists(dst):
    for r in json.load(open(dst, encoding="utf-8")): rows[(r[0].lower(), r[2])] = r
for r in csv.reader(open(src, encoding="utf-8-sig")):
    if len(r) < 4 or r[0].strip().lower() in ("en", "english"): continue
    r = [c.strip() for c in r[:5]] + [""] * (5 - len(r[:5]))
    rows[(r[0].lower(), r[2])] = r
out = sorted(rows.values(), key=lambda r: (r[3], r[0].lower()))
json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"{len(out)} palabras -> {dst}")
