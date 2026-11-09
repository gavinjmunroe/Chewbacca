---
name: reference-macos-zip-utf8-filenames
description: macOS zip and ditto do not set the UTF-8 filename flag, so emoji filenames extract as mojibake; build archives with Python zipfile instead.
metadata:
  type: reference
---

Both `zip -r` (Info-ZIP) and `ditto -c -k` write filenames without the UTF-8
flag (bit 0x800). Any name with emoji or accents is stored as raw NFD bytes,
so the archive extracts with broken names on Linux, Windows, or through any
standard reader. Python's `zipfile` reports them as undecodable.

Hit on 2026-09-17 zipping `~/second-brain`: 24 of 12,604 files, all the
college-application essays whose names carry check and cross marks.

The fix is to write the archive with Python's `zipfile`, normalizing each
name to NFC first, which sets the flag correctly:

```python
arc = unicodedata.normalize("NFC", os.path.join(ROOT, rel))
zi = zipfile.ZipInfo(arc, date_time=time.localtime(st.st_mtime)[:6])
zi.external_attr = (st.st_mode & 0xFFFF) << 16
z.writestr(zi, open(full, "rb").read())
```

Verify by reopening with `zipfile` and counting `i.flag_bits & 0x800`, then
extracting to a temp dir and listing the non-ASCII names. `unzip -Z1` is not
a reliable check: it mangles the output itself.

`ditto --sequesterRsrc` also adds `__MACOSX/` resource-fork entries, which
inflated the entry count by 210. Python's writer adds none.

Related: a private note
