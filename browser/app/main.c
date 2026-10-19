/*
 * main.c --
 *
 *	Minimal browser executable for Tcl/Tk on WebAssembly. This is a
 *	diagnostic harness: it initializes Tcl/Tk, runs a tiny script, and keeps
 *	Tcl's event loop pumping from the browser main loop.
 */

#include <emscripten.h>
#include <emscripten/em_js.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <tcl.h>
#include <tk.h>

extern int TkBrowserServiceXEvents(void);

static Tcl_Interp *browserInterp;

static const char *demoScript =
    "namespace eval ::browser {}\n"
    "set ::browserInput {}\n"
    "set ::browserPreedit {}\n"
    "bind all <<X11WasmCompositionStart>> {\n"
    "    set ::browserPreedit %d\n"
    "    browser::setStatus \"preedit:$::browserPreedit\"\n"
    "}\n"
    "bind all <<X11WasmCompositionUpdate>> {\n"
    "    set ::browserPreedit %d\n"
    "    browser::setStatus \"preedit:$::browserPreedit\"\n"
    "}\n"
    "bind all <<X11WasmCompositionEnd>> {\n"
    "    set ::browserPreedit {}\n"
    "}\n"
    "bind all <Key> {\n"
    "    append ::browserInput %A\n"
    "    browser::setStatus \"input:$::browserInput\"\n"
    "}\n"
    "wm title . {Tcl/Tk WASM}\n"
    "frame .root -background white -padx 18 -pady 18\n"
    "label .root.title -text {Tcl/Tk WASM} -font {Helvetica 18 bold}\n"
    "label .root.body -text {Browser backend smoke test}\n"
    "entry .root.input\n"
    "button .root.button -text {Click me} -command {puts {button clicked}}\n"
    "pack .root.title .root.body .root.input .root.button -side top -anchor w -pady 4\n"
    "pack .root -fill both -expand 1\n"
    "update idletasks\n"
    "focus -force .root\n"
    "update idletasks\n";

static const char *shortcutScript =
    "proc ::browser::installShortcutBindings {} {\n"
    "    foreach {event sequences} {\n"
    "        <<Cut>> {<Meta-Key-x> <Meta-Lock-Key-X>}\n"
    "        <<Copy>> {<Meta-Key-c> <Meta-Lock-Key-C>}\n"
    "        <<Paste>> {<Meta-Key-v> <Meta-Lock-Key-V>}\n"
    "        <<Undo>> {<Meta-Key-z> <Meta-Lock-Key-Z>}\n"
    "        <<Redo>> {<Meta-Key-y> <Meta-Lock-Key-Y> <Shift-Meta-Key-z> <Shift-Meta-Lock-Key-Z>}\n"
    "        <<SelectAll>> {<Meta-Key-a> <Meta-Lock-Key-A>}\n"
    "    } {\n"
    "        foreach sequence $sequences {\n"
    "            catch {event add $event $sequence}\n"
    "        }\n"
    "    }\n"
    "}\n"
    "::browser::installShortcutBindings\n";

static const char *nativeDialogScript =
    "namespace eval ::tk::browser {}\n"
    "foreach {name fallback} {\n"
    "    tk_chooseColor chooseColorFallback\n"
    "    tk_chooseDirectory chooseDirectoryFallback\n"
    "    tk_getOpenFile getOpenFileFallback\n"
    "    tk_getSaveFile getSaveFileFallback\n"
    "    tk_messageBox messageBoxFallback\n"
    "} {\n"
    "    if {[llength [info commands ::$name]]\n"
    "            && ![llength [info commands ::tk::browser::$fallback]]} {\n"
    "        rename ::$name ::tk::browser::$fallback\n"
    "    }\n"
    "}\n"
    "proc ::tk::browser::nativeOrFallback {native fallback args} {\n"
    "    set code [catch {{*}$native {*}$args} result options]\n"
    "    if {$code == 0} {return $result}\n"
    "    if {[dict exists $options -errorcode]\n"
    "            && [lrange [dict get $options -errorcode] 0 2] eq {TK BROWSER DIALOG_UNAVAILABLE}\n"
    "            && [llength [info commands $fallback]]} {\n"
    "        set fallbackCode [catch {{*}$fallback {*}$args} fallbackResult fallbackOptions]\n"
    "        if {$fallbackCode == 0} {return $fallbackResult}\n"
    "        if {$fallbackCode != 1} {return -options $fallbackOptions $fallbackResult}\n"
    "    }\n"
    "    return -options $options $result\n"
    "}\n"
    "proc ::tk_chooseColor {args} {\n"
    "    return [::tk::browser::nativeOrFallback ::browser::chooseColor ::tk::browser::chooseColorFallback {*}$args]\n"
    "}\n"
    "proc ::tk_chooseDirectory {args} {\n"
    "    return [::tk::browser::nativeOrFallback ::browser::chooseDirectory ::tk::browser::chooseDirectoryFallback {*}$args]\n"
    "}\n"
    "proc ::tk_getOpenFile {args} {\n"
    "    return [::tk::browser::nativeOrFallback ::browser::getOpenFile ::tk::browser::getOpenFileFallback {*}$args]\n"
    "}\n"
    "proc ::tk_getSaveFile {args} {\n"
    "    return [::tk::browser::nativeOrFallback ::browser::getSaveFile ::tk::browser::getSaveFileFallback {*}$args]\n"
    "}\n"
    "proc ::tk_messageBox {args} {\n"
    "    return [::tk::browser::nativeOrFallback ::browser::messageBox ::tk::browser::messageBoxFallback {*}$args]\n"
    "}\n";

static void
BrowserConsole(
    const char *level,
    const char *message)
{
    EM_ASM({
	const level = UTF8ToString($0);
	const message = UTF8ToString($1);
	if (level === "error") {
	    console.error(message);
	} else if (level === "warn") {
	    console.warn(message);
	} else {
	    console.log(message);
	}
    }, level, message);
}

static void
BrowserSetStatusBytes(
    const char *status,
    int length)
{
    EM_ASM({
	const element = document.getElementById("tk-browser-status");
	const text = ($1 >= 0) ? UTF8ToString($0, $1, true) : UTF8ToString($0);
	if (element) {
	    element.textContent = text;
	}
    }, status, length);
}

static void
BrowserSetStatus(
    const char *status)
{
    BrowserSetStatusBytes(status, -1);
}

static void
BrowserSetStatusObj(
    Tcl_Obj *statusObj)
{
    int length;
    const char *status = Tcl_GetStringFromObj(statusObj, &length);

    BrowserSetStatusBytes(status, length);
}

static void
BrowserSetResultBytes(
    int code,
    const char *result,
    int length)
{
    EM_ASM({
	const code = $0;
	const result = ($2 >= 0) ? UTF8ToString($1, $2, true) : UTF8ToString($1);
	const module = globalThis.Module || {};
	globalThis.Module = module;
	module.tkBrowserEvalCode = code;
	module.tkBrowserEvalResult = result;
	module.tkBrowserEvalDone = true;

	const element = document.getElementById("tk-browser-result");
	if (element) {
	    element.textContent = result;
	    element.dataset.code = String(code);
	}
    }, code, result, length);
}

static void
BrowserSetResultObj(
    int code,
    Tcl_Obj *resultObj)
{
    int length;
    const char *result = Tcl_GetStringFromObj(resultObj, &length);

    BrowserSetResultBytes(code, result, length);
}

static int
BrowserEval(
    Tcl_Interp *interp,
    const char *script,
    const char *label)
{
    int code = Tcl_EvalEx(interp, script, -1, TCL_EVAL_GLOBAL);

    if (code != TCL_OK) {
	BrowserConsole("error", label);
	BrowserConsole("error", Tcl_GetStringResult(interp));
    }
    return code;
}

static int
BrowserEvalAndReport(
    Tcl_Interp *interp,
    const char *script,
    const char *label)
{
    int code = BrowserEval(interp, script, label);

    BrowserSetResultObj(code, Tcl_GetObjResult(interp));
    return code;
}

static int
BrowserEvalFileAndReport(
    Tcl_Interp *interp,
    Tcl_Obj *pathObj,
    const char *encodingName,
    const char *label)
{
    int code = Tcl_FSEvalFileEx(interp, pathObj, encodingName);

    if (code != TCL_OK) {
	BrowserConsole("error", label);
	BrowserConsole("error", Tcl_GetStringResult(interp));
    }
    BrowserSetResultObj(code, Tcl_GetObjResult(interp));
    return code;
}

static int
BrowserIsFileOption(
    const char *arg)
{
    size_t length;

    if (arg == NULL) {
	return 0;
    }
    length = strlen(arg);
    return (length > 1) && (length <= strlen("-file"))
	    && (strncmp("-file", arg, length) == 0);
}

static int
BrowserCanBeStartupScript(
    const char *arg)
{
    return (arg != NULL) && (arg[0] != '-');
}

static void
BrowserTestGetWideTime(
    Tcl_Time *timePtr,
    ClientData clientData)
{
    (void)clientData;
    timePtr->sec = 5000;
    timePtr->usec = 123456;
}

static void
BrowserTestScaleWideTime(
    Tcl_Time *timePtr,
    ClientData clientData)
{
    (void)timePtr;
    (void)clientData;
}

