#!/bin/sh
# Rebuild every derived stat after new games are ingested. Order matters — see METHODOLOGY.md "Seasons".
set -e
cd "$(dirname "$0")"
PY=.venv/bin/python
$PY -u fetch_handedness.py
$PY -u main.py fix-shootouts
$PY -u main.py recompute-onice
$PY -u main.py extra-stats
$PY -u main.py train-xg
$PY -u main.py apply-xg
$PY -u main.py apply-goalies
$PY -u main.py recompute-impacts
echo PIPELINE DONE
