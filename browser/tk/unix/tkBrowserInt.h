/*
 * tkBrowserInt.h --
 *
 *	Internal declarations for the Browser/WASM Tk backend.
 */

#ifndef _TKBROWSERINT
#define _TKBROWSERINT

#ifndef _TKUNIXINT
#   include "tkUnixInt.h"
#endif

typedef enum {
    TK_BROWSER_RESOURCE_WINDOW,
    TK_BROWSER_RESOURCE_PIXMAP,
    TK_BROWSER_RESOURCE_COLORMAP,
    TK_BROWSER_RESOURCE_CURSOR,
    TK_BROWSER_RESOURCE_FONT
} TkBrowserResourceType;

typedef struct TkBrowserResource {
    XID id;
    TkBrowserResourceType type;
    Display *display;
    struct TkBrowserResource *nextPtr;
    struct TkBrowserResource *parentPtr;
    struct TkBrowserResource *firstChildPtr;
    struct TkBrowserResource *lastChildPtr;
    struct TkBrowserResource *prevSiblingPtr;
    struct TkBrowserResource *nextSiblingPtr;
    Window parent;
    int x;
    int y;
    unsigned int width;
    unsigned int height;
    unsigned int borderWidth;
    unsigned int depth;
    int mapped;
    int damaged;
    XRectangle damage;
    unsigned long damageSerial;
    XSetWindowAttributes atts;
} TkBrowserResource;

typedef struct _XRegion {
    int empty;
    XRectangle extents;
} TkBrowserRegion;

typedef struct TkBrowserDisplayState {
    Display display;
    Screen screen;
    Visual visual;
    Depth depth;
    ScreenFormat pixmapFormat;
    XGCValues defaultGC;
    Window rootWindow;
    Window focusWindow;
    Window pointerWindow;
    Window pointerCaptureWindow;
    Window pointerGrabWindow;
    unsigned int pointerGrabEventMask;
    int pointerGrabOwnerEvents;
    int pointerX;
    int pointerY;
    unsigned int pointerState;
    Colormap defaultColormap;
    XID nextXId;
    TkBrowserResource rootResource;
    TkBrowserResource *resourceList;
} TkBrowserDisplayState;

MODULE_SCOPE Display *TkBrowserGetDisplay(const char *displayName);
MODULE_SCOPE XID TkBrowserAllocXId(Display *display);
MODULE_SCOPE TkBrowserResource *TkBrowserFindResource(XID id);
MODULE_SCOPE TkBrowserResource *TkBrowserCreateResource(
	Display *display, TkBrowserResourceType type);
MODULE_SCOPE void TkBrowserDeleteResource(XID id);
MODULE_SCOPE int TkBrowserServiceEvents(void);

#ifdef __EMSCRIPTEN__
extern int TkBrowserJsInit(int width, int height, unsigned int rootXid);
extern int TkBrowserJsCreateWindow(unsigned int window, unsigned int parent,
	int x, int y, unsigned int width, unsigned int height,
	unsigned int depth, unsigned long eventMask);
extern int TkBrowserJsCreatePixmap(unsigned int pixmap, unsigned int drawable,
	unsigned int width, unsigned int height, unsigned int depth);
extern int TkBrowserJsDestroyResource(unsigned int xid);
extern int TkBrowserJsMapWindow(unsigned int window);
extern int TkBrowserJsUnmapWindow(unsigned int window);
extern int TkBrowserJsConfigureWindow(unsigned int window, int x, int y,
	unsigned int width, unsigned int height, unsigned int borderWidth,
	unsigned int valueMask);
extern int TkBrowserJsReparentWindow(unsigned int window, unsigned int parent,
	int x, int y);
extern int TkBrowserJsClearWindow(unsigned int window);
extern int TkBrowserJsCopyArea(unsigned int source, unsigned int target,
	int srcX, int srcY, unsigned int width, unsigned int height,
	int destX, int destY);
extern int TkBrowserJsDrawLine(unsigned int drawable, unsigned long pixel,
	int x1, int y1, int x2, int y2);
