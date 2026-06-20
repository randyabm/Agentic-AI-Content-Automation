"""Minimal GitHub push webhook that triggers deploy.sh on the host."""
import hashlib
import hmac
import json
import logging
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("webhook")

SECRET = os.environ.get("GITHUB_WEBHOOK_SECRET", "").encode()
def deploy_cmd(branch: str) -> list[str]:
    return ["/bin/bash", "/app/deploy.sh", branch]


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/github":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        if SECRET:
            sig = self.headers.get("X-Hub-Signature-256", "")
            expected = "sha256=" + hmac.new(SECRET, body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(sig, expected):
                log.warning("Invalid signature — ignoring")
                self.send_response(401)
                self.end_headers()
                return

        try:
            event = json.loads(body)
            ref = event.get("ref", "")
        except Exception:
            ref = ""

        # Extract branch name from ref (e.g. "refs/heads/feature-x" → "feature-x")
        branch = ref.removeprefix("refs/heads/") if ref.startswith("refs/heads/") else "master"

        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

        if ref.startswith("refs/heads/"):
            log.info("Push to %s — deploying branch %s", ref, branch)
            cmd = deploy_cmd(branch)
            try:
                subprocess.Popen(
                    cmd,
                    stdout=open("/tmp/deploy.log", "w"),
                    stderr=subprocess.STDOUT,
                )
            except Exception as exc:
                log.error("Failed to start deploy: %s", exc)
        else:
            log.info("ref=%r — not a branch push, skipping", ref or "(unknown)")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("WEBHOOK_PORT", 9001))
    log.info("Webhook server listening on :%d", port)
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
