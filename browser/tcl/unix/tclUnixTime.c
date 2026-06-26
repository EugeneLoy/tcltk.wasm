#ifdef __EMSCRIPTEN__
#define TCL_BROWSER_WIDE_CLICKS 1
/*
 * The generic Tcl objects are built with TCL_WIDE_CLICKS, but upstream Unix
 * wide-click support is Darwin-only. Include that backend without its wide
 * branch and provide the Emscripten implementation below.
 */
#undef TCL_WIDE_CLICKS
#endif

#include "../../../third-party/tcl/unix/tclUnixTime.c"

#ifdef TCL_BROWSER_WIDE_CLICKS
#include <emscripten/emscripten.h>

Tcl_WideInt
TclpGetWideClicks(void)
{
    if (tclGetTimeProcPtr != NativeGetTime) {
	Tcl_Time time;

	tclGetTimeProcPtr(&time, tclTimeClientData);
	return ((Tcl_WideInt) time.sec) * 1000000 + time.usec;
    }

    return (Tcl_WideInt) (emscripten_get_now() * 1000.0);
}

double
TclpWideClicksToNanoseconds(
    Tcl_WideInt clicks)
{
    return clicks * 1000.0;
}

double
TclpWideClickInMicrosec(void)
{
    return 1.0;
}
#endif