EMSCRIPTEN_KEEPALIVE int
TclBrowserTestClockClicksUsesWideTime(void)
{
    Tcl_GetTimeProc *savedGetProc = NULL;
    Tcl_ScaleTimeProc *savedScaleProc = NULL;
    ClientData savedClientData = NULL;
    Tcl_WideInt clicks = 0;
    int code;

    if (browserInterp == NULL) {
	return 0;
    }

    Tcl_QueryTimeProc(&savedGetProc, &savedScaleProc, &savedClientData);
    Tcl_SetTimeProc(BrowserTestGetWideTime, BrowserTestScaleWideTime, NULL);
    code = Tcl_EvalEx(browserInterp, "clock clicks", -1, TCL_EVAL_GLOBAL);
    if (code == TCL_OK) {
	code = Tcl_GetWideIntFromObj(browserInterp,
		Tcl_GetObjResult(browserInterp), &clicks);
    }
    Tcl_SetTimeProc(savedGetProc, savedScaleProc, savedClientData);
    if (code != TCL_OK) {
	return 0;
    }
    return clicks == (Tcl_WideInt)5000123456LL;
}

static int
BrowserDrainTclEvents(void)
{
    int events = 0;

    while (Tcl_DoOneEvent(TCL_ALL_EVENTS | TCL_DONT_WAIT)) {
	events++;
	if (events > 100) {
	    break;
	}
    }
    return events;
}

static int
BrowserDrainQueuedControlEvents(void)
{
    int events = 0;

    while (Tcl_ServiceEvent(TCL_FILE_EVENTS | TCL_TIMER_EVENTS
	    | TCL_IDLE_EVENTS)) {
	events++;
	if (events > 100) {
	    break;
	}
    }
    return events;
}

static int
BrowserDrainWindowEvents(void)
{
    int events = 0;

    while (Tcl_ServiceEvent(TCL_WINDOW_EVENTS)) {
	events++;
	if (events > 1000) {
	    break;
	}
    }
    return events;
}

static int
BrowserStatusCmd(
    ClientData clientData,
    Tcl_Interp *interp,
    int objc,
    Tcl_Obj *const objv[])
{
    (void)clientData;
    if (objc != 2) {
	Tcl_WrongNumArgs(interp, 1, objv, "status");
	return TCL_ERROR;
    }
    BrowserSetStatusObj(objv[1]);
    return TCL_OK;
}

static int
BrowserResultCmd(
    ClientData clientData,
    Tcl_Interp *interp,
    int objc,
    Tcl_Obj *const objv[])
{
    (void)clientData;
    if (objc != 2) {
	Tcl_WrongNumArgs(interp, 1, objv, "result");
	return TCL_ERROR;
    }
    BrowserSetResultObj(TCL_OK, objv[1]);
    return TCL_OK;
}

#define BROWSER_DIALOG_UNSUPPORTED "__TK_BROWSER_DIALOG_UNSUPPORTED__"
#define BROWSER_DIALOG_ERROR_PREFIX "__TK_BROWSER_DIALOG_ERROR__:"

static int
BrowserDialogUnavailable(
    Tcl_Interp *interp,
    const char *message)
{
    Tcl_SetObjResult(interp, Tcl_NewStringObj(message, -1));
    Tcl_SetErrorCode(interp, "TK", "BROWSER", "DIALOG_UNAVAILABLE", NULL);
    return TCL_ERROR;
}

static int
BrowserDialogError(
    Tcl_Interp *interp,
    const char *message)
{
    Tcl_SetObjResult(interp, Tcl_NewStringObj(message, -1));
    Tcl_SetErrorCode(interp, "TK", "BROWSER", "DIALOG_ERROR", NULL);
    return TCL_ERROR;
}

static int
BrowserValidateParent(
    Tcl_Interp *interp,
    const char *parent)
{
    if ((parent == NULL) || (parent[0] == '\0') || (Tk_MainWindow(interp) == NULL)) {
	return TCL_OK;
    }
    return (Tk_NameToWindow(interp, parent, Tk_MainWindow(interp)) != NULL)
	    ? TCL_OK : TCL_ERROR;
}

static int
BrowserDialogStringResult(
    Tcl_Interp *interp,
    char *result)
{
    size_t errorPrefixLength = strlen(BROWSER_DIALOG_ERROR_PREFIX);

    if (result == NULL) {
	return BrowserDialogError(interp, "failed to allocate browser dialog result");
    }
    if (strcmp(result, BROWSER_DIALOG_UNSUPPORTED) == 0) {
	free(result);
	return BrowserDialogUnavailable(interp,
		"browser native dialog is not available");
    }
    if (strncmp(result, BROWSER_DIALOG_ERROR_PREFIX, errorPrefixLength) == 0) {
	Tcl_SetObjResult(interp, Tcl_NewStringObj(
		result + errorPrefixLength, -1));
	free(result);
	Tcl_SetErrorCode(interp, "TK", "BROWSER", "DIALOG_ERROR", NULL);
	return TCL_ERROR;
    }
    Tcl_SetObjResult(interp, Tcl_NewStringObj(result, -1));
    free(result);
    return TCL_OK;
}

static int
BrowserDialogPathListResult(
    Tcl_Interp *interp,
    char *result,
    int multiple)
{
    Tcl_Obj *listObj;
    char *start;
    char *newline;
    size_t errorPrefixLength = strlen(BROWSER_DIALOG_ERROR_PREFIX);

    if (result == NULL) {
	return BrowserDialogError(interp, "failed to allocate browser dialog result");
    }
    if (strcmp(result, BROWSER_DIALOG_UNSUPPORTED) == 0) {
	free(result);
	return BrowserDialogUnavailable(interp,
		"browser native dialog is not available");
    }
    if (strncmp(result, BROWSER_DIALOG_ERROR_PREFIX, errorPrefixLength) == 0) {
	Tcl_SetObjResult(interp, Tcl_NewStringObj(
		result + errorPrefixLength, -1));
	free(result);
	Tcl_SetErrorCode(interp, "TK", "BROWSER", "DIALOG_ERROR", NULL);
	return TCL_ERROR;
    }
    if (result[0] == '\0') {
	Tcl_SetObjResult(interp, Tcl_NewStringObj("", 0));
	free(result);
	return TCL_OK;
    }
    if (!multiple) {
	newline = strchr(result, '\n');
	if (newline != NULL) {
	    *newline = '\0';
	}
	Tcl_SetObjResult(interp, Tcl_NewStringObj(result, -1));
	free(result);
	return TCL_OK;
    }

    listObj = Tcl_NewListObj(0, NULL);
    start = result;
    while (start[0] != '\0') {
	newline = strchr(start, '\n');
	if (newline != NULL) {
	    *newline = '\0';
	}
	Tcl_ListObjAppendElement(interp, listObj, Tcl_NewStringObj(start, -1));
	if (newline == NULL) {
	    break;
	}
	start = newline + 1;
    }
    Tcl_SetObjResult(interp, listObj);
    free(result);
    return TCL_OK;
}