extern int TkBrowserJsDrawRectangle(unsigned int drawable, unsigned long pixel,
	int x, int y, unsigned int width, unsigned int height, int fill);
extern int TkBrowserJsDrawText(unsigned int drawable, unsigned long pixel,
	int x, int y, const char *utf8, int utf8Length);
extern int TkBrowserJsPutImage(unsigned int drawable, const void *data,
	int dataLength, int srcX, int srcY, int destX, int destY,
	unsigned int width, unsigned int height, int bytesPerLine,
	int bitsPerPixel);
extern int TkBrowserJsFlush(void);
#else
static inline int
TkBrowserJsInit(int width, int height, unsigned int rootXid)
{ (void)width; (void)height; (void)rootXid; return 0; }
static inline int
TkBrowserJsCreateWindow(unsigned int window, unsigned int parent, int x, int y,
	unsigned int width, unsigned int height, unsigned int depth,
	unsigned long eventMask)
{ (void)window; (void)parent; (void)x; (void)y; (void)width; (void)height; (void)depth; (void)eventMask; return 0; }
static inline int
TkBrowserJsCreatePixmap(unsigned int pixmap, unsigned int drawable,
	unsigned int width, unsigned int height, unsigned int depth)
{ (void)pixmap; (void)drawable; (void)width; (void)height; (void)depth; return 0; }
static inline int
TkBrowserJsDestroyResource(unsigned int xid)
{ (void)xid; return 0; }
static inline int
TkBrowserJsMapWindow(unsigned int window)
{ (void)window; return 0; }
static inline int
TkBrowserJsUnmapWindow(unsigned int window)
{ (void)window; return 0; }
static inline int
TkBrowserJsConfigureWindow(unsigned int window, int x, int y,
	unsigned int width, unsigned int height, unsigned int borderWidth,
	unsigned int valueMask)
{ (void)window; (void)x; (void)y; (void)width; (void)height; (void)borderWidth; (void)valueMask; return 0; }
static inline int
TkBrowserJsReparentWindow(unsigned int window, unsigned int parent, int x,
	int y)
{ (void)window; (void)parent; (void)x; (void)y; return 0; }
static inline int
TkBrowserJsClearWindow(unsigned int window)
{ (void)window; return 0; }
static inline int
TkBrowserJsCopyArea(unsigned int source, unsigned int target, int srcX,
	int srcY, unsigned int width, unsigned int height, int destX, int destY)
{ (void)source; (void)target; (void)srcX; (void)srcY; (void)width; (void)height; (void)destX; (void)destY; return 0; }
static inline int
TkBrowserJsDrawLine(unsigned int drawable, unsigned long pixel, int x1,
	int y1, int x2, int y2)
{ (void)drawable; (void)pixel; (void)x1; (void)y1; (void)x2; (void)y2; return 0; }
static inline int
TkBrowserJsDrawRectangle(unsigned int drawable, unsigned long pixel, int x,
	int y, unsigned int width, unsigned int height, int fill)
{ (void)drawable; (void)pixel; (void)x; (void)y; (void)width; (void)height; (void)fill; return 0; }
static inline int
TkBrowserJsDrawText(unsigned int drawable, unsigned long pixel, int x, int y,
	const char *utf8, int utf8Length)
{ (void)drawable; (void)pixel; (void)x; (void)y; (void)utf8; (void)utf8Length; return 0; }
static inline int
TkBrowserJsPutImage(unsigned int drawable, const void *data, int dataLength,
	int srcX, int srcY, int destX, int destY, unsigned int width,
	unsigned int height, int bytesPerLine, int bitsPerPixel)
{ (void)drawable; (void)data; (void)dataLength; (void)srcX; (void)srcY; (void)destX; (void)destY; (void)width; (void)height; (void)bytesPerLine; (void)bitsPerPixel; return 0; }
static inline int
TkBrowserJsFlush(void)
{ return 0; }
#endif

#endif /* _TKBROWSERINT */
