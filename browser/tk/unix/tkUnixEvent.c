/*
 * tkUnixEvent.c --
 *
 *	Browser overlay for Tk's Unix/X11 event source.
 */

#include "tkUnixInt.h"

static void BrowserCreateFileHandler(int fd, int mask, Tcl_FileProc *proc,
	ClientData clientData);
static void BrowserDeleteFileHandler(int fd);

#define Tcl_CreateFileHandler BrowserCreateFileHandler
#define Tcl_DeleteFileHandler BrowserDeleteFileHandler
#define TkUnixDoOneXEvent TkBrowserUpstreamUnixDoOneXEvent
#include "tkUnixEventUpstream.c"
#undef TkUnixDoOneXEvent
#undef Tcl_DeleteFileHandler
#undef Tcl_CreateFileHandler

static void
BrowserCreateFileHandler(
    int fd,
    int mask,
    Tcl_FileProc *proc,
    ClientData clientData)
{
    (void)fd;
    (void)mask;
    (void)proc;
    (void)clientData;
}

static void
BrowserDeleteFileHandler(
    int fd)
{
    (void)fd;
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
	    DisplayFileProc(dispPtr, TCL_READABLE);
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