EM_ASYNC_JS(char *, BrowserChooseOpenFile, (
    const char *titlePtr,
    const char *initialDirPtr,
    const char *initialFilePtr,
    const char *fileTypesPtr,
    int multiple), {
    const title = UTF8ToString(titlePtr);
    const initialDir = UTF8ToString(initialDirPtr);
    const initialFile = UTF8ToString(initialFilePtr);
    const fileTypes = UTF8ToString(fileTypesPtr);
    const module = globalThis.Module || {};

    function allocateString(text) {
	const value = String(text || "");
	const length = lengthBytesUTF8(value) + 1;
	const pointer = _malloc(length);
	if (!pointer) {
	    return 0;
	}
	stringToUTF8(value, pointer, length);
	return pointer;
    }

    function unsupported() {
	return allocateString("__TK_BROWSER_DIALOG_UNSUPPORTED__");
    }

    function errorResult(error) {
	const message = error instanceof Error ? error.message : String(error || "");
	return allocateString("__TK_BROWSER_DIALOG_ERROR__:" + message);
    }

    function dialogState() {
	const state = module.tkBrowserDialogState || {};
	if (!state.nextId) {
	    state.nextId = 1;
	}
	if (!state.saveHandles) {
	    state.saveHandles = {};
	}
	if (!state.directoryHandles) {
	    state.directoryHandles = {};
	}
	module.tkBrowserDialogState = state;
	return state;
    }

    function hasUserActivation() {
	const activation = globalThis.navigator && globalThis.navigator.userActivation;
	return !activation || !!activation.isActive;
    }

    function parseTclList(text) {
	const values = [];
	let token = "";
	let started = false;
	let braceDepth = 0;
	let inQuote = false;
	const source = String(text || "");
	function finish() {
	    if (started) {
		values.push(token);
		token = "";
		started = false;
	    }
	}
	for (let i = 0; i < source.length; i++) {
	    const char = source[i];
	    if (char.charCodeAt(0) === 92 && i + 1 < source.length) {
		token += source[++i];
		started = true;
		continue;
	    }
	    if (!inQuote && char === "{") {
		if (braceDepth > 0) {
		    token += char;
		}
		braceDepth++;
		started = true;
		continue;
	    }
	    if (!inQuote && char === "}" && braceDepth > 0) {
		braceDepth--;
		if (braceDepth > 0) {
		    token += char;
		}
		continue;
	    }
	    if (braceDepth === 0 && char === "\"") {
		inQuote = !inQuote;
		started = true;
		continue;
	    }
	    if (braceDepth === 0 && !inQuote
		    && (char === " " || char === "\t" || char === "\n"
		    || char === "\r")) {
		finish();
		continue;
	    }
	    token += char;
	    started = true;
	}
	finish();
	return values;
    }

    function extensionFromPattern(pattern) {
	let value = String(pattern || "");
	if (!value || value === "*" || value === "*.*") {
	    return "";
	}
	if (value.startsWith("*.")) {
	    value = value.slice(1);
	} else if (!value.startsWith(".")
		&& value.indexOf("*") < 0 && value.indexOf("?") < 0
		&& value.indexOf("/") < 0) {
	    value = "." + value;
	}
	if (!value.startsWith(".") || value.length < 2) {
	    return "";
	}
	let extension = ".";
	for (let i = 1; i < value.length; i++) {
	    const char = value[i];
	    const code = char.charCodeAt(0);
	    const allowed = (code >= 48 && code <= 57)
		|| (code >= 65 && code <= 90)
		|| (code >= 97 && code <= 122)
		|| code === 45 || code === 95;
	    if (!allowed) {
		return "";
	    }
	    extension += char;
	}
	return extension;
    }

    function mimeForExtension(extension) {
	const lower = extension.toLowerCase();
	if (lower === ".png" || lower === ".gif" || lower === ".jpg"
		|| lower === ".jpeg" || lower === ".webp" || lower === ".bmp") {
	    return "image/*";
	}
	if (lower === ".svg") {
	    return "image/svg+xml";
	}
	if (lower === ".json") {
	    return "application/json";
	}
	if (lower === ".pdf") {
	    return "application/pdf";
	}
	if (lower === ".txt" || lower === ".text" || lower === ".md"
		|| lower === ".csv" || lower === ".tsv" || lower === ".tcl"
		|| lower === ".html" || lower === ".css" || lower === ".js"
		|| lower === ".xml") {
	    return "text/plain";
	}
	return "application/octet-stream";
    }

    function browserFileTypes(tclFileTypes) {
	const rows = parseTclList(tclFileTypes);
	const types = [];
	const allExtensions = [];
	const seenAll = new Set();
	for (const row of rows) {
	    const parts = parseTclList(row);
	    if (parts.length < 2) {
		continue;
	    }
	    const description = parts[0] || "Files";
	    const patterns = parseTclList(parts[1]);
	    const accept = {};
	    let count = 0;
	    for (const pattern of patterns) {
		const extension = extensionFromPattern(pattern);
		if (!extension) {
		    continue;
		}
		const lower = extension.toLowerCase();
		if (seenAll.has(lower)) {
		    continue;
		}
		seenAll.add(lower);
		allExtensions.push(extension);
		const mime = mimeForExtension(extension);
		if (!accept[mime]) {
		    accept[mime] = [];
		}
		accept[mime].push(extension);
		count++;
	    }
	    if (count > 0) {
		types.push({ description, accept });
	    }
	}
	return { accept: allExtensions.join(","), types };
    }

    function sanitizeName(name) {
	let cleaned = "";
	for (const char of String(name || "file")) {
	    const code = char.charCodeAt(0);
	    const allowed = (code >= 48 && code <= 57)
		|| (code >= 65 && code <= 90)
		|| (code >= 97 && code <= 122)
		|| code === 45 || code === 46 || code === 95;
	    cleaned += allowed ? char : "_";
	}
	while (cleaned.startsWith("_")) {
	    cleaned = cleaned.slice(1);
	}
	while (cleaned.endsWith("_")) {
	    cleaned = cleaned.slice(0, -1);
	}
	return cleaned || "file";
    }

    function mkdirTree(path) {
	if (typeof FS.mkdirTree === "function") {
	    FS.mkdirTree(path);
	    return;
	}
	const parts = path.split("/").filter(Boolean);
	let current = "";
	for (const part of parts) {
	    current += "/" + part;
	    try {
		FS.mkdir(current);
	    } catch (error) {
		if (!/File exists|EEXIST/.test(String(error && error.message))) {
		    throw error;
		}
	    }
	}
    }

    function virtualPath(kind, name) {
	const state = dialogState();
	const id = state.nextId++;
	return `/browser/${kind}/${id}-${sanitizeName(name)}`;
    }

    async function bytesForEntry(entry) {
	if (entry instanceof File || entry instanceof Blob) {
	    return new Uint8Array(await entry.arrayBuffer());
	}
	if (entry && typeof entry.arrayBuffer === "function") {
	    return new Uint8Array(await entry.arrayBuffer());
	}
	if (entry && entry.bytes !== undefined) {
	    return entry.bytes instanceof Uint8Array
		? entry.bytes
		: new Uint8Array(entry.bytes);
	}
	if (entry && entry.text !== undefined) {
	    return new TextEncoder().encode(String(entry.text));
	}
	if (entry && entry.content !== undefined) {
	    return new TextEncoder().encode(String(entry.content));
	}
	return new Uint8Array();
    }

    async function importEntry(entry) {
	if (typeof entry === "string") {
	    return entry;
	}
	if (entry && entry.path && entry.bytes === undefined
		&& entry.text === undefined && entry.content === undefined
		&& typeof entry.arrayBuffer !== "function") {
	    return String(entry.path);
	}
	const name = entry && entry.name ? entry.name : "file";
	const path = entry && entry.path ? String(entry.path) : virtualPath("open", name);
	const slash = path.lastIndexOf("/");
	if (slash > 0) {
	    mkdirTree(path.slice(0, slash));
	}
	FS.writeFile(path, await bytesForEntry(entry));
	return path;
    }

    async function hookFiles() {
	if (typeof module.tkBrowserOpenFile === "function") {
	    const value = await module.tkBrowserOpenFile({
		fileTypes,
		initialDir,
		initialFile,
		multiple: !!multiple,
		title,
	    });
	    if (!value) {
		return [];
	    }
	    if (Array.isArray(value)) {
		return value;
	    }
	    if (Array.isArray(value.files)) {
		return value.files;
	    }
	    return [value];
	}
	return null;
    }

    try {
	const hooked = await hookFiles();
	let entries = hooked;
	if (entries === null) {
	    const pickerTypes = browserFileTypes(fileTypes);
	    if (!hasUserActivation()) {
		return unsupported();
	    }
	    if (typeof globalThis.showOpenFilePicker === "function") {
		try {
		    const options = { multiple: !!multiple };
		    if (pickerTypes.types.length > 0) {
			options.types = pickerTypes.types;
		    }
		    const handles = await globalThis.showOpenFilePicker(options);
		    entries = [];
		    for (const handle of handles) {
			entries.push(await handle.getFile());
		    }
		} catch (error) {
		    if (error && error.name === "AbortError") {
			return allocateString("");
		    }
		    return unsupported();
		}
	    } else if (typeof document !== "undefined") {
		entries = await new Promise((resolve, reject) => {
		    const input = document.createElement("input");
		    let settled = false;
		    input.type = "file";
		    input.multiple = !!multiple;
		    if (pickerTypes.accept) {
			input.accept = pickerTypes.accept;
		    }
		    input.style.position = "fixed";
		    input.style.left = "-10000px";
		    input.style.top = "0";
		    input.addEventListener("change", () => {
			if (settled) {
			    return;
			}
			settled = true;
			const files = input.files ? Array.from(input.files) : [];
			input.remove();
			resolve(files);
		    }, { once: true });
		    input.addEventListener("cancel", () => {
			if (settled) {
			    return;
			}
			settled = true;
			input.remove();
			resolve([]);
		    }, { once: true });
		    document.body.appendChild(input);
		    try {
			input.click();
		    } catch (error) {
			input.remove();
			reject(error);
		    }
		});
	    } else {
		return unsupported();
	    }
	}
	const paths = [];
	for (const entry of entries || []) {
	    paths.push(await importEntry(entry));
	}
	return allocateString(paths.join("\n"));
    } catch (error) {
	return errorResult(error);
    }
});

