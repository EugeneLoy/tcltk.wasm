#!/usr/bin/env python3
"""Serve the browser Tcl/Tk app and the Emscripten build artifacts."""

from __future__ import annotations

import argparse
import contextlib
import errno
import posixpath
import subprocess
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


APP_DIR = Path(__file__).resolve().parent
REPO_ROOT = APP_DIR.parent.parent
BUILD_DIR = REPO_ROOT / "build" / "browser"
BUILD_FILES = {"tcltk.js", "tcltk.wasm", "tcltk.data", "tcltk.html"}
REQUIRED_BUILD_FILES = {"tcltk.js", "tcltk.wasm", "tcltk.data"}


class TclTkAppHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".data": "application/octet-stream",
        ".js": "text/javascript; charset=utf-8",
        ".wasm": "application/wasm",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

    def log_message(self, format, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def translate_path(self, path):
        request_path = unquote(urlparse(path).path)
        normalized = posixpath.normpath(request_path)
        if normalized in {".", "/"}:
            return str(APP_DIR / "app.html")

        relative = normalized.lstrip("/")
        if relative == "app.html":
            return str(APP_DIR / "app.html")
        if relative in BUILD_FILES:
            return str(BUILD_DIR / relative)
        if relative.startswith("build/browser/"):
            return str(safe_join(BUILD_DIR, relative[len("build/browser/") :]))
        return str(safe_join(APP_DIR, relative))


def safe_join(root: Path, relative: str) -> Path:
    clean_parts = []
    for part in relative.split("/"):
        if part in {"", ".", ".."}:
            continue
        clean_parts.append(part)
    return root.joinpath(*clean_parts)


def missing_build_files() -> list[Path]:
    return sorted(
        path for path in (BUILD_DIR / name for name in REQUIRED_BUILD_FILES)
        if not path.is_file()
    )


def build_browser() -> None:
    subprocess.run(
        ["ninja", "-f", "build.ninja", "browser"],
        cwd=REPO_ROOT,
        check=True,
    )


def create_server(host: str, port: int) -> ThreadingHTTPServer:
    attempts = [port] if port == 0 else list(range(port, port + 20))
    last_error: OSError | None = None
    for candidate in attempts:
        try:
            return ThreadingHTTPServer((host, candidate), TclTkAppHandler)
        except OSError as error:
            last_error = error
            if error.errno != errno.EADDRINUSE:
                raise
    assert last_error is not None
    raise last_error


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8766, type=int)
    parser.add_argument(
        "--build",
        action="store_true",
        help="run `ninja -f build.ninja browser` before serving if needed",
    )
    parser.add_argument("--open", action="store_true", help="open the app URL")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    missing = missing_build_files()

    if missing and args.build:
        build_browser()
        missing = missing_build_files()
    if missing:
        print("Missing browser build artifacts:", file=sys.stderr)
        for path in missing:
            print(f"  {path}", file=sys.stderr)
        print(
            "Run `ninja -f build.ninja browser` or restart this server with --build.",
            file=sys.stderr,
        )
        return 2

    with create_server(args.host, args.port) as httpd:
        host, port = httpd.server_address[:2]
        url = f"http://{host}:{port}/app.html"
        print(f"Serving Tcl/Tk WASM app at {url}", flush=True)
        print(f"Using build artifacts from {BUILD_DIR}", flush=True)
        if args.open:
            with contextlib.suppress(Exception):
                webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
