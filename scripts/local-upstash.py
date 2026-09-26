#!/usr/bin/env python3
"""
Local stand-in for the Upstash Redis REST API — for development and tests only.

Needs a local redis-server (port 6379) and `pip install redis`.
Run:   python3 scripts/local-upstash.py            (listens on http://127.0.0.1:8079)
Then:  UPSTASH_REDIS_REST_URL=http://127.0.0.1:8079
       UPSTASH_REDIS_REST_TOKEN=local-dev-token

Implements the parts of the protocol @upstash/redis uses: POST /  (one command),
POST /pipeline, POST /multi-exec, Bearer auth and the "Upstash-Encoding: base64" response encoding.

Also GET /SET/key/value/EX/60 — Upstash's path-style form, where the command and its arguments
are the path segments. Nothing in the product uses it; `npm run check:env` does, and a stand-in
that answers 501 to it would report a working Redis as broken.
"""
import base64
import json
import os
from urllib.parse import unquote
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import redis

TOKEN = os.environ.get("LOCAL_UPSTASH_TOKEN", "local-dev-token")
PORT = int(os.environ.get("LOCAL_UPSTASH_PORT", "8079"))
R = redis.Redis(host=os.environ.get("REDIS_HOST", "127.0.0.1"), port=6379, decode_responses=False)


def encode(v, b64):
    if isinstance(v, bytes):
        return base64.b64encode(v).decode() if b64 else v.decode("utf-8", "replace")
    if isinstance(v, str):
        return base64.b64encode(v.encode()).decode() if b64 else v
    if isinstance(v, (list, tuple, set)):
        return [encode(x, b64) for x in v]
    if isinstance(v, dict):  # HGETALL etc. → flat list like real Redis
        out = []
        for k, val in v.items():
            out += [encode(k, b64), encode(val, b64)]
        return out
    if v is True:
        return "OK" if not b64 else base64.b64encode(b"OK").decode()
    return v


def _strip_upstash_flags(cmd):
    # Upstash scripts may start with "#!lua flags=allow-key-locking" (Upstash-only flag)
    if cmd and str(cmd[0]).upper() in ("EVAL", "EVAL_RO") and len(cmd) > 1 and str(cmd[1]).startswith("#!lua"):
        first, _, rest = str(cmd[1]).partition("\n")
        first = first.replace("allow-key-locking", "").replace("flags=,", "flags=").rstrip(", ")
        if first.strip() in ("#!lua flags=", "#!lua flags"):
            first = "#!lua"
        cmd = [cmd[0], first + "\n" + rest, *cmd[2:]]
    return cmd


def run(cmd, b64):
    cmd = _strip_upstash_flags(cmd)
    try:
        res = R.execute_command(*[str(c) if not isinstance(c, str) else c for c in cmd])
        if str(cmd[0]).upper() == "PING" and res is True:
            res = "PONG"
        return {"result": encode(res, b64)}
    except redis.exceptions.NoScriptError as e:  # redis-py strips the NOSCRIPT prefix
        return {"error": f"NOSCRIPT {e}"}
    except redis.ResponseError as e:
        return {"error": str(e)}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.headers.get("authorization") != f"Bearer {TOKEN}":
            return self._send(401, {"error": "Unauthorized"})
        b64 = (self.headers.get("upstash-encoding") or "").lower() == "base64"
        cmd = [unquote(p) for p in self.path.split("?")[0].strip("/").split("/") if p != ""]
        if not cmd:
            return self._send(400, {"error": "No command in the path"})
        return self._send(200, run(cmd, b64))

    def do_POST(self):
        if self.headers.get("authorization") != f"Bearer {TOKEN}":
            return self._send(401, {"error": "Unauthorized"})
        b64 = (self.headers.get("upstash-encoding") or "").lower() == "base64"
        data = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"null")
        path = self.path.rstrip("/")
        if path in ("/pipeline", "/multi-exec"):
            return self._send(200, [run(c, b64) for c in data])
        return self._send(200, run(data, b64))


if __name__ == "__main__":
    print(f"local Upstash REST on http://127.0.0.1:{PORT}  (token: {TOKEN})")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
