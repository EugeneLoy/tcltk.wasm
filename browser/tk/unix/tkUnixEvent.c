/*
 * tkUnixEvent.c --
 *
 *	Browser overlay for Tk's Unix/X11 event source.
 */

#include "tkUnixInt.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

typedef struct TkBrowserFileHandler {
    int fd;
    int mask;
    Tcl_FileProc *proc;
    ClientData clientData;
    struct TkBrowserFileHandler *nextPtr;
} TkBrowserFileHandler;

static void BrowserCreateFileHandler(int fd, int mask, Tcl_FileProc *proc,
	ClientData clientData);
static void BrowserDeleteFileHandler(int fd);
static TkBrowserFileHandler *BrowserFindFileHandler(int fd);
static int BrowserServiceFileHandler(int fd, int mask);

#define Tcl_CreateFileHandler BrowserCreateFileHandler
#define Tcl_DeleteFileHandler BrowserDeleteFileHandler
#define TkCreateXEventSource TkBrowserUpstreamCreateXEventSource
#define DisplayCheckProc TkBrowserUpstreamDisplayCheckProc
#define DisplayExitHandler TkBrowserUpstreamDisplayExitHandler
#define DisplayFileProc TkBrowserUpstreamDisplayFileProc
#define DisplaySetupProc TkBrowserUpstreamDisplaySetupProc
#define TransferXEventsToTcl TkBrowserUpstreamTransferXEventsToTcl
#define TkUnixDoOneXEvent TkBrowserUpstreamUnixDoOneXEvent
#include "tkUnixEventUpstream.c"
#undef TkUnixDoOneXEvent
#undef TransferXEventsToTcl
#undef DisplaySetupProc
#undef DisplayFileProc
#undef DisplayExitHandler
#undef DisplayCheckProc
#undef TkCreateXEventSource
#undef Tcl_DeleteFileHandler
#undef Tcl_CreateFileHandler

static TkBrowserFileHandler *browserFileHandlers;
static int browserTestFileHandlerCount;
static int browserTestFileHandlerMask;
static ClientData browserTestFileHandlerData;
static int browserTestFileHandlerDeleteFd = -1;

extern void TkChangeEventWindow(XEvent *eventPtr, TkWindow *winPtr);
extern int TkPositionInTree(TkWindow *winPtr, TkWindow *treePtr);

#define X11_WASM_BROWSER_WHEEL_EVENT (MappingNotify + 1)

static void DisplayCheckProc(ClientData clientData, int flags);
static void DisplayExitHandler(ClientData clientData);
static void DisplayFileProc(ClientData clientData, int flags);
static void DisplaySetupProc(ClientData clientData, int flags);
static int TkBrowserTransferXEventsToTcl(Display *display);

void
TkCreateXEventSource(void)
{
    ThreadSpecificData *tsdPtr = (ThreadSpecificData *)
	    Tcl_GetThreadData(&dataKey, sizeof(ThreadSpecificData));

    if (!tsdPtr->initialized) {
	tsdPtr->initialized = 1;
	Tcl_CreateEventSource(DisplaySetupProc, DisplayCheckProc, NULL);
	TkCreateExitHandler(DisplayExitHandler, NULL);
    }
}

static void
DisplayExitHandler(
    ClientData clientData)
{
    ThreadSpecificData *tsdPtr = (ThreadSpecificData *)
	    Tcl_GetThreadData(&dataKey, sizeof(ThreadSpecificData));

    (void)clientData;
    Tcl_DeleteEventSource(DisplaySetupProc, DisplayCheckProc, NULL);
    tsdPtr->initialized = 0;
}

static void
DisplaySetupProc(
    ClientData clientData,
    int flags)
{
    TkDisplay *dispPtr;
    static Tcl_Time blockTime = {0, 0};

    (void)clientData;
    if (!(flags & TCL_WINDOW_EVENTS)) {
	return;
    }
    for (dispPtr = TkGetDisplayList(); dispPtr != NULL;
	    dispPtr = dispPtr->nextPtr) {
	XFlush(dispPtr->display);
	if (QLength(dispPtr->display) > 0) {
	    Tcl_SetMaxBlockTime(&blockTime);
	}
    }
}

static void
DisplayCheckProc(
    ClientData clientData,
    int flags)
{
    TkDisplay *dispPtr;

    (void)clientData;
    if (!(flags & TCL_WINDOW_EVENTS)) {
	return;
    }
    for (dispPtr = TkGetDisplayList(); dispPtr != NULL;
	    dispPtr = dispPtr->nextPtr) {
	XFlush(dispPtr->display);
	(void)TkBrowserTransferXEventsToTcl(dispPtr->display);
    }
}

