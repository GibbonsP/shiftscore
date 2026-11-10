"""Keep the pipeline's working state in a private Cloudflare R2 bucket between scheduled runs.

The state is one file, state.tar.zst: the database, the last site build (the incremental build reads it), the updater's
bookkeeping and the cached images (about 130 MB).

    python ci/state.py pack          # build state.tar.zst from the working directory
    python ci/state.py push          # pack, then upload it to the bucket
    python ci/state.py pull          # download it and unpack it into the working directory

Needs R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_STATE_BUCKET in the environment for push and pull.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
ARCHIVE = "state.tar.zst"
KEY = "state/state.tar.zst"
PATHS = ["nhl_impact.db", "artifact_data", "update_state.json", "models/score_factors.json", "private"] + (["images_cache"] if os.path.isdir("images_cache") else [])
PRIVATE_KEY = "state/formulas.json"   # the private scoring constants on their own, for the live job (which does not restore the whole bundle)


def client():
    import boto3
    return boto3.client("s3", endpoint_url=os.environ["R2_ENDPOINT"], aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")


def pack():
    subprocess.run(["tar", "--use-compress-program=zstd -T0 -10", "-cf", ARCHIVE, *PATHS], check=True)
    print(f"packed {ARCHIVE}: {os.path.getsize(ARCHIVE) / 1e6:.0f} MB")


def push():
    pack()
    client().upload_file(ARCHIVE, os.environ["R2_STATE_BUCKET"], KEY)
    os.remove(ARCHIVE)
    print("uploaded state")


def pull():
    from botocore.exceptions import ClientError
    try:
        client().download_file(os.environ["R2_STATE_BUCKET"], KEY, ARCHIVE)
    except ClientError as e:
        sys.exit(f"could not download {KEY} from the state bucket ({e}). Upload the first bundle first: see DEPLOY.md, step 5.")
    subprocess.run(["tar", "--use-compress-program=unzstd", "-xf", ARCHIVE], check=True)
    os.remove(ARCHIVE)
    print("state restored:", os.path.getsize("nhl_impact.db") // 1_000_000, "MB database")


def pull_private():
    """Download just private/formulas.json (the scoring constants); the live job needs it but not the database."""
    from botocore.exceptions import ClientError
    os.makedirs("private", exist_ok=True)
    try:
        client().download_file(os.environ["R2_STATE_BUCKET"], PRIVATE_KEY, "private/formulas.json")
    except ClientError as e:
        sys.exit(f"could not download {PRIVATE_KEY} from the state bucket ({e}). Upload private/formulas.json there: see DEPLOY.md, step 5.")
    print("restored private/formulas.json")


def push_private():
    client().upload_file("private/formulas.json", os.environ["R2_STATE_BUCKET"], PRIVATE_KEY)
    print("uploaded private/formulas.json")


if __name__ == "__main__":
    {"pack": pack, "push": push, "pull": pull, "pull-private": pull_private, "push-private": push_private}[sys.argv[1] if len(sys.argv) > 1 else "pack"]()
