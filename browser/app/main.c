/*
 * main.c --
 *
 *	Minimal browser executable for Tcl/Tk on WebAssembly. This is a
 *	diagnostic harness: it initializes Tcl/Tk, runs a tiny script, and keeps
 *	Tcl's event loop pumping from the browser main loop.
 */

#include <emscripten.h>
#include <stdio.h>
#include <string.h>
#include <tcl.h>
#include <tk.h>

extern int TkBrowserServiceXEvents(void);

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
BrowserSetStatus(
    const char *status)
{
    EM_ASM({
	const element = document.getElementById("tk-browser-status");
	if (element) {
	    element.textContent = UTF8ToString($0);
	}
    }, status);
}

static void
BrowserSetResult(
    int code,
    const char *result)
{
    EM_ASM({
	const code = $0;
	const result = UTF8ToString($1);
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
    }, code, result);
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

    BrowserSetResult(code, Tcl_GetStringResult(interp));
    return code;
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
    BrowserSetStatus(Tcl_GetString(objv[1]));
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
    BrowserSetResult(TCL_OK, Tcl_GetString(objv[1]));
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
    int argc,
    char **argv,
    int *ranScriptPtr)
{
    int i;
    int code = TCL_OK;

    *ranScriptPtr = 0;
    for (i = 1; i < argc; i++) {
	const char *arg = argv[i];
	const char *script = NULL;

	if (strcmp(arg, "--demo") == 0) {
	    script = demoScript;
	} else if ((strcmp(arg, "--eval") == 0) || (strcmp(arg, "-c") == 0)) {
	    if ((i + 1) >= argc) {
		Tcl_SetObjResult(interp, Tcl_NewStringObj(
			"missing script after --eval", -1));
		BrowserSetResult(TCL_ERROR, Tcl_GetStringResult(interp));
		return TCL_ERROR;
	    }
	    script = argv[++i];
	} else if ((strcmp(arg, "--") == 0) && ((i + 1) < argc)) {
	    script = argv[++i];
	} else {
	    script = arg;
	}

	*ranScriptPtr = 1;
	code = BrowserEvalAndReport(interp, script, "argument script failed");
	if (code != TCL_OK) {
	    return code;
	}
    }
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

    code = BrowserRunArgumentScripts(interp, argc, argv, &ranArgumentScript);
    if (code != TCL_OK) {
	BrowserSetStatus("eval error");
	emscripten_set_main_loop_arg(BrowserEventLoop, interp, 0, 1);
	return 0;
    }
    if (!ranArgumentScript) {
	if (BrowserEval(interp, demoScript, "demo script failed") != TCL_OK) {
	    BrowserSetResult(TCL_ERROR, Tcl_GetStringResult(interp));
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