static void
DisplayFileProc(
    ClientData clientData,
    int flags)
{
    TkDisplay *dispPtr = (TkDisplay *)clientData;
    Display *display = dispPtr->display;
    int numFound;

    (void)flags;
    XFlush(display);
    numFound = XEventsQueued(display, QueuedAfterReading);
    if (numFound == 0) {
	XNoOp(display);
	XFlush(display);
    }
    (void)TkBrowserTransferXEventsToTcl(display);
}

static TkDisplay *
TkBrowserDisplayForEvent(
    XEvent *eventPtr)
{
    TkDisplay *dispPtr;

    for (dispPtr = TkGetDisplayList(); dispPtr != NULL;
	    dispPtr = dispPtr->nextPtr) {
	if (dispPtr->display == eventPtr->xany.display) {
	    return dispPtr;
	}
    }
    return NULL;
}

static TkWindow *
TkBrowserWindowForEvent(
    TkDisplay *dispPtr,
    XEvent *eventPtr)
{
    Tcl_HashEntry *hPtr;

    if ((dispPtr == NULL) || (eventPtr->xany.window == None)) {
	return NULL;
    }
    hPtr = Tcl_FindHashEntry(&dispPtr->winTable,
	    (char *)eventPtr->xany.window);
    return (hPtr != NULL) ? (TkWindow *)Tcl_GetHashValue(hPtr) : NULL;
}

static TkWindow *
TkBrowserEventTargetWindow(
    TkWindow *winPtr)
{
    TkWindow *focusToplevelPtr;

    if (winPtr == NULL) {
	return NULL;
    }
    focusToplevelPtr = TkWmFocusToplevel(winPtr);
    return (focusToplevelPtr != NULL) ? focusToplevelPtr : winPtr;
}

static TkWindow *
TkBrowserPointerWindow(
    TkDisplay *dispPtr)
{
    Window root = None;
    Window child = None;
    Window query;
    int rootX = 0;
    int rootY = 0;
    int winX = 0;
    int winY = 0;
    unsigned int state = 0;
    Tcl_HashEntry *hPtr;
    TkWindow *lastWinPtr = NULL;
    int depth;

    if (dispPtr == NULL) {
	return NULL;
    }
    query = RootWindow(dispPtr->display, DefaultScreen(dispPtr->display));
    for (depth = 0; depth < 32; depth++) {
	if (!XQueryPointer(dispPtr->display, query, &root, &child,
		&rootX, &rootY, &winX, &winY, &state)) {
	    break;
	}
	if ((child == None) || (child == query)) {
	    break;
	}
	hPtr = Tcl_FindHashEntry(&dispPtr->winTable, (char *)child);
	if (hPtr != NULL) {
	    lastWinPtr = TkBrowserEventTargetWindow(
		    (TkWindow *)Tcl_GetHashValue(hPtr));
	}
	query = child;
    }
    return lastWinPtr;
}

static TkWindow *
TkBrowserActiveGrabWindow(
    TkDisplay *dispPtr)
{
    if (dispPtr == NULL) {
	return NULL;
    }
    if (dispPtr->grabWinPtr != NULL) {
	return dispPtr->grabWinPtr;
    }
    return dispPtr->eventualGrabWinPtr;
}

static void
TkBrowserRetargetEvent(
    XEvent *eventPtr,
    TkWindow *targetPtr)
{
    if ((targetPtr != NULL) && (targetPtr->window != None)
	    && !(targetPtr->flags & TK_ALREADY_DEAD)
	    && (eventPtr->xany.window != targetPtr->window)) {
	TkChangeEventWindow(eventPtr, targetPtr);
    }
}

static void
TkBrowserRetargetFocusEvent(
    XEvent *eventPtr,
    TkDisplay *dispPtr)
{
    TkWindow *grabWinPtr;
    TkWindow *targetPtr;

    if ((dispPtr == NULL) || ((eventPtr->type != FocusIn)
	    && (eventPtr->type != FocusOut))) {
	return;
    }
    targetPtr = (eventPtr->type == FocusIn) ? TkBrowserPointerWindow(dispPtr)
	    : dispPtr->focusPtr;
    if (targetPtr == NULL) {
	targetPtr = TkBrowserEventTargetWindow(
		TkBrowserWindowForEvent(dispPtr, eventPtr));
    }
    if ((targetPtr != NULL) && (targetPtr->window != None)
	    && !(targetPtr->flags & TK_ALREADY_DEAD)) {
	grabWinPtr = TkBrowserActiveGrabWindow(dispPtr);
	if ((eventPtr->type == FocusIn)
		&& ((grabWinPtr == NULL)
		|| (TkPositionInTree(targetPtr, grabWinPtr)
			== TK_GRAB_IN_TREE))) {
	    TkSetFocusWin(targetPtr, 1);
	}
	if (eventPtr->type == FocusOut) {
	    eventPtr->xfocus.send_event = GENERATED_FOCUS_EVENT_MAGIC;
	}
	eventPtr->xfocus.window = targetPtr->window;
    }
}

