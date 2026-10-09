---
name: project-plynn-macos15-port
description: "Plynn (local Mac dictation) declared macOS 26 but ran fine on Caleb's macOS 15 after gating three optional APIs; the deployment-target-drives-weak-linking trick is the reusable part"
metadata:
  type: project
---

Caleb cloned [31Carlton7/plynn](https://github.com/31Carlton7/plynn) on 2026-09-02 (Carlton Aikins' on-device Mac dictation app) and it would not run: it declares macOS 26, his Mac is **macOS 15.6.1**.

**The floor was the author's choice, not a dependency constraint.** Every dependency supports macOS 14 or lower (FluidAudio 14, MLX 13.3, Sparkle 10.13). Only three things needed 26, each with a fallback already in the code: FoundationModels polish becomes local Qwen3-4B via MLX, SpeechAnalyzer becomes Parakeet, Liquid Glass becomes `.ultraThinMaterial`.

Ported on branch `macos15` at `~/code/plynn`, commit `d9e04fd`. **135 tests pass, up from 0** (the bundle previously could not `dlopen`). App launches and holds a stable PID on Sequoia.

**The mechanism to remember, good for any Swift app with a too-high floor:** lowering the deployment target below a framework's availability makes the linker weak-link it, so missing symbols resolve to null instead of aborting the load, and `@available` gates keep you off them. Verify with `otool -L` (want "weak") and `otool -l | grep -A4 LC_BUILD_VERSION` (want `minos` below `sdk`). Generalized writeup shipped publicly as `docs/SWIFT-MACOS-PORTING.md` in Chewbacca.

**Two traps worth carrying forward:**
- Sign local builds of someone else's app with a real Apple Development certificate, not ad-hoc. macOS keys accessibility and mic grants to the signature, and ad-hoc is identified by hash, so every rebuild resets permissions.
- Turn off Sparkle background checks on a port. Upstream releases target the newer OS and would silently replace a working install with one that cannot launch.

**Now shipped in Chewbacca** (commit `81d702b`): `setup.sh` installs Plynn for everyone who runs the kit. macOS 26+ gets Carlton's notarized DMG, macOS 15 builds from source with the shipped patch behind `PLYNN_BUILD_FROM_SOURCE=1`. Installed from upstream, never vendored, MIT attribution in `patches/README.md`. The setup.sh step is deliberately **outside the GENERATED regions** that `d1-inventory.py` rewrites.

Full detail: `projects/plynn.md`. See [[reference_writing_toolchain]], [[project_chewbacca]].

## From the index

lowering the deployment target weak-links the too-new frameworks so `@available` gates carry the rest. 135 tests up from 0.
