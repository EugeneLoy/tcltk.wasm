#!/usr/bin/env python3
import argparse
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path


SOURCE_SUFFIXES = (".c", ".cc", ".cpp", ".cxx", ".m", ".mm")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default="build/compile_commands.json",
        help="Path to the compile_commands.json file to write.",
    )
    return parser.parse_args()


def source_from_tokens(tokens: list[str]) -> str | None:
    for token in reversed(tokens):
        if token.endswith(SOURCE_SUFFIXES):
            return token
    return None


def is_compile_command(tokens: list[str]) -> bool:
    if "-c" not in tokens:
        return False
    return any(Path(token).name == "emcc" for token in tokens)


def collect_from_make(root: Path, build_dir: Path, extra_args: list[str]) -> list[dict[str, str]]:
    command = ["make", "-n", "-B", "-C", str(build_dir), *extra_args]
    result = subprocess.run(
        command,
        cwd=root,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stdout)
        raise SystemExit(result.returncode)

    entries: list[dict[str, str]] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("make: "):
            continue
        try:
            tokens = shlex.split(line)
        except ValueError:
            continue
        if not is_compile_command(tokens):
            continue

        source = source_from_tokens(tokens)
        if source is None:
            continue
        source_path = Path(source)
        if not source_path.is_absolute():
            source_path = build_dir / source_path

        entries.append(
            {
                "directory": str(build_dir),
                "command": line,
                "file": str(source_path.resolve()),
            }
        )
    return entries


def main():
    args = parse_args()
    root = Path.cwd().resolve()
    output = (root / args.output).resolve()

    tcl_build = root / "build/emscripten/tcl"
    tk_build = root / "build/emscripten/tk"
    tcl_overlay = root / "build/emscripten/overlay/tcl/unix"
    tk_overlay = root / "build/emscripten/overlay/tk/unix"

    builds = [
        (tcl_build, [f"UNIX_DIR={tcl_overlay}", "libtcl8.6.a"]),
        (tk_build, [f"UNIX_DIR={tk_overlay}", "libtk8.6.a"]),
    ]

    entries: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for build_dir, extra_args in builds:
        if not (build_dir / "Makefile").exists():
            raise SystemExit(f"missing Makefile: {build_dir / 'Makefile'}")
        for entry in collect_from_make(root, build_dir, extra_args):
            key = (entry["directory"], entry["file"], entry["command"])
            if key in seen:
                continue
            seen.add(key)
            entries.append(entry)

    output.parent.mkdir(parents=True, exist_ok=True)
    tmp = output.with_suffix(output.suffix + ".tmp")
    tmp.write_text(json.dumps(entries, indent=2) + "\n")
    os.replace(tmp, output)
    print(f"wrote {output} ({len(entries)} entries)")


if __name__ == "__main__":
    main()
