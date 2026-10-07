#!/usr/bin/env python3
"""Train the big-work probe that skill-route.sh uses to decide whether a prompt
needs the "should I graph engineer?" question, and print the constants to paste
into the hook.

The probe is a logistic regression over embeddinggemma vectors from local
Ollama. Nothing leaves the Mac, and the router already keeps that model loaded.

Measured 2026-10-06 on 141 of Caleb's own labeled prompts (93 dev, 48 sealed
test scored once): the probe caught 9/12 sealed big prompts with 2/36 false
hits, AUC 0.94, about 15ms. llama3.1:8b as a yes/no judge got 8/12 with 4/36 at
290ms, the old verb list 7/12 with 3/36, and Jev's remote API is ruled out for
prompt hooks. Mixing the 8B into the probe lowered AUC on dev.

The labels are private and live outside this repo:
    python3 tools/train_bigwork_probe.py ~/second-brain/systems/bigwork-labels.tsv
"""
import base64
import json
import os
import struct
import sys
import urllib.request

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold

PREFIX = "task: classification | query: "
# C was picked on the dev split before the sealed split was opened. The cutoff
# is the knee of a 10x repeated 5-fold CV over all 141: 0.48 caught 28/34 with
# 15/107 false, 0.50 caught 25/34 with 8/107, 0.55 dropped to 19/34. Misses
# have the edit backstop; a false hit costs a refusal, so take the knee.
C = 1.0
CUTOFF = 0.50


def embed(texts):
    host = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
    body = {"model": "embeddinggemma", "input": [PREFIX + t[:2000] for t in texts], "keep_alive": "2h"}
    req = urllib.request.Request(host + "/api/embed", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    x = np.array(json.load(urllib.request.urlopen(req, timeout=600))["embeddings"])
    return x / np.linalg.norm(x, axis=1, keepdims=True)


def main(path):
    rows = [line.split("\t", 2) for line in open(path).read().splitlines()
            if line and not line.startswith("#")]
    y = np.array([int(r[0]) for r in rows])
    x = embed([r[2] for r in rows])

    cv = np.zeros(len(y))
    for tr, te in StratifiedKFold(5, shuffle=True, random_state=0).split(x, y):
        m = LogisticRegression(C=C, class_weight="balanced", max_iter=3000).fit(x[tr], y[tr])
        cv[te] = m.predict_proba(x[te])[:, 1]
    hit = int(((cv >= CUTOFF) & (y == 1)).sum())
    false = int(((cv >= CUTOFF) & (y == 0)).sum())
    print(f"# 5-fold CV on all {len(y)}: {hit}/{int(y.sum())} big caught, "
          f"{false}/{int((y == 0).sum())} false hits at {CUTOFF}", file=sys.stderr)

    m = LogisticRegression(C=C, class_weight="balanced", max_iter=3000).fit(x, y)
    packed = base64.b64encode(struct.pack(f"<{x.shape[1]}e", *m.coef_[0])).decode()
    print(f'PROBE_W = "{packed}"')
    print(f"PROBE_B = {float(m.intercept_[0]):.6f}")
    print(f"PROBE_CUTOFF = {CUTOFF}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/second-brain/systems/bigwork-labels.tsv"))