static void
TkBrowserRetargetKeyEvent(
    XEvent *eventPtr,
    TkDisplay *dispPtr)
{
    TkWindow *grabWinPtr = TkBrowserActiveGrabWindow(dispPtr);
    TkWindow *targetPtr = NULL;

    if ((dispPtr == NULL) || ((eventPtr->type != KeyPress)
	    && (eventPtr->type != KeyRelease))) {
	return;
    }
    if (grabWinPtr != NULL) {
	targetPtr = grabWinPtr;
	TkSetFocusWin(targetPtr, 0);
    } else if (dispPtr->focusPtr != NULL) {
	targetPtr = dispPtr->focusPtr;
    }
    TkBrowserRetargetEvent(eventPtr, targetPtr);
}

static void
TkBrowserRetargetWheelEvent(
    XEvent *eventPtr,
    TkDisplay *dispPtr)
{
    TkWindow *eventWinPtr;
    TkWindow *grabWinPtr;
    TkWindow *targetPtr;

    if ((dispPtr == NULL) || (eventPtr->type != MouseWheelEvent)) {
	return;
    }
    targetPtr = TkBrowserPointerWindow(dispPtr);
    eventWinPtr = TkBrowserEventTargetWindow(
	    TkBrowserWindowForEvent(dispPtr, eventPtr));
    if (targetPtr == NULL) {
	targetPtr = eventWinPtr;
    }
    grabWinPtr = TkBrowserActiveGrabWindow(dispPtr);
    if ((grabWinPtr != NULL)
	    && ((targetPtr == NULL)
	    || (TkPositionInTree(targetPtr, grabWinPtr)
		    != TK_GRAB_IN_TREE))) {
	targetPtr = grabWinPtr;
    }
    TkBrowserRetargetEvent(eventPtr, targetPtr);
}

static int
TkBrowserTransferXEventsToTcl(
    Display *display)
{
    union {
	int type;
	XEvent x;
	TkKeyEvent k;
    } event;
    TkDisplay *dispPtr = NULL;
    int count = 0;

	while (QLength(display) > 0) {
	XNextEvent(display, &event.x);
	if (event.type == X11_WASM_BROWSER_WHEEL_EVENT) {
	    event.type = MouseWheelEvent;
	}
	if ((event.type >= VirtualEvent) && (event.type < MouseWheelEvent)) {
	    continue;
	}
	dispPtr = TkBrowserDisplayForEvent(&event.x);
	TkBrowserRetargetFocusEvent(&event.x, dispPtr);
	TkBrowserRetargetKeyEvent(&event.x, dispPtr);
	TkBrowserRetargetWheelEvent(&event.x, dispPtr);
	if (XFilterEvent(&event.x, event.x.xany.window)) {
	    continue;
	}
	if ((event.type == KeyPress) || (event.type == KeyRelease)) {
	    event.k.charValuePtr = NULL;
	    event.k.charValueLen = 0;
	    event.k.keysym = NoSymbol;
#ifdef TK_USE_INPUT_METHODS
	    if ((event.type == KeyPress) && (dispPtr != NULL)
		    && (dispPtr->flags & TK_DISPLAY_USE_IM)
		    && (dispPtr->focusPtr != NULL)
		    && (dispPtr->focusPtr->inputContext != NULL)) {
		Tcl_DString ds;

		Tcl_DStringInit(&ds);
		(void)TkpGetString(dispPtr->focusPtr, &event.x, &ds);
		Tcl_DStringFree(&ds);
	    }
#endif
	}
	Tk_QueueWindowEvent(&event.x, TCL_QUEUE_TAIL);
	count++;
    }
    return count;
}

EMSCRIPTEN_KEEPALIVE int
TkBrowserServiceXEvents(void)
{
    TkDisplay *dispPtr;
    int count = 0;

    for (dispPtr = TkGetDisplayList(); dispPtr != NULL;
	    dispPtr = dispPtr->nextPtr) {
	Display *display = dispPtr->display;

	if (display == NULL) {
	    continue;
	}
	XFlush(display);
	if (XEventsQueued(display, QueuedAfterFlush) > 0) {
	    count += TkBrowserTransferXEventsToTcl(display);
	}
    }
    return count;
}

