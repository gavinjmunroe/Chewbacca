# Products built out of Chewbacca

Chewbacca is the playground Caleb and Gavin build in, and it's never sold. The products that come out of it ship to other people: Anchored (churches) and USC OS (students). Anything two of them use lives in Chewbacca once, and every product carries a copy that stays in step.

## The pieces

- `config/products.json`: the products, their GitHub repo and their test command.
- `tools/product_sync.py`: the engine. Every product carries it at the same path, synced like any other shared file. Generalized from USC OS's `tools/sync` on 2026-10-28.
- A product's `sync.json`: the files it shares. A plain path is the same path in both repos. `{"path": "scripts/slop-check", "chewbacca": "bin/slop-check"}` maps one to another, for a product whose layout came first.
- A product's `sync.lock.json`: each file's hash at the last sync, which is how the engine tells who moved.
- `config/product-firewall.json`: names, accounts and paths of the people who build here. The engine reads it from Chewbacca's origin/main on every pull, so the engine itself ships clean.

## Commands

```bash
chewbacca products            # per product, which shared files are behind
chewbacca products pull       # bring every product up to Chewbacca's main
chewbacca products pull anchored
```

Inside a product, `tools/product_sync.py` gives the same status, `pull`, `push` (lands the product's change on Chewbacca's main through `chewbacca land`) and `add`.

## The rules it enforces

1. Chewbacca is read from `origin/main`, never its working tree, so another tab's half-done edit never reaches a product.
2. A file changed on both sides stops with BLOCKED and the two hashes, and nothing is written. Picking a side is a person's call.
3. The firewall: a pull refuses any file with a firewall match (a home path, a phone number, a builder's name or account) and prints the lines. The fix is always to clean the Chewbacca copy, since the shared copy has to be clean at the source. On 2026-10-28 anchored's copy of `slop-check` had been scrubbed by hand while Chewbacca's still quoted people by name, and the two had drifted 39 lines apart in `code-slop`.
4. `chewbacca products pull` never touches anyone's checkout. It clones each product's origin/main into a temp dir, pulls, runs the product's tests, and pushes to its main only when they pass. A red test pushes nothing for that product and the rest still run.

## Adding a product

1. Add it to `config/products.json` with its test command.
2. In the product: copy `tools/product_sync.py` in, run `tools/product_sync.py add tools/product_sync.py` plus each shared file, then `pull`, run its tests, commit.
3. `chewbacca products` should show it fully in step.

## Status, 2026-10-28

- anchored: shares the engine, `slop-check` and `code-slop` (mapped from its `scripts/`).
- usc-os: has its own `tools/sync` from before this engine, sharing 38 files. Moving it to `tools/product_sync.py` is the next step there, done from the USC OS work since that repo has its own owner tab.
- Not built yet: running `chewbacca products pull` on its own after a land that touches a shared file.
