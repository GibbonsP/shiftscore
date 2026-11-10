"""The private scoring constants: Game Score weights, the competition and position adjustments, Unit Score weights, the flurry
discount and the rating shrinkage. They live in private/formulas.json, which is never committed (it is in .gitignore) and never
shipped to the site. On the Mac it sits in the project folder; in the cloud jobs it is restored from the private state bucket
(ci/state.py packs the private/ folder into the state bundle). Notes on what each constant does are in INTERNAL_FORMULAS.md."""
import json
import os

_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "private", "formulas.json")


def _load() -> dict:
    try:
        with open(_PATH) as fh:
            return json.load(fh)
    except FileNotFoundError:
        raise RuntimeError(
            f"{_PATH} is missing. It holds the private scoring constants and is not part of the repository: copy it from your Mac, "
            "or restore the state bundle (python ci/state.py pull) which includes it."
        ) from None


FORMULAS = _load()
