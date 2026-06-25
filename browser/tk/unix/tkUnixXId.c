/*
 * tkUnixXId.c --
 *
 *	Tk's Unix Makefile still expects this translation unit. The browser
 *	Xlib compatibility implementation is built from third-party/x11.wasm as
 *	libx11wasm.a; this file intentionally keeps only the Tk-side bind slot.
 */

#include "tkUnixInt.h"
#include "tkSelect.h"

#undef XChangeProperty
#undef XSetClassHint
#undef XStoreName

static int
TkBrowserIsRootToplevel(
    TkWindow *winPtr)
{
    return (winPtr != NULL) && (winPtr->pathName != NULL)
	    && (strcmp(winPtr->pathName, ".") == 0);
}

static TkWindow *
TkBrowserMetadataTarget(
    TkWindow *winPtr)
{
    TkWindow *targetPtr;

    if ((winPtr == NULL) || (winPtr->window == None)
	    || (winPtr->flags & TK_ALREADY_DEAD)) {
	return NULL;
    }
    targetPtr = TkWmFocusToplevel(winPtr);
    if (targetPtr == NULL) {
	targetPtr = winPtr;
    }
    if ((targetPtr == NULL) || (targetPtr->window == None)
	    || (targetPtr->flags & TK_ALREADY_DEAD)) {
	return NULL;
    }
    return targetPtr;
}

void
TkBrowserSyncMetadataTargets(
    Display *display)
{
    TkDisplay *dispPtr;

    for (dispPtr = TkGetDisplayList(); dispPtr != NULL;
	    dispPtr = dispPtr->nextPtr) {
	Tcl_HashEntry *hPtr;
	Tcl_HashSearch search;

	if ((display != NULL) && (dispPtr->display != display)) {
	    continue;
	}
	for (hPtr = Tcl_FirstHashEntry(&dispPtr->winTable, &search);
		hPtr != NULL; hPtr = Tcl_NextHashEntry(&search)) {
	    TkWindow *winPtr = (TkWindow *)Tcl_GetHashValue(hPtr);
	    TkWindow *targetPtr = TkBrowserMetadataTarget(winPtr);

	    if (targetPtr == NULL) {
		continue;
	    }
	    (void)X11WasmSetWindowMetadataTarget(dispPtr->display,
		    winPtr->window, targetPtr->window,
		    TkBrowserIsRootToplevel(targetPtr));
	}
    }
}

int
TkBrowserXChangeProperty(
    Display *display,
    Window window,
    Atom property,
    Atom type,
    int format,
    int mode,
    _Xconst unsigned char *data,
    int nelements)
{
    TkBrowserSyncMetadataTargets(display);
    return XChangeProperty(display, window, property, type, format, mode, data,
	    nelements);
}

int
TkBrowserXSetClassHint(
    Display *display,
    Window window,
    XClassHint *classHints)
{
    TkBrowserSyncMetadataTargets(display);
    return XSetClassHint(display, window, classHints);
}

int
TkBrowserXStoreName(
    Display *display,
    Window window,
    _Xconst char *name)
{
    TkBrowserSyncMetadataTargets(display);
    return XStoreName(display, window, name);
}

void
Tk_FreeXId(
    Display *display,
    XID xid)
{
    (void)display;
    (void)xid;
}

Pixmap
Tk_GetPixmap(
    Display *display,
    Drawable d,
    int width,
    int height,
    int depth)
{
    return XCreatePixmap(display, d, (unsigned int)width,
	    (unsigned int)height, (unsigned int)depth);
}

void
Tk_FreePixmap(
    Display *display,
    Pixmap pixmap)
{
    (void)XFreePixmap(display, pixmap);
}

int
TkpScanWindowId(
    Tcl_Interp *interp,
    const char *string,
    Window *idPtr)
{
    int code;
    Tcl_Obj obj;

    obj.refCount = 1;
    obj.bytes = (char *)string;
    obj.length = strlen(string);
    obj.typePtr = NULL;

    code = Tcl_GetLongFromObj(interp, &obj, (long *)idPtr);
    if (obj.refCount > 1) {
	Tcl_Panic("invalid sharing of Tcl_Obj on C stack");
    }
    if ((obj.typePtr != NULL) && (obj.typePtr->freeIntRepProc != NULL)) {
	obj.typePtr->freeIntRepProc(&obj);
    }
    return code;
}

static TkClipboardTarget *
TkBrowserClipboardTextTarget(
    TkWindow *winPtr)
{
    TkClipboardTarget *targetPtr;
    TkDisplay *dispPtr;
    Atom utf8Atom;

    if ((winPtr == NULL) || (winPtr->dispPtr == NULL)) {
	return NULL;
    }
    dispPtr = winPtr->dispPtr;
    utf8Atom = Tk_InternAtom((Tk_Window)winPtr, "UTF8_STRING");
    for (targetPtr = dispPtr->clipTargetPtr; targetPtr != NULL;
	    targetPtr = targetPtr->nextPtr) {
	if (targetPtr->type == utf8Atom) {
	    return targetPtr;
	}
    }
    for (targetPtr = dispPtr->clipTargetPtr; targetPtr != NULL;
	    targetPtr = targetPtr->nextPtr) {
	if (targetPtr->type == XA_STRING) {
	    return targetPtr;
	}
    }
    return NULL;
}

static int
TkBrowserCopyClipboardText(
    TkWindow *winPtr,
    Tcl_DString *clipboardPtr)
{
    TkClipboardTarget *targetPtr;
    TkClipboardBuffer *bufferPtr;

    if ((winPtr == NULL) || (clipboardPtr == NULL)) {
	return 0;
    }
    targetPtr = TkBrowserClipboardTextTarget(winPtr);
    if (targetPtr == NULL) {
	return 0;
    }
    for (bufferPtr = targetPtr->firstBufferPtr; bufferPtr != NULL;
	    bufferPtr = bufferPtr->nextPtr) {
	const char *buffer = bufferPtr->buffer;
	long remaining = bufferPtr->length;

	while (remaining > 0) {
	    int chunk = remaining > INT_MAX ? INT_MAX : (int)remaining;

	    Tcl_DStringAppend(clipboardPtr, buffer, chunk);
	    buffer += chunk;
	    remaining -= chunk;
	}
    }
    return 1;
}

void
TkBrowserSelUpdateClipboard(
    TkWindow *winPtr,
    int option)
{
    Tcl_DString clipboard;

    if (winPtr == NULL) {
	return;
    }
    if (option == CLIPBOARD_CLEAR) {
	(void)X11WasmSetClipboardText("", 0);
	return;
    }
    if (option != CLIPBOARD_APPEND) {
	return;
    }

    Tcl_DStringInit(&clipboard);
    if (TkBrowserCopyClipboardText(winPtr, &clipboard)) {
	(void)X11WasmSetClipboardText(Tcl_DStringValue(&clipboard),
		Tcl_DStringLength(&clipboard));
    }
    Tcl_DStringFree(&clipboard);
}
