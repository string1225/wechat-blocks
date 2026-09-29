"""Progress service: stdlib HTTP + SQLite. Secrets never leave this process."""
import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
from collections import deque
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_BODY = 8 * 1024 * 1024
TOKEN_RE = re.compile(r"^[a-f0-9]{64}$")


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def level_dimensions(level, version):
    if version == 1:
        edge = 4 if level <= 3 else 5 if level <= 7 else 6
        return edge, edge, edge
    if version == 3 and level > 100:
        increments = 1 + (level - 101) // 10
        edge, steps = 9 + increments // 3, increments % 3
        return edge + int(steps >= 1), edge, edge + int(steps >= 2)
    remaining, edge, interval = level - 1, 4, 1
    while remaining >= 3 * interval:
        remaining -= 3 * interval
        edge += 1
        interval *= 2
    steps = remaining // interval
    return edge + int(steps >= 1), edge, edge + int(steps >= 2)


def valid_blocks(blocks, dimensions):
    count = dimensions[0] * dimensions[1] * dimensions[2]
    if not isinstance(blocks, list) or len(blocks) > count:
        return False
    ids, positions = set(), set()
    for block in blocks:
        if (not isinstance(block, list) or len(block) != 4
                or not integer(block[0], 0, count - 1)
                or not all(integer(n, 0, edge - 1) for n, edge in zip(block[1:], dimensions))):
            return False
        position = tuple(block[1:])
        if block[0] in ids or position in positions:
            return False
        ids.add(block[0])
        positions.add(position)
    return True


def valid_progress(p):
    if (not isinstance(p, dict) or not integer(p.get("version"), 1, 3)
            or not integer(p.get("level"), 1, 10 if p["version"] == 1 else 9007199254740991)):
        return False
    if "elapsedMs" in p and not integer(p["elapsedMs"], 0, 9007199254740991):
        return False
    dimensions = level_dimensions(p["level"], p["version"])
    max_moves = dimensions[0] * dimensions[1] * dimensions[2] + 8
    powerups, history = p.get("powerups"), p.get("history")
    if (not integer(p.get("moves"), 0, max_moves) or p.get("phase") not in ("playing", "won", "failed")
            or not isinstance(powerups, dict) or not integer(powerups.get("undo"), 0, 5)
            or not integer(powerups.get("bomb"), 0, 3) or not valid_blocks(p.get("blocks"), dimensions)
            or not isinstance(history, list) or len(history) > 30):
        return False
    if not all(isinstance(turn, dict) and integer(turn.get("moves"), 0, p["moves"] - 1)
               and valid_blocks(turn.get("blocks"), dimensions) for turn in history):
        return False
    if p["phase"] == "won":
        return not p["blocks"]
    return bool(p["blocks"]) and (p["moves"] >= max_moves if p["phase"] == "failed" else p["moves"] < max_moves)


