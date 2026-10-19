# Tcl/Tk.wasm

Browser port of Tcl/Tk, built with Emscripten.

Tcl/Tk version: 8.6.18

## Chrome Test Logs

On POSIX systems, Chrome crash reporting or updater descendants may retain
its stderr pipe and delay Playwright shutdown. Opt into per-run regular-file
logging without changing the installed Chrome, test timeouts, or exit status:

```sh
PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_CHROME_STDIO_DIR=build/internal/chrome-stdio npm run test:browser -- --workers=1
```

Logs are retained at the printed `run-*/chrome-<pid>.log` path under that
directory. The wrapper preserves the Chrome PID, arguments, and CDP pipes.
Set `PLAYWRIGHT_CHROME_EXECUTABLE` only when installed Chrome is at a custom
absolute path. Without `PLAYWRIGHT_CHROME_STDIO_DIR`, launch behavior is unchanged.

## Browser Sample

After `ninja -f build.ninja browser`, run
`python3 browser/app/server.py --port 8766` and open
`http://127.0.0.1:8766/app.html`. The Tcl shell, User Window, IME fields,
and native dialog checks remain available in the sample.

The sample opts into the browser window manager before runtime startup.
Use the **Window manager** checkbox to enable or disable its decorations.
**WM sample** opens normal, dialog, utility, transient grid, and undecorated
popup windows. The normal window has min/max and aspect constraints, the
dialog is fixed size, and the utility resizes horizontally. **Allow close**
controls the sample's `WM_DELETE_WINDOW` handler. Reopening **WM sample**
resets its windows. The library itself keeps the manager disabled by default.

The initial IME client fits the sample work area. Its form reflows on narrow
screens, with a native vertical scrollbar for the remaining checks and a
horizontal scrollbar for the text-drawing canvas. These layout choices apply
only to the sample, not to arbitrary application windows.

## License

Original project code is licensed under the [MIT License](LICENSE). The
Tcl/Tk sources, browser overlays and patches, x11.wasm headers and tables, and
other bundled third-party code retain their respective license terms.
See [Third-Party Notices](THIRD_PARTY_NOTICES.md) and [LICENSES](LICENSES/).

The browser build includes the license texts in `build/browser/`, and the
GitHub Pages deployment publishes them alongside the app. To collect only
the notices, run `ninja -f build.ninja licenses`. Include these notices when
redistributing the port or integrating its build outputs into another app.
