#!/bin/zsh
# Re-download and extract the primary papers behind ../09-dataviz.md.
#
# The extracted .txt files are deliberately gitignored: they are full texts of
# copyrighted papers. The findings, numbers and citations live in the research
# file. This script exists so anyone can reproduce the source material and
# check a quote against the original.
#
# Requires: curl, pdftotext (brew install poppler)
#   ./fetch.sh          fetch everything into ./
set -uo pipefail
W="$(cd "$(dirname "$0")" && pwd)"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

get() {
  local name="$1" url="$2"
  curl -skL --max-time 60 -A "$UA" "$url" -o "$W/$name.bin" || { echo "FAIL  $name"; return; }
  if file "$W/$name.bin" | grep -qi pdf; then
    pdftotext -layout "$W/$name.bin" "$W/$name.txt" && echo "ok    $name ($(wc -l < "$W/$name.txt" | tr -d ' ') lines)"
  else
    echo "NOTPDF $name: $(file -b "$W/$name.bin" | head -c 60)"
  fi
  rm -f "$W/$name.bin"
}

get cleveland-mcgill-1984 "https://math.pku.edu.cn/teachers/xirb/Courses/biostatistics/Biostatistics2016/GraphicalPerception_Jasa1984.pdf"
get heer-bostock-2010     "http://vis.stanford.edu/files/2010-MTurk-CHI.pdf"
get truncating-y-axis     "https://arxiv.org/pdf/1907.02035"
get skau                  "https://kosara.net/papers/2016/Skau-EuroVis-2016.pdf"
get declutter             "https://par.nsf.gov/servlets/purl/10350268"
get lundgard              "https://arxiv.org/pdf/2110.04406"
get calvi                 "https://mucollective.northwestern.edu/files/2023-CALVI.pdf"
get viseval               "https://arxiv.org/pdf/2407.00981"
get misleading-llm        "https://arxiv.org/pdf/2502.20503"
get bateman               "https://sites.stat.columbia.edu/gelman/communication/Bateman2010.pdf"
get colorbrewer           "https://www.cs.rpi.edu/~cutler/classes/visualization/S18/papers/colorbrewer.pdf"
get vegalite              "https://idl.cs.washington.edu/files/2017-VegaLite-InfoVis.pdf"
get munzner               "https://www.cs.ubc.ca/~tmm/talks/minicourse14/minicourse14-session1.pdf"
get few-pitfalls          "https://www.perceptualedge.com/articles/Whitepapers/Common_Pitfalls.pdf"
get annot-survey          "https://arxiv.org/pdf/2410.05579"
get shneiderman           "https://www.cs.umd.edu/~ben/papers/Shneiderman1996eyes.pdf"
get correll-bullshit      "https://arxiv.org/pdf/2109.12975"
