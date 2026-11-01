"""A tiny synchronous HTTP client for running inside a browser Web Worker (Pyodide).

httpx can't open sockets in WebAssembly. Synchronous XMLHttpRequest is allowed inside a Web Worker,
which keeps the rest of the code (Plaid sync, FX refresh) unchanged and synchronous.
"""
from __future__ import annotations

import json as _json
import sys

IN_BROWSER = sys.platform == "emscripten"


class Response:
    def __init__(self, status: int, text: str):
        self.status_code = status
        self.text = text

    def json(self):
        return _json.loads(self.text)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}: {self.text[:200]}")


class XHRClient:
    def _request(self, method: str, url: str, body: str | None = None, headers: dict | None = None) -> Response:
        from js import XMLHttpRequest  # only available under Pyodide
        x = XMLHttpRequest.new()
        x.open(method, url, False)
        for k, v in (headers or {}).items():
            x.setRequestHeader(k, v)
        x.send(body)
        return Response(int(x.status), str(x.responseText))

    def get(self, url: str, headers: dict | None = None) -> Response:
        return self._request("GET", url, None, headers)

    def post(self, url: str, json=None, headers: dict | None = None) -> Response:
        h = {"Content-Type": "application/json", **(headers or {})}
        return self._request("POST", url, _json.dumps(json) if json is not None else None, h)


def default_client(timeout: float = 60):
    if IN_BROWSER:
        return XHRClient()
    import httpx
    return httpx.Client(timeout=timeout)
