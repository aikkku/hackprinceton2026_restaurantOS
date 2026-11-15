#!/usr/bin/env python3
"""Deploy the latest main commit only after its push verification passes.

Standard library only. Runtime secrets are read by Compose, never by this script.
The root-owned installer/configuration are deliberately not self-updating.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request


REPO = "aikkku/hackprinceton2026_restaurantOS"


def run(args, *, capture=False, **kwargs):
    return subprocess.run(args, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None,
                          timeout=kwargs.pop("timeout", 90), **kwargs).stdout


def verified(runs, sha):
    candidates = [r for r in runs if r.get("head_sha") == sha
                  and r.get("head_branch") == "main" and r.get("event") == "push"
                  and r.get("head_repository", {}).get("full_name") == REPO]
    if not candidates:
        return False
    latest = max(candidates, key=lambda r: (r["id"], r.get("run_attempt", 1)))
    return latest.get("status") == "completed" and latest.get("conclusion") == "success"


class Deployer:
    def __init__(self, config):
        self.config = config
        self.state = Path(config["state"])
        self.state.mkdir(parents=True, exist_ok=True)

    def read(self, name):
        path = self.state / name
        return json.loads(path.read_text()) if path.exists() else None

    def write(self, name, value):
        path = self.state / name
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value) + "\n")
        temporary.replace(path)

    def latest(self):
        checkout = self.config["checkout"]
        # Explicit public URL: do not trust a locally changed origin or fetch PR refs.
        run(["git", "-C", checkout, "fetch", "--quiet", "https://github.com/" + REPO + ".git",
             "+refs/heads/main:refs/remotes/origin/main"])
        sha = run(["git", "-C", checkout, "rev-parse", "refs/remotes/origin/main"], capture=True).strip()
        if not re.fullmatch(r"[0-9a-f]{40}", sha):
            raise RuntimeError("Invalid main commit")
        return sha

    def passed(self, sha):
        query = urllib.parse.urlencode({"branch": "main", "event": "push", "head_sha": sha, "per_page": 100})
        url = f"https://api.github.com/repos/{REPO}/actions/workflows/verify.yml/runs?{query}"
        request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "restaurantos-vultr-deploy"})
        # Network/rate-limit/invalid JSON errors fail closed: no replacement of the running app.
        with urllib.request.urlopen(request, timeout=30) as response:
            return verified(json.load(response)["workflow_runs"], sha)

    def compose(self, tag, *args, capture=False):
        env = {**os.environ, "RUNTIME_ENV_FILE": self.config["runtime_env"],
               "APP_DOMAIN": self.config["domain"], "ACME_EMAIL": self.config["email"],
               "APP_IMAGE_TAG": tag}
        return run(["docker", "compose", "-p", "restaurantos", "-f", self.config["compose"], *args],
                   env=env, capture=capture, timeout=300)

    def build(self, sha):
        if shutil.disk_usage(tempfile.gettempdir()).free < 8 * 1024**3:
            raise OSError("Less than 8 GiB free for a build; free disk space and retry")
        with tempfile.TemporaryDirectory(prefix="restaurantos-build-") as directory:
            archive = str(Path(directory) / "source.tar")
            source = Path(directory) / "source"
            source.mkdir()
            run(["git", "-C", self.config["checkout"], "archive", "--format=tar", "-o", archive, sha])
            run(["tar", "-xf", archive, "-C", str(source)])
            # Only committed files enter the build; no checkout secrets/private data.
            run(["docker", "build", "--label", "restaurantos.autodeploy=true",
                 "--label", f"org.opencontainers.image.revision={sha}",
                 "-f", str(source / "deploy/vultr/Dockerfile"),
                 "-t", "restaurantos:" + sha, str(source)], timeout=1500)

    def backup(self):
        container = self.compose("local", "ps", "-q", "app", capture=True).strip()
        if not container:
            raise RuntimeError("No running app to preserve; launch manually before enabling deployment")
        image = run(["docker", "inspect", "--format", "{{.Image}}", container], capture=True).strip()
        run(["docker", "tag", image, "restaurantos:rollback"])

    def activate(self, tag):
        self.compose(tag, "up", "-d", "--no-build", "--wait", "--wait-timeout", "180", "app")

    def rollback(self, pending):
        print("Restoring the previous app image.", flush=True)
        self.activate("rollback")
        self.write("current.json", pending["previous"])
        self.write("failed.json", pending["target"])
        (self.state / "pending.json").unlink(missing_ok=True)

    def deploy(self, retry=False):
        pending = self.read("pending.json")
        if pending:
            # Recover even after process interruption/reboot during container replacement.
            self.rollback(pending)
        sha = self.latest()
        if sha == self.read("current.json"):
            return
        if sha == self.read("failed.json") and not retry:
            print(f"Skipping failed release {sha}; use --retry after fixing the cause.", flush=True)
            return
        if not self.passed(sha):
            print(f"Waiting for successful push verification of {sha}.", flush=True)
            return
        print(f"Building verified commit {sha}.", flush=True)
        try:
            self.build(sha)
        except (subprocess.SubprocessError, OSError):
            self.write("failed.json", sha)
            raise
        # A newer push/rerun while building must not publish this stale release.
        if self.latest() != sha or not self.passed(sha):
            print("Main or CI changed during build; leaving the running app in place.", flush=True)
            return
        self.backup()
        pending = {"target": sha, "previous": self.read("current.json")}
        self.write("pending.json", pending)
        try:
            self.activate(sha)
        except (subprocess.SubprocessError, OSError):
            self.rollback(pending)
            raise
        self.write("current.json", sha)
        (self.state / "pending.json").unlink()
        print(f"Deployed {sha}; container health check passed.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="/etc/restaurantos-deploy.json")
    parser.add_argument("--retry", action="store_true")
    args = parser.parse_args()
    deployer = Deployer(json.loads(Path(args.config).read_text()))
    with (deployer.state / "lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another deployment is running.")
            return
        deployer.deploy(args.retry)


if __name__ == "__main__":
    main()