EM_ASYNC_JS(char *, BrowserChooseSaveFile, (
    const char *titlePtr,
    const char *initialDirPtr,
    const char *initialFilePtr,
    const char *defaultExtensionPtr,
    const char *fileTypesPtr), {
    const title = UTF8ToString(titlePtr);
    const initialDir = UTF8ToString(initialDirPtr);
    const initialFile = UTF8ToString(initialFilePtr);
    const defaultExtension = UTF8ToString(defaultExtensionPtr);
    const fileTypes = UTF8ToString(fileTypesPtr);
    const module = globalThis.Module || {};

    function allocateString(text) {
	const value = String(text || "");
	const length = lengthBytesUTF8(value) + 1;
	const pointer = _malloc(length);
	if (!pointer) {
	    return 0;
	}
	stringToUTF8(value, pointer, length);
	return pointer;
    }

    function unsupported() {
	return allocateString("__TK_BROWSER_DIALOG_UNSUPPORTED__");
    }

    function errorResult(error) {
	const message = error instanceof Error ? error.message : String(error || "");
	return allocateString("__TK_BROWSER_DIALOG_ERROR__:" + message);
    }

    function dialogState() {
	const state = module.tkBrowserDialogState || {};
	if (!state.nextId) {
	    state.nextId = 1;
	}
	if (!state.saveHandles) {
	    state.saveHandles = {};
	}
	if (!state.directoryHandles) {
	    state.directoryHandles = {};
	}
	module.tkBrowserDialogState = state;
	return state;
    }

    function hasUserActivation() {
	const activation = globalThis.navigator && globalThis.navigator.userActivation;
	return !activation || !!activation.isActive;
    }

    function parseTclList(text) {
	const values = [];
	let token = "";
	let started = false;
	let braceDepth = 0;
	let inQuote = false;
	const source = String(text || "");
	function finish() {
	    if (started) {
		values.push(token);
		token = "";
		started = false;
	    }
	}
	for (let i = 0; i < source.length; i++) {
	    const char = source[i];
	    if (char.charCodeAt(0) === 92 && i + 1 < source.length) {
		token += source[++i];
		started = true;
		continue;
	    }
	    if (!inQuote && char === "{") {
		if (braceDepth > 0) {
		    token += char;
		}
		braceDepth++;
		started = true;
		continue;
	    }
	    if (!inQuote && char === "}" && braceDepth > 0) {
		braceDepth--;
		if (braceDepth > 0) {
		    token += char;
		}
		continue;
	    }
	    if (braceDepth === 0 && char === "\"") {
		inQuote = !inQuote;
		started = true;
		continue;
	    }
	    if (braceDepth === 0 && !inQuote
		    && (char === " " || char === "\t" || char === "\n"
		    || char === "\r")) {
		finish();
		continue;
	    }
	    token += char;
	    started = true;
	}
	finish();
	return values;
    }

    function extensionFromPattern(pattern) {
	let value = String(pattern || "");
	if (!value || value === "*" || value === "*.*") {
	    return "";
	}
	if (value.startsWith("*.")) {
	    value = value.slice(1);
	} else if (!value.startsWith(".")
		&& value.indexOf("*") < 0 && value.indexOf("?") < 0
		&& value.indexOf("/") < 0) {
	    value = "." + value;
	}
	if (!value.startsWith(".") || value.length < 2) {
	    return "";
	}
	let extension = ".";
	for (let i = 1; i < value.length; i++) {
	    const char = value[i];
	    const code = char.charCodeAt(0);
	    const allowed = (code >= 48 && code <= 57)
		|| (code >= 65 && code <= 90)
		|| (code >= 97 && code <= 122)
		|| code === 45 || code === 95;
	    if (!allowed) {
		return "";
	    }
	    extension += char;
	}
	return extension;
    }

    function mimeForExtension(extension) {
	const lower = extension.toLowerCase();
	if (lower === ".png" || lower === ".gif" || lower === ".jpg"
		|| lower === ".jpeg" || lower === ".webp" || lower === ".bmp") {
	    return "image/*";
	}
	if (lower === ".svg") {
	    return "image/svg+xml";
	}
	if (lower === ".json") {
	    return "application/json";
	}
	if (lower === ".pdf") {
	    return "application/pdf";
	}
	if (lower === ".txt" || lower === ".text" || lower === ".md"
		|| lower === ".csv" || lower === ".tsv" || lower === ".tcl"
		|| lower === ".html" || lower === ".css" || lower === ".js"
		|| lower === ".xml") {
	    return "text/plain";
	}
	return "application/octet-stream";
    }

    function browserFileTypes(tclFileTypes) {
	const rows = parseTclList(tclFileTypes);
	const types = [];
	const allExtensions = [];
	const seenAll = new Set();
	for (const row of rows) {
	    const parts = parseTclList(row);
	    if (parts.length < 2) {
		continue;
	    }
	    const description = parts[0] || "Files";
	    const patterns = parseTclList(parts[1]);
	    const accept = {};
	    let count = 0;
	    for (const pattern of patterns) {
		const extension = extensionFromPattern(pattern);
		if (!extension) {
		    continue;
		}
		const lower = extension.toLowerCase();
		if (seenAll.has(lower)) {
		    continue;
		}
		seenAll.add(lower);
		allExtensions.push(extension);
		const mime = mimeForExtension(extension);
		if (!accept[mime]) {
		    accept[mime] = [];
		}
		accept[mime].push(extension);
		count++;
	    }
	    if (count > 0) {
		types.push({ description, accept });
	    }
	}
	return { accept: allExtensions.join(","), types };
    }

    function sanitizeName(name) {
	let cleaned = "";
	for (const char of String(name || "untitled")) {
	    const code = char.charCodeAt(0);
	    const allowed = (code >= 48 && code <= 57)
		|| (code >= 65 && code <= 90)
		|| (code >= 97 && code <= 122)
		|| code === 45 || code === 46 || code === 95;
	    cleaned += allowed ? char : "_";
	}
	while (cleaned.startsWith("_")) {
	    cleaned = cleaned.slice(1);
	}
	while (cleaned.endsWith("_")) {
	    cleaned = cleaned.slice(0, -1);
	}
	return cleaned || "untitled";
    }

    function mkdirTree(path) {
	if (typeof FS.mkdirTree === "function") {
	    FS.mkdirTree(path);
	    return;
	}
	const parts = path.split("/").filter(Boolean);
	let current = "";
	for (const part of parts) {
	    current += "/" + part;
	    try {
		FS.mkdir(current);
	    } catch (error) {
		if (!/File exists|EEXIST/.test(String(error && error.message))) {
		    throw error;
		}
	    }
	}
    }

    function suggestedName() {
	let name = initialFile || "untitled";
	if (defaultExtension && defaultExtension !== "." && !name.includes(".")) {
	    name += defaultExtension.startsWith(".")
		? defaultExtension
		: "." + defaultExtension;
	}
	return name;
    }

    function virtualPath(name) {
	const state = dialogState();
	const id = state.nextId++;
	return `/browser/save/${id}-${sanitizeName(name)}`;
    }

    function createFallbackSavePath(name) {
	const path = virtualPath(name);
	const slash = path.lastIndexOf("/");
	if (slash > 0) {
	    mkdirTree(path.slice(0, slash));
	}
	FS.writeFile(path, new Uint8Array());
	return path;
    }

    try {
	let value = null;
	if (typeof module.tkBrowserSaveFile === "function") {
	    value = await module.tkBrowserSaveFile({
		defaultExtension,
		fileTypes,
		initialDir,
		initialFile,
		title,
	    });
	    if (!value) {
		return allocateString("");
	    }
	} else if (typeof globalThis.showSaveFilePicker === "function") {
	    if (!hasUserActivation()) {
		return unsupported();
	    }
	    try {
		const options = { suggestedName: suggestedName() };
		const pickerTypes = browserFileTypes(fileTypes);
		if (pickerTypes.types.length > 0) {
		    options.types = pickerTypes.types;
		}
		const handle = await globalThis.showSaveFilePicker(options);
		const path = virtualPath(handle && handle.name ? handle.name : suggestedName());
		const slash = path.lastIndexOf("/");
		if (slash > 0) {
		    mkdirTree(path.slice(0, slash));
		}
		FS.writeFile(path, new Uint8Array());
		dialogState().saveHandles[path] = handle;
		return allocateString(path);
	    } catch (error) {
		if (error && error.name === "AbortError") {
		    return allocateString("");
		}
		return unsupported();
	    }
	} else if (typeof document !== "undefined") {
	    if (!hasUserActivation()) {
		return unsupported();
	    }
	    return allocateString(createFallbackSavePath(suggestedName()));
	} else {
	    return unsupported();
	}
	if (typeof value === "string") {
	    return allocateString(value);
	}
	const name = value.name || suggestedName();
	const path = value.path ? String(value.path) : virtualPath(name);
	const slash = path.lastIndexOf("/");
	if (slash > 0) {
	    mkdirTree(path.slice(0, slash));
	}
	if (value.bytes !== undefined) {
	    FS.writeFile(path, value.bytes instanceof Uint8Array
		? value.bytes
		: new Uint8Array(value.bytes));
	} else if (value.text !== undefined || value.content !== undefined) {
	    FS.writeFile(path, new TextEncoder().encode(
		String(value.text !== undefined ? value.text : value.content)));
	} else {
	    FS.writeFile(path, new Uint8Array());
	}
	if (value.handle) {
	    dialogState().saveHandles[path] = value.handle;
	}
	return allocateString(path);
    } catch (error) {
	return errorResult(error);
    }
});