static void
BrowserTestFileProc(
    ClientData clientData,
    int mask)
{
    int deleteFd = browserTestFileHandlerDeleteFd;

    browserTestFileHandlerCount++;
    browserTestFileHandlerMask = mask;
    browserTestFileHandlerData = clientData;
    browserTestFileHandlerDeleteFd = -1;
    if (deleteFd >= 0) {
	BrowserDeleteFileHandler(deleteFd);
    }
}

static TkBrowserFileHandler *
BrowserFindFileHandler(
    int fd)
{
    TkBrowserFileHandler *handlerPtr;

    for (handlerPtr = browserFileHandlers; handlerPtr != NULL;
	    handlerPtr = handlerPtr->nextPtr) {
	if (handlerPtr->fd == fd) {
	    return handlerPtr;
	}
    }
    return NULL;
}

static void
BrowserCreateFileHandler(
    int fd,
    int mask,
    Tcl_FileProc *proc,
    ClientData clientData)
{
    TkBrowserFileHandler *handlerPtr;

    if (proc == TkBrowserUpstreamDisplayFileProc) {
	proc = DisplayFileProc;
    }
    if ((proc == NULL) || (mask == 0)) {
	BrowserDeleteFileHandler(fd);
	return;
    }
    handlerPtr = BrowserFindFileHandler(fd);
    if (handlerPtr == NULL) {
	handlerPtr = (TkBrowserFileHandler *)ckalloc(sizeof(*handlerPtr));
	handlerPtr->fd = fd;
	handlerPtr->nextPtr = browserFileHandlers;
	browserFileHandlers = handlerPtr;
    }
    handlerPtr->mask = mask;
    handlerPtr->proc = proc;
    handlerPtr->clientData = clientData;
}

static void
BrowserDeleteFileHandler(
    int fd)
{
    TkBrowserFileHandler *handlerPtr = browserFileHandlers;
    TkBrowserFileHandler *prevPtr = NULL;

    while (handlerPtr != NULL) {
	if (handlerPtr->fd == fd) {
	    if (prevPtr == NULL) {
		browserFileHandlers = handlerPtr->nextPtr;
	    } else {
		prevPtr->nextPtr = handlerPtr->nextPtr;
	    }
	    ckfree(handlerPtr);
	    return;
	}
	prevPtr = handlerPtr;
	handlerPtr = handlerPtr->nextPtr;
    }
}

static int
BrowserServiceFileHandler(
    int fd,
    int mask)
{
    TkBrowserFileHandler *handlerPtr = BrowserFindFileHandler(fd);
    Tcl_FileProc *proc;
    ClientData clientData;
    int readyMask;

    if (handlerPtr == NULL) {
	return 0;
    }
    readyMask = handlerPtr->mask & mask;
    if (readyMask == 0) {
	return 0;
    }
    proc = handlerPtr->proc;
    clientData = handlerPtr->clientData;
    proc(clientData, readyMask);
    return 1;
}

