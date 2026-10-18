# Tcl/Tk.wasm

Browser port of Tcl/Tk, built with Emscripten.

Tcl/Tk version: 8.6.18

## License

Original project code is licensed under the [MIT License](LICENSE). The
Tcl/Tk sources, browser overlays and patches, x11.wasm headers and tables, and
other bundled third-party code retain their respective license terms.
See [Third-Party Notices](THIRD_PARTY_NOTICES.md) and [LICENSES](LICENSES/).

The browser build includes the license texts in `build/browser/`, and the
GitHub Pages deployment publishes them alongside the app. To collect only
the notices, run `ninja -f build.ninja licenses`. Include these notices when
redistributing the port or integrating its build outputs into another app.