EM_ASYNC_JS(char *, BrowserChooseDirectory, (
    const char *titlePtr,
    const char *initialDirPtr,
    int mustExist), {
    const title = UTF8ToString(titlePtr);
    const initialDir = UTF8ToString(initialDirPtr);
    const module = globalThis.Module || {};

    function allocateString(text) {
	const value = String(text || "");
	const length = lengthBytesUTF8(value) + 1;
	const pointer = _malloc(length);
	if (!pointer) {
	    return 0;
	}
	stringToUTF8(value, pointer, length);
	return pointer;
    }

    function unsupported() {
	return allocateString("__TK_BROWSER_DIALOG_UNSUPPORTED__");
    }

    function errorResult(error) {
	const message = error instanceof Error ? error.message : String(error || "");
	return allocateString("__TK_BROWSER_DIALOG_ERROR__:" + message);
    }

    function dialogState() {
	const state = module.tkBrowserDialogState || {};
	if (!state.nextId) {
	    state.nextId = 1;
	}
	if (!state.saveHandles) {
	    state.saveHandles = {};
	}
	if (!state.directoryHandles) {
	    state.directoryHandles = {};
	}
	module.tkBrowserDialogState = state;
	return state;
    }

    function hasUserActivation() {
	const activation = globalThis.navigator && globalThis.navigator.userActivation;
	return !activation || !!activation.isActive;
    }

    function sanitizeName(name) {
	let cleaned = "";
	for (const char of String(name || "directory")) {
	    const code = char.charCodeAt(0);
	    const allowed = (code >= 48 && code <= 57)
		|| (code >= 65 && code <= 90)
		|| (code >= 97 && code <= 122)
		|| code === 45 || code === 46 || code === 95;
	    cleaned += allowed ? char : "_";
	}
	while (cleaned.startsWith("_")) {
	    cleaned = cleaned.slice(1);
	}
	while (cleaned.endsWith("_")) {
	    cleaned = cleaned.slice(0, -1);
	}
	return cleaned || "directory";
    }

    function mkdirTree(path) {
	if (typeof FS.mkdirTree === "function") {
	    FS.mkdirTree(path);
	    return;
	}
	const parts = path.split("/").filter(Boolean);
	let current = "";
	for (const part of parts) {
	    current += "/" + part;
	    try {
		FS.mkdir(current);
	    } catch (error) {
		if (!/File exists|EEXIST/.test(String(error && error.message))) {
		    throw error;
		}
	    }
	}
    }

    function virtualPath(name) {
	const state = dialogState();
	const id = state.nextId++;
	return `/browser/directory/${id}-${sanitizeName(name)}`;
    }

    async function importFiles(rootPath, files) {
	for (const file of files || []) {
	    const relative = file.webkitRelativePath
		? String(file.webkitRelativePath).split("/").slice(1).join("/")
		: file.name;
	    const safeParts = String(relative || file.name || "file")
		.split("/")
		.filter(Boolean)
		.map(sanitizeName);
	    if (safeParts.length === 0) {
		continue;
	    }
	    const path = `${rootPath}/${safeParts.join("/")}`;
	    const slash = path.lastIndexOf("/");
	    if (slash > 0) {
		mkdirTree(path.slice(0, slash));
	    }
	    FS.writeFile(path, new Uint8Array(await file.arrayBuffer()));
	}
    }

    try {
	let value = null;
	if (typeof module.tkBrowserChooseDirectory === "function") {
	    value = await module.tkBrowserChooseDirectory({
		initialDir,
		mustExist: !!mustExist,
		title,
	    });
	    if (!value) {
		return allocateString("");
	    }
	} else if (typeof globalThis.showDirectoryPicker === "function") {
	    if (!hasUserActivation()) {
		return unsupported();
	    }
	    try {
		const handle = await globalThis.showDirectoryPicker();
		const path = virtualPath(handle && handle.name ? handle.name : "directory");
		mkdirTree(path);
		dialogState().directoryHandles[path] = handle;
		return allocateString(path);
	    } catch (error) {
		if (error && error.name === "AbortError") {
		    return allocateString("");
		}
		return unsupported();
	    }
	} else if (typeof document !== "undefined") {
	    if (!hasUserActivation()) {
		return unsupported();
	    }
	    value = await new Promise((resolve, reject) => {
		const input = document.createElement("input");
		let settled = false;
		input.type = "file";
		input.multiple = true;
		input.webkitdirectory = true;
		input.style.position = "fixed";
		input.style.left = "-10000px";
		input.style.top = "0";
		input.addEventListener("change", () => {
		    if (settled) {
			return;
		    }
		    settled = true;
		    const files = input.files ? Array.from(input.files) : [];
		    input.remove();
		    resolve(files.length ? { files, name: "directory" } : null);
		}, { once: true });
		input.addEventListener("cancel", () => {
		    if (settled) {
			return;
		    }
		    settled = true;
		    input.remove();
		    resolve(null);
		}, { once: true });
		document.body.appendChild(input);
		try {
		    input.click();
		} catch (error) {
		    input.remove();
		    reject(error);
		}
	    });
	    if (!value) {
		return allocateString("");
	    }
	} else {
	    return unsupported();
	}
	if (typeof value === "string") {
	    mkdirTree(value);
	    return allocateString(value);
	}
	const path = value.path ? String(value.path) : virtualPath(value.name || "directory");
	mkdirTree(path);
	if (value.handle) {
	    dialogState().directoryHandles[path] = value.handle;
	}
	if (Array.isArray(value.files)) {
	    await importFiles(path, value.files);
	}
	return allocateString(path);
    } catch (error) {
	return errorResult(error);
    }
});

EM_ASYNC_JS(char *, BrowserChooseColor, (
    const char *titlePtr,
    const char *initialColorPtr), {
    const title = UTF8ToString(titlePtr);
    const initialColor = UTF8ToString(initialColorPtr);
    const module = globalThis.Module || {};

    function allocateString(text) {
	const value = String(text || "");
	const length = lengthBytesUTF8(value) + 1;
	const pointer = _malloc(length);
	if (!pointer) {
	    return 0;
	}
	stringToUTF8(value, pointer, length);
	return pointer;
    }

    function unsupported() {
	return allocateString("__TK_BROWSER_DIALOG_UNSUPPORTED__");
    }

    function errorResult(error) {
	const message = error instanceof Error ? error.message : String(error || "");
	return allocateString("__TK_BROWSER_DIALOG_ERROR__:" + message);
    }

    function hasUserActivation() {
	const activation = globalThis.navigator && globalThis.navigator.userActivation;
	return !activation || !!activation.isActive;
    }

    try {
	if (typeof module.tkBrowserChooseColor === "function") {
	    const value = await module.tkBrowserChooseColor({
		initialColor,
		title,
	    });
	    return allocateString(value || "");
	}
	if (typeof document === "undefined") {
	    return unsupported();
	}
	if (!hasUserActivation()) {
	    return unsupported();
	}
	const value = await new Promise((resolve, reject) => {
	    const input = document.createElement("input");
	    let settled = false;
	    input.type = "color";
	    input.value = /^#[0-9a-fA-F]{6}$/.test(initialColor)
		? initialColor
		: "#ffffff";
	    input.style.position = "fixed";
	    input.style.left = "-10000px";
	    input.style.top = "0";
	    function finish(value) {
		if (settled) {
		    return;
		}
		settled = true;
		input.remove();
		resolve(value || "");
	    }
	    input.addEventListener("change", () => finish(input.value), { once: true });
	    input.addEventListener("cancel", () => finish(""), { once: true });
	    document.body.appendChild(input);
	    try {
		input.click();
	    } catch (error) {
		input.remove();
		reject(error);
	    }
	});
	return allocateString(value);
    } catch (error) {
	return errorResult(error);
    }
});

EM_ASYNC_JS(char *, BrowserFlushSaveFileToBrowser, (
    const char *pathPtr,
    const char *namePtr), {
    const path = UTF8ToString(pathPtr);
    const name = UTF8ToString(namePtr);
    const module = globalThis.Module || {};

    function allocateString(text) {
	const value = String(text || "");
	const length = lengthBytesUTF8(value) + 1;
	const pointer = _malloc(length);
	if (!pointer) {
	    return 0;
	}
	stringToUTF8(value, pointer, length);
	return pointer;
    }

    function errorResult(error) {
	const message = error instanceof Error ? error.message : String(error || "");
	return allocateString("__TK_BROWSER_DIALOG_ERROR__:" + message);
    }

    try {
	const data = FS.readFile(path);
	const state = module.tkBrowserDialogState || {};
	if (typeof module.tkBrowserFlushSaveFile === "function") {
	    await module.tkBrowserFlushSaveFile({
		bytes: data,
		name,
		path,
		text: new TextDecoder().decode(data),
	    });
	    return allocateString("ok");
	}
	const handle = state.saveHandles && state.saveHandles[path];
	if (handle && typeof handle.createWritable === "function") {
	    const writable = await handle.createWritable();
	    await writable.write(data);
	    await writable.close();
	    return allocateString("ok");
	}
	if (typeof document !== "undefined") {
	    const blob = new Blob([data]);
	    const url = URL.createObjectURL(blob);
	    const anchor = document.createElement("a");
	    anchor.href = url;
	    anchor.download = name || path.split("/").pop() || "download";
	    anchor.style.display = "none";
	    document.body.appendChild(anchor);
	    anchor.click();
	    anchor.remove();
	    URL.revokeObjectURL(url);
	    return allocateString("ok");
	}
	return allocateString("__TK_BROWSER_DIALOG_UNSUPPORTED__");
    } catch (error) {
	return errorResult(error);
    }
});

static char *
BrowserShowMessageBox(
    const char *title,
    const char *message,
    const char *detail,
    const char *icon,
    const char *type,
    const char *defaultButton)
{
    return (char *)EM_ASM_PTR({
	const title = UTF8ToString($0);
	const message = UTF8ToString($1);
	const detail = UTF8ToString($2);
	const icon = UTF8ToString($3);
	const type = UTF8ToString($4);
	const defaultButton = UTF8ToString($5);
	const module = globalThis.Module || {};
	let result = "";

	function allocateString(text) {
	    const value = String(text || "");
	    const length = lengthBytesUTF8(value) + 1;
	    const pointer = _malloc(length);

	    if (!pointer) {
		return 0;
	    }
	    stringToUTF8(value, pointer, length);
	    return pointer;
	}

	function unsupported() {
	    return allocateString("__TK_BROWSER_DIALOG_UNSUPPORTED__");
	}

	function errorResult(error) {
	    const message = error instanceof Error ? error.message : String(error || "");
	    return allocateString("__TK_BROWSER_DIALOG_ERROR__:" + message);
	}

	function hasUserActivation() {
	    const activation = globalThis.navigator && globalThis.navigator.userActivation;
	    return !activation || !!activation.isActive;
	}

	try {
	    if (typeof module.tkBrowserMessageBox === "function") {
		result = module.tkBrowserMessageBox({
		    defaultButton,
		    detail,
		    icon,
		    message,
		    title,
		    type,
		});
	    } else {
		let text = "";

		if (title) {
		    text += title;
		}
		if (message) {
		    text += (text ? "\n\n" : "") + message;
		}
		if (detail) {
		    text += (text ? "\n\n" : "") + detail;
		}

		if (!hasUserActivation()) {
		    return unsupported();
		}
		if (type === "ok") {
		    if (typeof globalThis.alert !== "function") {
			return unsupported();
		    }
		    globalThis.alert(text);
		    result = "ok";
		} else if (type === "okcancel") {
		    if (typeof globalThis.confirm !== "function") {
			return unsupported();
		    }
		    result = globalThis.confirm(text) ? "ok" : "cancel";
		} else if (type === "retrycancel") {
		    if (typeof globalThis.confirm !== "function") {
			return unsupported();
		    }
		    result = globalThis.confirm(text) ? "retry" : "cancel";
		} else if (type === "yesno") {
		    if (typeof globalThis.confirm !== "function") {
			return unsupported();
		    }
		    result = globalThis.confirm(text) ? "yes" : "no";
		} else {
		    return unsupported();
		}
	    }
	    if (typeof result !== "string") {
		result = "";
	    }
	    return allocateString(result);
	} catch (error) {
	    return errorResult(error);
	}
    }, title, message, detail, icon, type, defaultButton);
}