EMSCRIPTEN_KEEPALIVE int
TkBrowserTestUnixEventFileHandlers(void)
{
    int fakeFd = 12001;
    int deleteFd = 12002;
    int result = 0;
    int displayFd = -1;
    int displayHandlerSaved = 0;
    int queuedTestEvent = 0;
    TkDisplay *dispPtr;
    TkBrowserFileHandler savedDisplayHandler;
    XEvent event;
    XEvent readback;
    Tcl_Time now;

    memset(&savedDisplayHandler, 0, sizeof(savedDisplayHandler));
    BrowserDeleteFileHandler(fakeFd);
    BrowserDeleteFileHandler(deleteFd);

    browserTestFileHandlerCount = 0;
    browserTestFileHandlerMask = 0;
    browserTestFileHandlerData = NULL;
    BrowserCreateFileHandler(fakeFd, TCL_READABLE, BrowserTestFileProc,
	    INT2PTR(1001));
    if ((BrowserFindFileHandler(fakeFd) == NULL)
	    || (BrowserServiceFileHandler(fakeFd, TCL_WRITABLE) != 0)
	    || (BrowserServiceFileHandler(fakeFd, TCL_READABLE | TCL_WRITABLE)
		    != 1)
	    || (browserTestFileHandlerCount != 1)
	    || (browserTestFileHandlerMask != TCL_READABLE)
	    || (browserTestFileHandlerData != INT2PTR(1001))) {
	goto cleanup;
    }

    BrowserCreateFileHandler(fakeFd, TCL_WRITABLE, BrowserTestFileProc,
	    INT2PTR(1002));
    if ((BrowserServiceFileHandler(fakeFd, TCL_READABLE) != 0)
	    || (BrowserServiceFileHandler(fakeFd,
		    TCL_READABLE | TCL_WRITABLE) != 1)
	    || (browserTestFileHandlerCount != 2)
	    || (browserTestFileHandlerMask != TCL_WRITABLE)
	    || (browserTestFileHandlerData != INT2PTR(1002))) {
	goto cleanup;
    }

    BrowserCreateFileHandler(deleteFd, TCL_READABLE, BrowserTestFileProc,
	    INT2PTR(1003));
    BrowserCreateFileHandler(fakeFd, TCL_READABLE, BrowserTestFileProc,
	    INT2PTR(1004));
    browserTestFileHandlerDeleteFd = deleteFd;
    if ((BrowserServiceFileHandler(fakeFd, TCL_READABLE) != 1)
	    || (BrowserFindFileHandler(deleteFd) != NULL)
	    || (browserTestFileHandlerData != INT2PTR(1004))) {
	goto cleanup;
    }

    BrowserDeleteFileHandler(fakeFd);
    if ((BrowserFindFileHandler(fakeFd) != NULL)
	    || (BrowserServiceFileHandler(fakeFd, TCL_READABLE) != 0)) {
	goto cleanup;
    }

    dispPtr = TkGetDisplayList();
    if (dispPtr == NULL) {
	goto cleanup;
    }
    displayFd = ConnectionNumber(dispPtr->display);
    if (BrowserFindFileHandler(displayFd) == NULL) {
	goto cleanup;
    }
    savedDisplayHandler = *BrowserFindFileHandler(displayFd);
    displayHandlerSaved = 1;
    while (Tcl_ServiceEvent(TCL_WINDOW_EVENTS)) {
	/* Empty any already transferred Tk window events before probing. */
    }
    BrowserCreateFileHandler(displayFd, TCL_READABLE, BrowserTestFileProc,
	    INT2PTR(2001));
    memset(&event, 0, sizeof(event));
    event.xclient.type = ClientMessage;
    event.xclient.display = dispPtr->display;
    event.xclient.window = RootWindow(dispPtr->display,
	    DefaultScreen(dispPtr->display));
    event.xclient.format = 32;
    if (XPutBackEvent(dispPtr->display, &event) != Success) {
	goto cleanup;
    }
    queuedTestEvent = 1;
    browserTestFileHandlerCount = 0;
    browserTestFileHandlerMask = 0;
    browserTestFileHandlerData = NULL;
    Tcl_GetTime(&now);
    (void)TkUnixDoOneXEvent(&now);
    if ((browserTestFileHandlerCount != 1)
	    || (browserTestFileHandlerMask != TCL_READABLE)
	    || (browserTestFileHandlerData != INT2PTR(2001))) {
	goto cleanup;
    }
    (void)XNextEvent(dispPtr->display, &readback);
    queuedTestEvent = 0;
    if (readback.xclient.type != ClientMessage) {
	goto cleanup;
    }

    result = 1;

cleanup:
    if (queuedTestEvent && (dispPtr != NULL)) {
	(void)XNextEvent(dispPtr->display, &readback);
    }
    if (displayHandlerSaved) {
	BrowserCreateFileHandler(displayFd, savedDisplayHandler.mask,
		savedDisplayHandler.proc, savedDisplayHandler.clientData);
    }
    BrowserDeleteFileHandler(fakeFd);
    BrowserDeleteFileHandler(deleteFd);
    browserTestFileHandlerDeleteFd = -1;
    return result;
}

int
TkUnixDoOneXEvent(
    Tcl_Time *timePtr)
{
    TkDisplay *dispPtr;
    Tcl_Time now;

    if (Tcl_ServiceEvent(TCL_WINDOW_EVENTS)) {
	return 1;
    }

    for (dispPtr = TkGetDisplayList(); dispPtr != NULL;
	    dispPtr = dispPtr->nextPtr) {
	XFlush(dispPtr->display);
	if (QLength(dispPtr->display) > 0) {
	    if (!BrowserServiceFileHandler(ConnectionNumber(dispPtr->display),
		    TCL_READABLE)) {
		DisplayFileProc(dispPtr, TCL_READABLE);
	    }
	}
    }

    if (Tcl_ServiceEvent(TCL_WINDOW_EVENTS)) {
	return 1;
    }

    if (timePtr != NULL) {
	Tcl_GetTime(&now);
	if ((now.sec < timePtr->sec) || ((now.sec == timePtr->sec)
		&& (now.usec <= timePtr->usec))) {
	    return 0;
	}
    }

    return 0;
}
