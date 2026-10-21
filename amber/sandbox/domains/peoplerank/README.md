# domains/peoplerank

PeopleRank algorithm sandbox — one-sided network ranking + UC1/UC3 event matching
+ DNC/MCP ops tooling.

Folded from `amber-organization/peoplerank-sandbox` (`ddb3117`). See
`.provenance.json` and repo-root `docs/`.

## Run

```bash
# Offline contract tests (no API keys)
python3 -m unittest discover -s tests -v

# API (needs deps + env)
pip install -r requirements.txt
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

## Extract

Promote `src/peoplerank/` + response-shape tests after eval harness proof.
Destination: `togari-search` / medha-platform — see `docs/EXTRACTION.md`.