static int
BrowserMessageBoxResultAllowed(
    int typeIndex,
    const char *result)
{
    if (result == NULL) {
	return 0;
    }
    switch (typeIndex) {
    case 1: /* ok */
	return strcmp(result, "ok") == 0;
    case 2: /* okcancel */
	return (strcmp(result, "ok") == 0) || (strcmp(result, "cancel") == 0);
    case 3: /* retrycancel */
	return (strcmp(result, "retry") == 0) || (strcmp(result, "cancel") == 0);
    case 4: /* yesno */
	return (strcmp(result, "yes") == 0) || (strcmp(result, "no") == 0);
    default:
	return 0;
    }
}

static int
BrowserMessageBoxTypeSupported(
    int typeIndex)
{
    return (typeIndex == 1) || (typeIndex == 2) || (typeIndex == 3)
	    || (typeIndex == 4);
}

static int
BrowserUnsupportedMessageBoxType(
    Tcl_Interp *interp,
    const char *type)
{
    Tcl_SetObjResult(interp, Tcl_ObjPrintf(
	    "browser native message box cannot represent -type %s", type));
    Tcl_SetErrorCode(interp, "TK", "BROWSER", "DIALOG_UNAVAILABLE",
	    "MESSAGEBOX_TYPE", NULL);
    return TCL_ERROR;
}

static int
BrowserMessageBoxCmd(
    ClientData clientData,
    Tcl_Interp *interp,
    int objc,
    Tcl_Obj *const objv[])
{
    static const char *const options[] = {
	"-default", "-detail", "-icon", "-message", "-parent", "-title",
	"-type", NULL
    };
    static const char *const icons[] = {
	"error", "info", "question", "warning", NULL
    };
    static const char *const types[] = {
	"abortretryignore", "ok", "okcancel", "retrycancel", "yesno",
	"yesnocancel", NULL
    };
    const char *defaultButton = "";
    const char *detail = "";
    const char *icon = "info";
    const char *message = "";
    const char *title = "";
    int typeIndex = 1;
    int i;
    char *result;
    size_t errorPrefixLength = strlen(BROWSER_DIALOG_ERROR_PREFIX);

    (void)clientData;
    if ((objc % 2) == 0) {
	Tcl_WrongNumArgs(interp, 1, objv, "?option value ...?");
	return TCL_ERROR;
    }
    for (i = 1; i < objc; i += 2) {
	int optionIndex;

	if (Tcl_GetIndexFromObj(interp, objv[i], options, "option", 0,
		&optionIndex) != TCL_OK) {
	    return TCL_ERROR;
	}
	switch (optionIndex) {
	case 0:
	    defaultButton = Tcl_GetString(objv[i + 1]);
	    break;
	case 1:
	    detail = Tcl_GetString(objv[i + 1]);
	    break;
	case 2: {
	    int iconIndex;

	    if (Tcl_GetIndexFromObj(interp, objv[i + 1], icons, "icon", 0,
		    &iconIndex) != TCL_OK) {
		return TCL_ERROR;
	    }
	    icon = icons[iconIndex];
	    break;
	}
	case 3:
	    message = Tcl_GetString(objv[i + 1]);
	    break;
	case 4:
	    if (Tcl_GetString(objv[i + 1])[0] != '\0'
		    && Tk_MainWindow(interp) != NULL
		    && Tk_NameToWindow(interp, Tcl_GetString(objv[i + 1]),
			    Tk_MainWindow(interp)) == NULL) {
		return TCL_ERROR;
	    }
	    break;
	case 5:
	    title = Tcl_GetString(objv[i + 1]);
	    break;
	case 6:
	    if (Tcl_GetIndexFromObj(interp, objv[i + 1], types,
		    "message box type", 0, &typeIndex) != TCL_OK) {
		return TCL_ERROR;
	    }
	    break;
	}
    }
    if (!BrowserMessageBoxTypeSupported(typeIndex)) {
	return BrowserUnsupportedMessageBoxType(interp, types[typeIndex]);
    }
    if (defaultButton[0] == '\0') {
	defaultButton = (typeIndex == 4) ? "yes" : types[typeIndex];
	if (typeIndex == 2) {
	    defaultButton = "ok";
	} else if (typeIndex == 3) {
	    defaultButton = "retry";
	}
    } else if (!BrowserMessageBoxResultAllowed(typeIndex, defaultButton)) {
	Tcl_SetObjResult(interp, Tcl_ObjPrintf(
		"invalid default button \"%s\" for -type %s", defaultButton,
		types[typeIndex]));
	return TCL_ERROR;
    }

    result = BrowserShowMessageBox(title, message, detail, icon,
	    types[typeIndex], defaultButton);
    if (result == NULL) {
	Tcl_SetObjResult(interp, Tcl_NewStringObj(
		"failed to allocate browser message box result", -1));
	return TCL_ERROR;
    }
    if (strcmp(result, BROWSER_DIALOG_UNSUPPORTED) == 0) {
	free(result);
	return BrowserDialogUnavailable(interp,
		"browser native message box is not available");
    }
    if (strncmp(result, BROWSER_DIALOG_ERROR_PREFIX, errorPrefixLength) == 0) {
	Tcl_SetObjResult(interp, Tcl_NewStringObj(
		result + errorPrefixLength, -1));
	free(result);
	Tcl_SetErrorCode(interp, "TK", "BROWSER", "DIALOG_ERROR", NULL);
	return TCL_ERROR;
    }
    if (!BrowserMessageBoxResultAllowed(typeIndex, result)) {
	Tcl_SetObjResult(interp, Tcl_ObjPrintf(
		"browser message box returned invalid button \"%s\"", result));
	free(result);
	return TCL_ERROR;
    }
    Tcl_SetObjResult(interp, Tcl_NewStringObj(result, -1));
    free(result);
    return TCL_OK;
}

static int
BrowserGetOpenFileCmd(
    ClientData clientData,
    Tcl_Interp *interp,
    int objc,
    Tcl_Obj *const objv[])
{
    static const char *const options[] = {
	"-defaultextension", "-filetypes", "-initialdir", "-initialfile",
	"-multiple", "-parent", "-title", "-typevariable", NULL
    };
    const char *fileTypes = "";
    const char *initialDir = "";
    const char *initialFile = "";
    const char *title = "";
    int multiple = 0;
    int i;
    char *result;

    (void)clientData;
    if ((objc % 2) == 0) {
	Tcl_WrongNumArgs(interp, 1, objv, "?option value ...?");
	return TCL_ERROR;
    }
    for (i = 1; i < objc; i += 2) {
	int optionIndex;

	if (Tcl_GetIndexFromObj(interp, objv[i], options, "option", 0,
		&optionIndex) != TCL_OK) {
	    return TCL_ERROR;
	}
	switch (optionIndex) {
	case 0:
	    break;
	case 1:
	    fileTypes = Tcl_GetString(objv[i + 1]);
	    break;
	case 2:
	    initialDir = Tcl_GetString(objv[i + 1]);
	    break;
	case 3:
	    initialFile = Tcl_GetString(objv[i + 1]);
	    break;
	case 4:
	    if (Tcl_GetBooleanFromObj(interp, objv[i + 1], &multiple) != TCL_OK) {
		return TCL_ERROR;
	    }
	    break;
	case 5:
	    if (BrowserValidateParent(interp, Tcl_GetString(objv[i + 1]))
		    != TCL_OK) {
		return TCL_ERROR;
	    }
	    break;
	case 6:
	    title = Tcl_GetString(objv[i + 1]);
	    break;
	case 7:
	    break;
	}
    }

    result = BrowserChooseOpenFile(title, initialDir, initialFile, fileTypes,
	    multiple);
    return BrowserDialogPathListResult(interp, result, multiple);
}

