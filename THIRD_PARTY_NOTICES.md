# Third-Party Notices

Original tcltk.wasm code is licensed under the MIT License in `LICENSE`, except
for the Tcl/Tk overlays and patches identified below. Bundled third-party code
retains its own copyright notices and license terms; the root MIT license does
not replace them. Paths in this document refer to the source repository.

## Tcl and Tk

Upstream: <https://github.com/tcltk/tcl> and <https://github.com/tcltk/tk>.

The `third-party/tcl` and `third-party/tk` submodules contain Tcl/Tk 8.6.18.
Their respective `license.terms` files are reproduced verbatim in
`LICENSES/Tcl.txt` and `LICENSES/Tk.txt`. Individual upstream files may carry
additional terms, which remain in effect.

The browser port changes the upstream Unix time and event backends, Xlib
integration, the generic window event mask, and font drawing. The files under
`browser/tcl/` and `browser/tk/`, including the project's modifications and
patches, are distributed under the corresponding Tcl or Tk license rather
than the root MIT license. They are modified browser-port code, not unmodified
upstream Tcl/Tk. Existing upstream notices are retained.

The following additional notices are reproduced in `LICENSES/Tcl-Tk-extra.txt`:

- Henry Spencer's regular expression engine (`third-party/tcl/generic/reg*`
  and `tclRegexp.c`).
- NetBSD-derived file operations (`third-party/tcl/unix/tclUnixFCmd.c`).
- The RFC 2553 compatibility code (`third-party/tcl/compat/fake-rfc2553.*`).
- The GNU Bison parser skeleton in `third-party/tcl/generic/tclDate.c`,
  including its special exception permitting distribution of a larger work
  under terms of the distributor's choice. The exception is retained.
- David Koblas's giftoppm code in `third-party/tk/generic/tkImgGIF.c`.
- Adobe procset copyright notices embedded in the unchanged EPS files under
  `third-party/tk/library/images/`.

The original source distributions also include platform-specific code, tests,
build tools, and contributed examples with their own in-file notices. Preserve
these notices when redistributing the source trees; this inventory does not
relicense those files.

## LibTomMath

Source: `third-party/tcl/libtommath/` and Tcl's related TomMath headers.
Upstream: <https://www.libtom.net/LibTomMath/>.

The bundled LibTomMath license is reproduced verbatim in
`LICENSES/LibTomMath.txt` (public-domain dedication and fallback terms).

## zlib

Source: `third-party/tcl/compat/zlib/`.
Upstream: <https://zlib.net/>.

The bundled zlib license is reproduced verbatim in `LICENSES/zlib.txt`.
The source tree includes additional licenses for optional `contrib/` code;
these files retain their original terms. Inclusion of this notice does not
imply that every optional component is linked into the browser build.

## x11.wasm and X11 Headers

Source: `third-party/x11.wasm/`.
Upstream: <https://github.com/t3tra-dev/x11.wasm>.

Original x11.wasm code is MIT-licensed. Its X11-derived public headers and
generated tables have additional upstream notices described in that
submodule's `THIRD_PARTY_NOTICES.md`. Keep its `LICENSE`,
`THIRD_PARTY_NOTICES.md`, and entire `LICENSES/` directory when distributing
x11.wasm or binaries containing it. The browser distribution collects these
under `LICENSES/x11.wasm/`.

## Redistribution

Source distributions must retain the applicable notices in the submodules and
overlays. Browser distributions must accompany the JavaScript, WebAssembly,
and preloaded Tcl/Tk data with `LICENSE`, this document, and the complete
`LICENSES/` directory. `ninja -f build.ninja licenses` collects these files in
`build/browser/`; the `browser` target and GitHub Pages workflow include them
automatically. When packaging a library or integrating the port into another
application, include the same applicable license and notice files in that
distribution's license materials.
