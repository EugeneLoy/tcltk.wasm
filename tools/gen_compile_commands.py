#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
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


def ensure_emscripten_sysroot(root: Path, compiler: str) -> Path:
    emcache = root / "build/emscripten/em-cache"
    sysroot = emcache / "sysroot"
    if sysroot.exists():
        return sysroot

    emcache.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "EM_CACHE": str(emcache)}
    subprocess.run(
        [compiler, "-x", "c", "-fsyntax-only", os.devnull],
        cwd=root,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return sysroot


def emscripten_tooling_flags(root: Path, compiler: str) -> list[str]:
    sysroot = ensure_emscripten_sysroot(root, compiler)
    return [
        "--target=wasm32-unknown-emscripten",
        f"--sysroot={sysroot}",
    ]


def with_tooling_flags(tokens: list[str], tooling_flags: list[str]) -> list[str]:
    if not tooling_flags:
        return tokens
    existing = set(tokens)
    missing = [flag for flag in tooling_flags if flag not in existing]
    if not missing:
        return tokens
    return [tokens[0], *missing, *tokens[1:]]


def collect_from_make(
    root: Path,
    build_dir: Path,
    extra_args: list[str],
    tooling_flags: list[str],
) -> list[dict[str, object]]:
    command = ["make", "-n", "-B", "-o", "Makefile", "-C", str(build_dir), *extra_args]
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

    entries: list[dict[str, object]] = []
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
        tokens = with_tooling_flags(tokens, tooling_flags)
        source_path = Path(source)
        if not source_path.is_absolute():
            source_path = build_dir / source_path

        entries.append(
            {
                "directory": str(build_dir),
                "arguments": tokens,
                "command": shlex.join(tokens),
                "file": str(source_path.resolve()),
            }
        )
    return entries


def compile_entry(
    root: Path,
    compiler: str,
    source: Path,
    output: Path,
    includes: list[Path],
    tooling_flags: list[str],
    defines: list[str] | None = None,
) -> dict[str, object]:
    args = [
        compiler,
        *tooling_flags,
        "-c",
        *(f"-I{path}" for path in includes),
        *(defines or []),
        str(source),
        "-o",
        str(output),
    ]
    return {
        "directory": str(root),
        "arguments": args,
        "command": shlex.join(args),
        "file": str(source),
    }


def browser_app_entries(
    root: Path,
    compiler: str,
    tooling_flags: list[str],
) -> list[dict[str, object]]:
    x11_src = root / "third-party/x11.wasm"
    tcl_src = root / "third-party/tcl"
    tk_src = root / "third-party/tk"
    tcl_build = root / "build/emscripten/tcl"
    tk_build = root / "build/emscripten/tk"
    tcl_overlay = root / "build/emscripten/overlay/tcl/unix"
    tk_overlay = root / "build/emscripten/overlay/tk/unix"
    tk_generic_overlay = root / "build/emscripten/overlay/tk/generic"
    app_includes = [
        x11_src / "include",
        tcl_build,
        tcl_src / "generic",
        tcl_src / "unix",
        tcl_overlay,
        tk_build,
        tk_generic_overlay,
        tk_src / "unix",
        tk_overlay,
        tk_src / "xlib",
    ]
    return [
        compile_entry(
            root,
            compiler,
            root / "browser/app/main.c",
            root / "build/emscripten/browser/main.o",
            app_includes,
            tooling_flags,
            ["-DSTATIC_BUILD=1"],
        ),
    ]


def x11wasm_sources(root: Path) -> list[tuple[Path, Path]]:
    x11_src = root / "third-party/x11.wasm"
    x11_ninja = x11_src / "ninja/x11wasm.ninja"
    if not x11_ninja.exists():
        return []

    pattern = re.compile(
        r"^build\s+\$x11wasm_builddir/(?P<object>[^:\s]+):\s+"
        r"x11wasm_compile_c\s+\$x11wasm_root/(?P<source>[^\s|]+)"
    )
    sources: list[tuple[Path, Path]] = []
    for line in x11_ninja.read_text().splitlines():
        match = pattern.match(line)
        if match is None:
            continue
        source = x11_src / match.group("source")
        output = root / "build/emscripten/x11" / match.group("object")
        sources.append((source, output))
    return sources


def x11wasm_entries(
    root: Path,
    compiler: str,
    tooling_flags: list[str],
) -> list[dict[str, object]]:
    x11_src = root / "third-party/x11.wasm"
    return [
        compile_entry(
            root,
            compiler,
            source,
            output,
            [x11_src / "include"],
            tooling_flags,
            ["-DSTATIC_BUILD=1"],
        )
        for source, output in x11wasm_sources(root)
    ]


def write_compile_commands(output: Path, entries: list[dict[str, object]]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    tmp = output.with_suffix(output.suffix + ".tmp")
    tmp.write_text(json.dumps(entries, indent=2) + "\n")
    os.replace(tmp, output)
    print(f"wrote {output} ({len(entries)} entries)")


def main():
    args = parse_args()
    root = Path.cwd().resolve()
    output = (root / args.output).resolve()
    compiler = shutil.which("emcc") or "emcc"
    tooling_flags = emscripten_tooling_flags(root, compiler)

    tcl_build = root / "build/emscripten/tcl"
    tk_build = root / "build/emscripten/tk"
    tcl_overlay = root / "build/emscripten/overlay/tcl/unix"
    tk_overlay = root / "build/emscripten/overlay/tk/unix"
    tk_generic_overlay = root / "build/emscripten/overlay/tk/generic"
    x11_include = root / "third-party/x11.wasm/include"
    tk_xlib = root / "third-party/tk/xlib"

    builds = [
        (tcl_build, [f"UNIX_DIR={tcl_overlay}", "libtcl8.6.a"]),
        (
            tk_build,
            [
                f"UNIX_DIR={tk_overlay}",
                f"GENERIC_DIR={tk_generic_overlay}",
                f"X11_INCLUDES=-I{x11_include} -I{tk_xlib}",
                "libtk8.6.a",
            ],
        ),
    ]

    entries: list[dict[str, object]] = []
    seen: set[tuple[str, str, str]] = set()
    for build_dir, extra_args in builds:
        if not (build_dir / "Makefile").exists():
            raise SystemExit(f"missing Makefile: {build_dir / 'Makefile'}")
        for entry in collect_from_make(root, build_dir, extra_args, tooling_flags):
            key = (str(entry["directory"]), str(entry["file"]), str(entry["command"]))
            if key in seen:
                continue
            seen.add(key)
            entries.append(entry)

    for entry in x11wasm_entries(root, compiler, tooling_flags):
        key = (str(entry["directory"]), str(entry["file"]), str(entry["command"]))
        if key not in seen:
            seen.add(key)
            entries.append(entry)

    for entry in browser_app_entries(root, compiler, tooling_flags):
        key = (str(entry["directory"]), str(entry["file"]), str(entry["command"]))
        if key not in seen:
            entries.append(entry)

    write_compile_commands(output, entries)


if __name__ == "__main__":
    main()