static int
BrowserGetSaveFileCmd(
    ClientData clientData,
    Tcl_Interp *interp,
    int objc,
    Tcl_Obj *const objv[])
{
    static const char *const options[] = {
	"-confirmoverwrite", "-defaultextension", "-filetypes", "-initialdir",
	"-initialfile", "-parent", "-title", "-typevariable", NULL
    };
    const char *defaultExtension = "";
    const char *fileTypes = "";
    const char *initialDir = "";
    const char *initialFile = "";
    const char *title = "";
    int i;
    char *result;

    (void)clientData;
    if ((objc % 2) == 0) {
	Tcl_WrongNumArgs(interp, 1, objv, "?option value ...?");
	return TCL_ERROR;
    }
    for (i = 1; i < objc; i += 2) {
	int optionIndex;

	if (Tcl_GetIndexFromObj(interp, objv[i], options, "option", 0,
		&optionIndex) != TCL_OK) {
	    return TCL_ERROR;
	}
	switch (optionIndex) {
	case 0: {
	    int confirmOverwrite;

	    if (Tcl_GetBooleanFromObj(interp, objv[i + 1],
		    &confirmOverwrite) != TCL_OK) {
		return TCL_ERROR;
	    }
	    break;
	}
	case 1:
	    defaultExtension = Tcl_GetString(objv[i + 1]);
	    break;
	case 2:
	    fileTypes = Tcl_GetString(objv[i + 1]);
	    break;
	case 3:
	    initialDir = Tcl_GetString(objv[i + 1]);
	    break;
	case 4:
	    initialFile = Tcl_GetString(objv[i + 1]);
	    break;
	case 5:
	    if (BrowserValidateParent(interp, Tcl_GetString(objv[i + 1]))
		    != TCL_OK) {
		return TCL_ERROR;
	    }
	    break;
	case 6:
	    title = Tcl_GetString(objv[i + 1]);
	    break;
	case 7:
	    break;
	}
    }

    result = BrowserChooseSaveFile(title, initialDir, initialFile,
	    defaultExtension, fileTypes);
    return BrowserDialogStringResult(interp, result);
}

static int
BrowserChooseDirectoryCmd(
    ClientData clientData,
    Tcl_Interp *interp,
    int objc,
    Tcl_Obj *const objv[])
{
    static const char *const options[] = {
	"-initialdir", "-mustexist", "-parent", "-title", NULL
    };
    const char *initialDir = "";
    const char *title = "";
    int mustExist = 0;
    int i;
    char *result;

    (void)clientData;
    if ((objc % 2) == 0) {
	Tcl_WrongNumArgs(interp, 1, objv, "?option value ...?");
	return TCL_ERROR;
    }
    for (i = 1; i < objc; i += 2) {
	int optionIndex;

	if (Tcl_GetIndexFromObj(interp, objv[i], options, "option", 0,
		&optionIndex) != TCL_OK) {
	    return TCL_ERROR;
	}
	switch (optionIndex) {
	case 0:
	    initialDir = Tcl_GetString(objv[i + 1]);
	    break;
	case 1:
	    if (Tcl_GetBooleanFromObj(interp, objv[i + 1], &mustExist)
		    != TCL_OK) {
		return TCL_ERROR;
	    }
	    break;
	case 2:
	    if (BrowserValidateParent(interp, Tcl_GetString(objv[i + 1]))
		    != TCL_OK) {
		return TCL_ERROR;
	    }
	    break;
	case 3:
	    title = Tcl_GetString(objv[i + 1]);
	    break;
	}
    }

    result = BrowserChooseDirectory(title, initialDir, mustExist);
    return BrowserDialogStringResult(interp, result);
}

static int
BrowserChooseColorCmd(
    ClientData clientData,
    Tcl_Interp *interp,
    int objc,
    Tcl_Obj *const objv[])
{
    static const char *const options[] = {
	"-initialcolor", "-parent", "-title", NULL
    };
    const char *initialColor = "";
    const char *title = "";
    int i;
    char *result;

    (void)clientData;
    if ((objc % 2) == 0) {
	Tcl_WrongNumArgs(interp, 1, objv, "?option value ...?");
	return TCL_ERROR;
    }
    for (i = 1; i < objc; i += 2) {
	int optionIndex;

	if (Tcl_GetIndexFromObj(interp, objv[i], options, "option", 0,
		&optionIndex) != TCL_OK) {
	    return TCL_ERROR;
	}
	switch (optionIndex) {
	case 0:
	    initialColor = Tcl_GetString(objv[i + 1]);
	    if (initialColor[0] != '\0') {
		XColor *colorPtr = Tk_GetColor(interp, Tk_MainWindow(interp),
			initialColor);

		if (colorPtr == NULL) {
		    return TCL_ERROR;
		}
		Tk_FreeColor(colorPtr);
	    }
	    break;
	case 1:
	    if (BrowserValidateParent(interp, Tcl_GetString(objv[i + 1]))
		    != TCL_OK) {
		return TCL_ERROR;
	    }
	    break;
	case 2:
	    title = Tcl_GetString(objv[i + 1]);
	    break;
	}
    }

    result = BrowserChooseColor(title, initialColor);
    return BrowserDialogStringResult(interp, result);
}

static int
BrowserFlushSaveFileCmd(
    ClientData clientData,
    Tcl_Interp *interp,
    int objc,
    Tcl_Obj *const objv[])
{
    const char *path;
    const char *name = "";
    char *result;

    (void)clientData;
    if ((objc < 2) || (objc > 3)) {
	Tcl_WrongNumArgs(interp, 1, objv, "path ?name?");
	return TCL_ERROR;
    }
    path = Tcl_GetString(objv[1]);
    if (objc == 3) {
	name = Tcl_GetString(objv[2]);
    }
    result = BrowserFlushSaveFileToBrowser(path, name);
    return BrowserDialogStringResult(interp, result);
}

EMSCRIPTEN_KEEPALIVE int
TkBrowserEval(
    const char *script)
{
    int code;

    if (browserInterp == NULL) {
	BrowserSetResultBytes(TCL_ERROR, "Tcl interpreter is not ready", -1);
	BrowserSetStatus("eval error");
	return TCL_ERROR;
    }
    code = Tcl_EvalEx(browserInterp, (script != NULL) ? script : "", -1,
	    TCL_EVAL_GLOBAL);
    if (code != TCL_OK) {
	BrowserConsole("error", "interactive eval failed");
	BrowserConsole("error", Tcl_GetStringResult(browserInterp));
    }
    BrowserSetResultObj(code, Tcl_GetObjResult(browserInterp));
    BrowserSetStatus((code == TCL_OK) ? "eval ok" : "eval error");
    BrowserDrainQueuedControlEvents();
    TkBrowserServiceXEvents();
    BrowserDrainTclEvents();
    return code;
}

static int
BrowserUrlEvalScriptCount(void)
{
    return EM_ASM_INT({
	const module = globalThis.Module || {};
	const scripts = module.tkBrowserEvalScripts;

	return Array.isArray(scripts) ? scripts.length : 0;
    });
}

static char *
BrowserCopyUrlEvalScript(
    int index)
{
    return (char *)EM_ASM_PTR({
	const module = globalThis.Module || {};
	const scripts = module.tkBrowserEvalScripts;

	if (!Array.isArray(scripts) || ($0 < 0) || ($0 >= scripts.length)
		|| (typeof scripts[$0] !== "string")) {
	    return 0;
	}
	const script = scripts[$0];
	const length = lengthBytesUTF8(script) + 1;
	const ptr = _malloc(length);

	if (!ptr) {
	    return 0;
	}
	stringToUTF8(script, ptr, length);
	return ptr;
    }, index);
}

static int
BrowserAppendUrlEvalScripts(
    Tcl_Interp *interp,
    Tcl_Obj *scriptList)
{
    int count = BrowserUrlEvalScriptCount();
    int i;

    for (i = 0; i < count; i++) {
	char *script = BrowserCopyUrlEvalScript(i);

	if (script == NULL) {
	    Tcl_SetObjResult(interp, Tcl_NewStringObj(
		    "failed to copy browser eval script", -1));
	    return TCL_ERROR;
	}
	Tcl_ListObjAppendElement(interp, scriptList,
		Tcl_NewStringObj(script, -1));
	free(script);
    }
    return TCL_OK;
}

static void
BrowserSetArgVariables(
    Tcl_Interp *interp,
    int argc,
    char **argv)
{
    Tcl_DString argvList;
    char argcString[32];
    int i;

    Tcl_SetVar(interp, "argv0", (argc > 0) ? argv[0] : "tcltk-wasm",
	    TCL_GLOBAL_ONLY);
    Tcl_DStringInit(&argvList);
    for (i = 1; i < argc; i++) {
	Tcl_DStringAppendElement(&argvList, argv[i]);
    }
    Tcl_SetVar(interp, "argv", Tcl_DStringValue(&argvList), TCL_GLOBAL_ONLY);
    Tcl_DStringFree(&argvList);

    snprintf(argcString, sizeof(argcString), "%d", (argc > 1) ? argc - 1 : 0);
    Tcl_SetVar(interp, "argc", argcString, TCL_GLOBAL_ONLY);
}

