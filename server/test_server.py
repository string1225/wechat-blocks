import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from server import ApiServer, Database, valid_progress, level_dimensions, MAX_BODY


def sample():
    return {"version": 1, "level": 1, "moves": 0, "phase": "playing", "powerups": {"undo": 5, "bomb": 3},
            "blocks": [[0, 0, 0, 0]], "history": []}


class ProgressTests(unittest.TestCase):
    def test_growing_levels_match_client_gradient_and_round_trip(self):
        table = json.loads((Path(__file__).parent.parent / "test/fixtures/difficulty.json").read_text())
        for row in table:
            dimensions = (row["x"], row["y"], row["z"])
            self.assertEqual(level_dimensions(row["level"], 3), dimensions)
            progress = {**sample(), "version": 3, "level": row["level"],
                        "blocks": [[0, row["x"] - 1, row["y"] - 1, row["z"] - 1]]}
            self.assertTrue(valid_progress(progress))
            progress["blocks"][0][2] = row["y"]
            self.assertFalse(valid_progress(progress))
        _, session = self.request("/session/guest", "POST")
        progress = {**sample(), "version": 2, "level": 1000, "blocks": [[1727, 11, 11, 11]]}
        self.assertEqual(self.request("/progress", "PUT", session["token"],
                                     {"revision": 0, "mutation": "growing-level", "progress": progress})[0], 200)
        self.assertEqual(self.request("/progress", token=session["token"])[1]["progress"], progress)
        progress["version"] = 1
        self.assertFalse(valid_progress(progress))

    def test_legacy_dimensions_and_elapsed_time(self):
        table = json.loads((Path(__file__).parent.parent / "test/fixtures/difficulty-v2.json").read_text())
        for row in table:
            self.assertEqual(level_dimensions(row["level"], 2), (row["x"], row["y"], row["z"]))
        progress = {**sample(), "version": 3, "level": 101, "elapsedMs": 61023, "blocks": [[809, 9, 8, 8]]}
        self.assertTrue(valid_progress(progress))
        _, session = self.request("/session/guest", "POST")
        self.assertEqual(self.request("/progress", "PUT", session["token"],
            {"revision": 0, "mutation": "timed-progress", "progress": progress})[0], 200)
        self.assertEqual(self.request("/progress", token=session["token"])[1]["progress"], progress)
        for bad in [-1, 0.5, True, None, "100", 9007199254740992]:
            self.assertFalse(valid_progress({**progress, "elapsedMs": bad}))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "progress.sqlite3"
        self.db = Database(self.path)
        self.server = ApiServer(("127.0.0.1", 0), self.db, origins=["http://localhost:3000"])
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, method="GET", token=None, body=None, headers=None):
        headers = dict(headers or {})
        if token:
            headers["Authorization"] = "Bearer " + token
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.url + path, data=data, method=method, headers=headers)
        try:
            response = urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def test_isolation_durability_conflicts_and_idempotency(self):
        _, one = self.request("/session/guest", "POST")
        _, two = self.request("/session/guest", "POST")
        body = {"revision": 0, "mutation": "first-mutation", "progress": sample()}
        self.assertEqual(self.request("/progress", "PUT", one["token"], body), (200, {"revision": 1}))
        self.assertEqual(self.request("/progress", "PUT", one["token"], body), (200, {"revision": 1}))
        self.assertEqual(self.request("/progress", token=two["token"])[1]["progress"], None)
        body["mutation"] = "stale-mutation"
        self.assertEqual(self.request("/progress", "PUT", one["token"], body)[0], 409)
        reopened = Database(self.path)
        self.assertEqual(reopened.read(one["player"])["progress"], sample())
        self.assertEqual(reopened.authenticate(one["token"]), one["player"])
        self.assertEqual(self.request("/progress")[0], 401)
        self.assertEqual(self.request("/progress", token="invalid")[0], 401)

    def test_invalid_data_and_origin_are_rejected(self):
        _, session = self.request("/session/guest", "POST")
        bad = sample()
        bad["blocks"] *= 2
        self.assertFalse(valid_progress(bad))
        self.assertEqual(self.request("/progress", "PUT", session["token"],
                                     {"revision": 0, "mutation": "bad-mutation", "progress": bad})[0], 400)
        self.assertEqual(self.request("/session/guest", "POST", headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("/session/wechat", "POST", body={"code": "code"})[0], 503)
        import http.client
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        client.request("PUT", "/progress", headers={"Content-Length": str(MAX_BODY + 1)})
        self.assertEqual(client.getresponse().status, 413)
        client.close()

    def test_wechat_exchanges_code_only_server_side_and_reuses_identity(self):
        self.server.appid, self.server.secret = "test-app", "server-only-secret"
        import io
        def response(*args, **kwargs):
            return io.BytesIO(json.dumps({"openid": "same-user", "session_key": "never-return-this"}).encode())
        with patch("server.urllib.request.urlopen", side_effect=response):
            # Use http.client so the mocked WeChat client does not intercept the test request.
            import http.client
            sessions = []
            for _ in range(2):
                client = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
                client.request("POST", "/session/wechat", json.dumps({"code": "temporary-code"}))
                result = client.getresponse()
                self.assertEqual(result.status, 200)
                payload = json.loads(result.read())
                self.assertNotIn("session_key", payload)
                self.assertNotIn("openid", payload)
                sessions.append(payload)
                client.close()
        self.assertEqual(sessions[0]["player"], sessions[1]["player"])
        self.assertNotEqual(sessions[0]["token"], sessions[1]["token"])
        self.db.save(sessions[0]["player"], 0, "one-write", sample())
        self.assertEqual(self.request("/progress", token=sessions[1]["token"])[1]["progress"], sample())

    def test_concurrent_writes_have_one_winner(self):
        from concurrent.futures import ThreadPoolExecutor
        session = self.db.session("guest")
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda n: self.db.save(session["player"], 0, "mutation-" + str(n), sample()), range(2)))
        self.assertEqual(sorted(status for status, _ in results), [200, 409])


if __name__ == "__main__":
    unittest.main()
