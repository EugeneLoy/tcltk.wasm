/*
 * tkUnixPort.h --
 *
 *	Browser/WASM port header used while the backend is still built through
 *	Tk's unix Makefile shape.
 */

#ifndef _UNIXPORT
#define _UNIXPORT

#define __UNIX__ 1
#define TK_BROWSER 1
#define TK_WASM_BROWSER 1

#include <stdio.h>
#include <pwd.h>
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <ctype.h>
#include <math.h>
#include <string.h>
#include <limits.h>
#ifdef NO_STDLIB_H
#   include "../compat/stdlib.h"
#else
#   include <stdlib.h>
#endif
#include <sys/types.h>
#include <sys/file.h>
#ifdef HAVE_SYS_SELECT_H
#   include <sys/select.h>
#endif
#include <sys/stat.h>
#ifndef _TCL
#   include <tcl.h>
#endif
#ifdef TIME_WITH_SYS_TIME
#   include <sys/time.h>
#   include <time.h>
#else
#   ifdef HAVE_SYS_TIME_H
#	include <sys/time.h>
#   else
#	include <time.h>
#   endif
#endif
#ifdef HAVE_INTTYPES_H
#   include <inttypes.h>
#endif
#ifndef NO_UNISTD_H
#   include <unistd.h>
#else
#   include "../compat/unistd.h"
#endif
#if defined(__GNUC__) && !defined(__cplusplus)
#   pragma GCC diagnostic ignored "-Wc++-compat"
#endif

/*
 * Tk's generic code still exposes and consumes Xlib-shaped data structures.
 * Use Tk's bundled xlib compatibility headers, but do not depend on external
 * X11 protocol/resource headers that have no browser equivalent.
 */
#include <X11/Xlib.h>
#include <X11/cursorfont.h>
#include <X11/keysym.h>
#include <X11/Xatom.h>
#include <X11/Xutil.h>

#include "tkBrowserXlibDecls.h"

/*
 * Keep TK_USE_INPUT_METHODS consistent with tk.h. Browser text input will
 * eventually use DOM composition/input events, but TkWindow and Tk_FakeWin
 * must agree on layout while the unix-shaped backend is in use.
 */

#ifndef NO_FD_SET
#   define SELECT_MASK fd_set
#else
#   ifndef _AIX
	typedef long fd_mask;
#   endif
#   if defined(_IBMR2)
#	define SELECT_MASK void
#   else
#	define SELECT_MASK int
#   endif
#endif

#ifndef FD_SETSIZE
#   ifdef OPEN_MAX
#	define FD_SETSIZE OPEN_MAX
#   else
#	define FD_SETSIZE 256
#   endif
#endif
#if !defined(howmany)
#   define howmany(x, y) (((x)+((y)-1))/(y))
#endif
#ifndef NFDBITS
#   define NFDBITS NBBY*sizeof(fd_mask)
#endif
#define MASK_SIZE howmany(FD_SETSIZE, NFDBITS)

#ifndef NBBY
#   define NBBY 8
#endif

#define TkPutImage(colors, ncolors, display, pixels, gc, image, srcx, srcy, destx, desty, width, height) \
	XPutImage(display, pixels, gc, image, srcx, srcy, destx, desty, \
	width, height);

#ifndef SEEK_SET
#   define SEEK_SET 0
#endif

#ifndef SEEK_CUR
#   define SEEK_CUR 1
#endif

#ifndef SEEK_END
#   define SEEK_END 2
#endif

#define TkpButtonSetDefaults() {}
#define TkpDestroyButton(butPtr) {}
#define TkSelUpdateClipboard(a,b) {}
#define TkSetPixmapColormap(p,c) {}

#define TkpDefineNativeBitmaps()
#define TkpCreateNativeBitmap(display, source) None
#define TkpGetNativeAppBitmap(display, name, w, h) None

#define TkpPrintWindowId(buf,w) \
	snprintf((buf), TCL_INTEGER_SPACE, "0x%08lx", (unsigned long) (w))

#endif /* _UNIXPORT */