static int
BrowserRunArgumentScripts(
    Tcl_Interp *interp,
    int *ranScriptPtr)
{
    Tcl_Obj *argvObj;
    Tcl_Obj *scriptList = NULL;
    Tcl_Obj *cleanArgvObj = NULL;
    Tcl_Obj *argcObj;
    Tcl_Obj *startupScriptObj = NULL;
    Tcl_Obj **objv;
    Tcl_Obj **scriptObjv;
    const char *startupEncoding = NULL;
    int objc = 0;
    int scriptObjc = 0;
    int i;
    int cleanArgc = 0;
    int allowStartupScript = (BrowserUrlEvalScriptCount() == 0);
    int code = TCL_OK;

    *ranScriptPtr = 0;
    /*
     * Tk_Init consumes Tk startup options from argv, so inspect the Tcl
     * variable after initialization instead of reusing the original C argv.
     */
    argvObj = Tcl_GetVar2Ex(interp, "argv", NULL, TCL_GLOBAL_ONLY);
    if (argvObj == NULL) {
	return TCL_OK;
    }

    Tcl_IncrRefCount(argvObj);
    scriptList = Tcl_NewListObj(0, NULL);
    cleanArgvObj = Tcl_NewListObj(0, NULL);
    Tcl_IncrRefCount(scriptList);
    Tcl_IncrRefCount(cleanArgvObj);

    if (Tcl_ListObjGetElements(interp, argvObj, &objc, &objv) != TCL_OK) {
	code = TCL_ERROR;
	goto done;
    }

    for (i = 0; i < objc; i++) {
	const char *arg = Tcl_GetString(objv[i]);

	if (startupScriptObj != NULL) {
	    Tcl_ListObjAppendElement(interp, cleanArgvObj, objv[i]);
	    cleanArgc++;
	} else if (strcmp(arg, "--demo") == 0) {
	    allowStartupScript = 0;
	    Tcl_ListObjAppendElement(interp, scriptList,
		    Tcl_NewStringObj(demoScript, -1));
	} else if ((strcmp(arg, "--eval") == 0) || (strcmp(arg, "-c") == 0)) {
	    allowStartupScript = 0;
	    if ((i + 1) >= objc) {
		Tcl_SetObjResult(interp, Tcl_NewStringObj(
			"missing script after --eval", -1));
		BrowserSetResultObj(TCL_ERROR, Tcl_GetObjResult(interp));
		code = TCL_ERROR;
		goto done;
	    }
	    Tcl_ListObjAppendElement(interp, scriptList, objv[++i]);
	} else if (strcmp(arg, "--") == 0) {
	    while (++i < objc) {
		Tcl_ListObjAppendElement(interp, cleanArgvObj, objv[i]);
		cleanArgc++;
	    }
	} else if (allowStartupScript && (strcmp(arg, "-encoding") == 0)
		&& ((i + 2) < objc)
		&& BrowserCanBeStartupScript(Tcl_GetString(objv[i + 2]))) {
	    startupEncoding = Tcl_GetString(objv[i + 1]);
	    startupScriptObj = objv[i + 2];
	    i += 2;
	} else if (allowStartupScript && BrowserIsFileOption(arg)
		&& ((i + 1) < objc)
		&& BrowserCanBeStartupScript(Tcl_GetString(objv[i + 1]))) {
	    startupScriptObj = objv[++i];
	} else if (allowStartupScript && BrowserCanBeStartupScript(arg)) {
	    startupScriptObj = objv[i];
	} else {
	    Tcl_ListObjAppendElement(interp, cleanArgvObj, objv[i]);
	    cleanArgc++;
	}
    }

    code = BrowserAppendUrlEvalScripts(interp, scriptList);
    if (code != TCL_OK) {
	goto done;
    }

    if (Tcl_SetVar2Ex(interp, "argv", NULL, cleanArgvObj,
	    TCL_GLOBAL_ONLY) == NULL) {
	code = TCL_ERROR;
	goto done;
    }
    argcObj = Tcl_NewWideIntObj(cleanArgc);
    if (Tcl_SetVar2Ex(interp, "argc", NULL, argcObj,
	    TCL_GLOBAL_ONLY) == NULL) {
	code = TCL_ERROR;
	goto done;
    }
    if (startupScriptObj != NULL) {
	if (Tcl_SetVar(interp, "argv0", Tcl_GetString(startupScriptObj),
		TCL_GLOBAL_ONLY) == NULL) {
	    code = TCL_ERROR;
	    goto done;
	}
	if (Tcl_SetVar2Ex(interp, "tcl_interactive", NULL,
		Tcl_NewBooleanObj(0), TCL_GLOBAL_ONLY) == NULL) {
	    code = TCL_ERROR;
	    goto done;
	}
    }

    if (Tcl_ListObjGetElements(interp, scriptList, &scriptObjc,
	    &scriptObjv) != TCL_OK) {
	code = TCL_ERROR;
	goto done;
    }
    for (i = 0; i < scriptObjc; i++) {
	*ranScriptPtr = 1;
	code = BrowserEvalAndReport(interp, Tcl_GetString(scriptObjv[i]),
		"argument script failed");
	if (code != TCL_OK) {
	    goto done;
	}
    }
    if (startupScriptObj != NULL) {
	*ranScriptPtr = 1;
	code = BrowserEvalFileAndReport(interp, startupScriptObj,
		startupEncoding, "startup script failed");
	if (code != TCL_OK) {
	    goto done;
	}
    }

done:
    if (cleanArgvObj != NULL) {
	Tcl_DecrRefCount(cleanArgvObj);
    }
    if (scriptList != NULL) {
	Tcl_DecrRefCount(scriptList);
    }
    Tcl_DecrRefCount(argvObj);
    return code;
}

static void
BrowserEventLoop(
    void *clientData)
{
    Tcl_Interp *interp = (Tcl_Interp *)clientData;

    BrowserDrainQueuedControlEvents();
    TkBrowserServiceXEvents();
    BrowserDrainTclEvents();
    (void)interp;
}

EMSCRIPTEN_KEEPALIVE int
TkBrowserServiceUserActivationEvents(void)
{
    int events = 0;

    if (browserInterp == NULL) {
	return 0;
    }
    events += TkBrowserServiceXEvents();
    events += BrowserDrainWindowEvents();
    return events;
}

int
main(
    int argc,
    char **argv)
{
    Tcl_Interp *interp;
    int ranArgumentScript = 0;
    int code;

    Tcl_FindExecutable((argc > 0) ? argv[0] : "tcltk-wasm");
    interp = Tcl_CreateInterp();
    if (interp == NULL) {
	BrowserConsole("error", "failed to create Tcl interpreter");
	BrowserSetStatus("failed: Tcl_CreateInterp");
	return 1;
    }
    browserInterp = interp;
    Tcl_SetVar(interp, "tcl_library", "/lib/tcl8.6", TCL_GLOBAL_ONLY);
    Tcl_SetVar2(interp, "env", "TCL_LIBRARY", "/lib/tcl8.6", TCL_GLOBAL_ONLY);
    Tcl_SetVar2(interp, "env", "TK_LIBRARY", "/lib/tk8.6", TCL_GLOBAL_ONLY);
    Tcl_SetVar2(interp, "env", "DISPLAY", "browser", TCL_GLOBAL_ONLY);
    BrowserSetArgVariables(interp, argc, argv);
    Tcl_CreateNamespace(interp, "browser", NULL, NULL);
    Tcl_CreateObjCommand(interp, "::browser::setStatus", BrowserStatusCmd,
	    NULL, NULL);
    Tcl_CreateObjCommand(interp, "::browser::setResult", BrowserResultCmd,
	    NULL, NULL);
    Tcl_CreateObjCommand(interp, "::browser::chooseColor",
	    BrowserChooseColorCmd, NULL, NULL);
    Tcl_CreateObjCommand(interp, "::browser::chooseDirectory",
	    BrowserChooseDirectoryCmd, NULL, NULL);
    Tcl_CreateObjCommand(interp, "::browser::flushSaveFile",
	    BrowserFlushSaveFileCmd, NULL, NULL);
    Tcl_CreateObjCommand(interp, "::browser::getOpenFile",
	    BrowserGetOpenFileCmd, NULL, NULL);
    Tcl_CreateObjCommand(interp, "::browser::getSaveFile",
	    BrowserGetSaveFileCmd, NULL, NULL);
    Tcl_CreateObjCommand(interp, "::browser::messageBox", BrowserMessageBoxCmd,
	    NULL, NULL);

    if (Tcl_Init(interp) != TCL_OK) {
	BrowserConsole("error", "Tcl_Init failed");
	BrowserConsole("error", Tcl_GetStringResult(interp));
	BrowserSetStatus("failed: Tcl_Init");
	return 1;
    }
    BrowserConsole("log", "Tcl initialized");

    if (Tk_Init(interp) != TCL_OK) {
	BrowserConsole("error", "Tk_Init failed");
	BrowserConsole("error", Tcl_GetStringResult(interp));
	BrowserSetStatus("failed: Tk_Init");
	return 1;
    }
    Tcl_StaticPackage(interp, "Tk", Tk_Init, Tk_SafeInit);
    BrowserConsole("log", "Tk initialized");

    if (BrowserEval(interp, shortcutScript,
	    "browser shortcut bindings failed") != TCL_OK) {
	BrowserSetResultObj(TCL_ERROR, Tcl_GetObjResult(interp));
	BrowserSetStatus("failed: shortcut bindings");
	return 1;
    }
    if (BrowserEval(interp, nativeDialogScript,
	    "browser native dialog bindings failed") != TCL_OK) {
	BrowserSetResultObj(TCL_ERROR, Tcl_GetObjResult(interp));
	BrowserSetStatus("failed: native dialog bindings");
	return 1;
    }

    code = BrowserRunArgumentScripts(interp, &ranArgumentScript);
    if (code != TCL_OK) {
	BrowserSetStatus("eval error");
	emscripten_set_main_loop_arg(BrowserEventLoop, interp, 0, 1);
	return 0;
    }
    if (!ranArgumentScript) {
	if (BrowserEval(interp, demoScript, "demo script failed") != TCL_OK) {
	    BrowserSetResultObj(TCL_ERROR, Tcl_GetObjResult(interp));
	    BrowserSetStatus("failed: demo script");
	    return 1;
	}
	BrowserSetStatus("running");
    } else {
	BrowserSetStatus("eval ok");
    }

    emscripten_set_main_loop_arg(BrowserEventLoop, interp, 0, 1);
    return 0;
}