class Database:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS players (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (
                    digest TEXT PRIMARY KEY, player TEXT NOT NULL REFERENCES players(id), expires_at INTEGER);
                CREATE TABLE IF NOT EXISTS progress (
                    player TEXT PRIMARY KEY REFERENCES players(id), revision INTEGER NOT NULL,
                    payload TEXT NOT NULL, mutation TEXT NOT NULL, updated_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS mutations (
                    player TEXT NOT NULL, mutation TEXT NOT NULL, revision INTEGER NOT NULL,
                    PRIMARY KEY(player, mutation));
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute("PRAGMA foreign_keys=ON")
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def session(self, kind, identity=None):
        player = identity or secrets.token_hex(32)
        token = secrets.token_hex(32)
        now = int(time.time())
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO players VALUES (?,?,?)", (player, kind, now))
            db.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
            db.execute("INSERT INTO sessions VALUES (?,?,?)", (
                hashlib.sha256(token.encode()).hexdigest(), player, now + 30 * 86400 if kind == "wechat" else None))
        return {"token": token, "player": player, **self.read(player)}

    def authenticate(self, token):
        if not TOKEN_RE.fullmatch(token):
            return None
        with self.connect() as db:
            row = db.execute("SELECT player FROM sessions WHERE digest=? AND (expires_at IS NULL OR expires_at>?)",
                             (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone()
            return row["player"] if row else None

    def read(self, player, db=None):
        if db is None:
            with self.connect() as connection:
                return self.read(player, connection)
        row = db.execute("SELECT revision,payload FROM progress WHERE player=?", (player,)).fetchone()
        return {"revision": row["revision"], "progress": json.loads(row["payload"])} if row else {"revision": 0, "progress": None}

    def save(self, player, revision, mutation, progress):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = self.read(player, db)
            previous = db.execute("SELECT revision FROM mutations WHERE player=? AND mutation=?", (player, mutation)).fetchone()
            if previous and previous["revision"] == current["revision"]:
                return 200, {"revision": current["revision"]}
            if previous or current["revision"] != revision:
                return 409, current
            next_revision = revision + 1
            db.execute("INSERT INTO progress VALUES (?,?,?,?,?) ON CONFLICT(player) DO UPDATE SET "
                       "revision=excluded.revision,payload=excluded.payload,mutation=excluded.mutation,updated_at=excluded.updated_at",
                       (player, next_revision, json.dumps(progress, separators=(",", ":")), mutation, int(time.time())))
            db.execute("INSERT INTO mutations VALUES (?,?,?)", (player, mutation, next_revision))
            db.execute("DELETE FROM mutations WHERE player=? AND revision<?", (player, next_revision - 100))
            return 200, {"revision": next_revision}


class ApiServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, database, appid="", secret="", origins=()):
        super().__init__(address, Handler)
        self.database, self.appid, self.secret = database, appid, secret
        self.origins = set(origins)
        self.rate_lock = threading.Lock()
        self.rates = {}

    def rate_allowed(self, address):
        now = time.monotonic()
        with self.rate_lock:
            if len(self.rates) > 10000:
                self.rates = {key: q for key, q in self.rates.items() if q and q[-1] > now - 60}
                if len(self.rates) > 10000:
                    return False
            queue = self.rates.setdefault(address, deque())
            while queue and queue[0] <= now - 60:
                queue.popleft()
            if len(queue) >= 180:
                return False
            queue.append(now)
            return True


class Handler(BaseHTTPRequestHandler):
    server_version = "BlocksProgress/1"

    def log_message(self, _format, *_args):
        pass  # Do not log tokens, login codes, progress, or player identifiers.

    def reply(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        origin = self.headers.get("Origin", "")
        if origin in self.server.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization,Content-Type")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.reply(200, {})

    def do_GET(self):
        self.handle_api()

    def do_POST(self):
        self.handle_api()

    def do_PUT(self):
        self.handle_api()

    def handle_api(self):
        try:
            self.connection.settimeout(10)
            origin = self.headers.get("Origin", "")
            if origin and origin not in self.server.origins:
                return self.reply(403, {"error": "origin_not_allowed"})
            if self.path == "/health" and self.command == "GET":
                with self.server.database.connect() as db:
                    db.execute("SELECT 1").fetchone()
                return self.reply(200, {"ok": True, "wechatLoginConfigured": bool(self.server.secret)})
            # X-Real-IP is overwritten by the local Nginx proxy; this server only binds loopback.
            address = self.headers.get("X-Real-IP", self.client_address[0])
            if not self.server.rate_allowed(address):
                return self.reply(429, {"error": "rate_limited"})
            data = {}
            if self.command in ("POST", "PUT"):
                if self.headers.get("Transfer-Encoding"):
                    return self.reply(400, {"error": "content_length_required"})
                length = int(self.headers.get("Content-Length", "0"))
                if length < 0 or length > MAX_BODY:
                    return self.reply(413, {"error": "payload_too_large"})
                data = json.loads(self.rfile.read(length) or b"{}")
                if not isinstance(data, dict):
                    return self.reply(400, {"error": "invalid_body"})
            if self.path == "/session/guest" and self.command == "POST":
                return self.reply(200, self.server.database.session("guest"))
            if self.path == "/session/wechat" and self.command == "POST":
                return self.wechat_session(data)
            if self.path != "/progress" or self.command not in ("GET", "PUT"):
                return self.reply(404, {"error": "not_found"})
            token = self.headers.get("Authorization", "").removeprefix("Bearer ")
            player = self.server.database.authenticate(token)
            if not player:
                return self.reply(401, {"error": "invalid_session"})
            if self.command == "GET":
                return self.reply(200, self.server.database.read(player))
            if (not integer(data.get("revision"), 0, 2 ** 53 - 1)
                    or not isinstance(data.get("mutation"), str)
                    or not re.fullmatch(r"[a-zA-Z0-9_-]{8,128}", data["mutation"])
                    or not valid_progress(data.get("progress"))):
                return self.reply(400, {"error": "invalid_progress"})
            status, result = self.server.database.save(player, data["revision"], data["mutation"], data["progress"])
            return self.reply(status, result)
        except (ValueError, UnicodeError, TypeError):
            self.reply(400, {"error": "invalid_body"})
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except Exception:
            self.reply(500, {"error": "server_error"})

    def wechat_session(self, data):
        if not self.server.appid or not self.server.secret:
            return self.reply(503, {"error": "wechat_login_not_configured"})
        code = data.get("code")
        if not isinstance(code, str) or not 1 <= len(code) <= 256:
            return self.reply(400, {"error": "invalid_code"})
        query = urllib.parse.urlencode({"appid": self.server.appid, "secret": self.server.secret,
                                       "js_code": code, "grant_type": "authorization_code"})
        try:
            with urllib.request.urlopen("https://api.weixin.qq.com/sns/jscode2session?" + query, timeout=5) as response:
                result = json.load(response)
        except Exception:
            return self.reply(502, {"error": "wechat_unavailable"})
        if not isinstance(result.get("openid"), str) or not result["openid"]:
            return self.reply(401, {"error": "wechat_login_failed"})
        player = hashlib.sha256((self.server.appid + ":" + result["openid"]).encode()).hexdigest()
        return self.reply(200, self.server.database.session("wechat", player))


def main():
    database = Database(os.environ.get("PROGRESS_DB", "/var/lib/wechat-blocks/progress.sqlite3"))
    server = ApiServer(("127.0.0.1", int(os.environ.get("PORT", "3040"))), database,
                       os.environ.get("WECHAT_APP_ID", ""), os.environ.get("WECHAT_APP_SECRET", ""),
                       os.environ.get("ALLOWED_ORIGINS", "https://www.sunny-string.cn,http://127.0.0.1:3000,http://localhost:3000").split(","))
    print("Progress API listening on loopback", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
