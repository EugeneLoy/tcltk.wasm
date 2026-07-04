/*
 * main.c --
 *
 *	Minimal browser executable for Tcl/Tk on WebAssembly. This is a
 *	diagnostic harness: it initializes Tcl/Tk, runs a tiny script, and keeps
 *	Tcl's event loop pumping from the browser main loop.
 */

#include <emscripten.h>
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
