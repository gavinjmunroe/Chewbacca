"""Resumable uploader: embeds records.jsonl in batches and upserts to Pinecone."""
import json
import os
import sys
import random
import time
import amber_kg as k

PACE = 3.0  # seconds between batches, to stay under both APIs' rate limits

SRC = sys.argv[1] if len(sys.argv) > 1 else "/home/user/workspace/records.jsonl"
CKPT = SRC + ".ckpt"
BATCH = 96

records = [json.loads(l) for l in open(SRC)]
start = 0
if os.path.exists(CKPT):
    start = int(open(CKPT).read().strip() or 0)

print(f"{len(records)} records, resuming at {start}", flush=True)
t0 = time.time()
done = start

MAX_SECONDS = float(os.environ.get("MAX_SECONDS", "480"))

while done < len(records):
    if time.time() - t0 > MAX_SECONDS:
        print(f"PAUSED at {done} (time budget); rerun to continue", flush=True)
        break
    chunk = records[done:done + BATCH]
    for attempt in range(9):
        try:
            res = k.upsert(chunk)
            break
        except Exception as e:
            wait = min(60, 3 * 2 ** attempt) + random.uniform(0, 3)
            print(f"  retry {attempt + 1} after {wait:.0f}s: {str(e)[:140]}",
                  flush=True)
            time.sleep(wait)
    else:
        print("FAILED permanently at offset", done, flush=True)
        sys.exit(1)
    done += len(chunk)
    with open(CKPT, "w") as f:
        f.write(str(done))
    el = time.time() - t0
    rate = (done - start) / el if el else 0
    eta = (len(records) - done) / rate / 60 if rate else 0
    print(f"  {done}/{len(records)}  {rate:.1f} rec/s  eta {eta:.1f} min",
          flush=True)
    time.sleep(PACE)

print(f"DONE {done} records in {(time.time() - t0) / 60:.1f} min", flush=True)
