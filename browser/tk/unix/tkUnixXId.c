/*
 * tkUnixXId.c --
 *
 *	Browser/WASM XID registry and Xlib-shaped stubs. These functions are
 *	temporary compatibility entry points while the real browser backend is
 *	filled in behind Tk's existing platform boundary.
 */

#include "tkBrowserInt.h"

#include <ctype.h>
#include <stdarg.h>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#define TK_BROWSER_EVENT_QUEUE_LIMIT 256
#define TK_BROWSER_UNICODE_KEYSYM_BASE 0x01000000U
#define TK_BROWSER_COMPOSITION_START 1
#define TK_BROWSER_COMPOSITION_UPDATE 2
#define TK_BROWSER_COMPOSITION_END 3
#define TK_BROWSER_MIN_KEYCODE 8
#define TK_BROWSER_MAX_KEYCODE 255
#define TK_BROWSER_SYNTHETIC_KEYCODE_START 128

typedef struct TkBrowserQueuedEvent {
    XEvent event;
    int internal;
} TkBrowserQueuedEvent;

typedef struct TkBrowserAtomName {
    Atom atom;
    char *name;
    struct TkBrowserAtomName *nextPtr;
} TkBrowserAtomName;

typedef struct TkBrowserKeySymName {
    const char *name;
    KeySym keySym;
} TkBrowserKeySymName;

static TkBrowserDisplayState browserDisplay;
static int browserDisplayInitialized;
static TkBrowserAtomName *atomList;
static Atom nextAtom = XA_LAST_PREDEFINED;
static XErrorHandler errorHandler;
static TkBrowserQueuedEvent eventQueue[TK_BROWSER_EVENT_QUEUE_LIMIT];
static int eventQueueHead;
static int eventQueueCount;
static unsigned long eventSerial = 1;
static unsigned long damageSerial = 1;
static Time eventTime = 1;
static KeySym keycodeMap[TK_BROWSER_MAX_KEYCODE + 1];
static unsigned int nextSyntheticKeycode = TK_BROWSER_SYNTHETIC_KEYCODE_START;

static const TkBrowserKeySymName browserKeySymNames[] = {
    {"BackSpace", XK_BackSpace},
    {"Begin", XK_Begin},
    {"Break", XK_Break},
    {"Cancel", XK_Cancel},
    {"Clear", XK_Clear},
    {"Delete", XK_Delete},
    {"Down", XK_Down},
    {"End", XK_End},
    {"Escape", XK_Escape},
    {"Execute", XK_Execute},
    {"Find", XK_Find},
    {"Help", XK_Help},
    {"Home", XK_Home},
    {"ISO_Left_Tab", XK_ISO_Left_Tab},
    {"Insert", XK_Insert},
    {"KP_Add", XK_KP_Add},
    {"KP_Begin", XK_KP_Begin},
    {"KP_Decimal", XK_KP_Decimal},
    {"KP_Delete", XK_KP_Delete},
    {"KP_Divide", XK_KP_Divide},
    {"KP_Down", XK_KP_Down},
    {"KP_Enter", XK_KP_Enter},
    {"KP_Equal", XK_KP_Equal},
    {"KP_F1", XK_KP_F1},
    {"KP_F2", XK_KP_F2},
    {"KP_F3", XK_KP_F3},
    {"KP_F4", XK_KP_F4},
    {"KP_Home", XK_KP_Home},
    {"KP_Insert", XK_KP_Insert},
    {"KP_Left", XK_KP_Left},
    {"KP_Multiply", XK_KP_Multiply},
    {"KP_Next", XK_KP_Next},
    {"KP_Page_Down", XK_KP_Page_Down},
    {"KP_Page_Up", XK_KP_Page_Up},
    {"KP_Prior", XK_KP_Prior},
    {"KP_Right", XK_KP_Right},
    {"KP_Separator", XK_KP_Separator},
    {"KP_Space", XK_KP_Space},
    {"KP_Subtract", XK_KP_Subtract},
    {"KP_Tab", XK_KP_Tab},
    {"KP_Up", XK_KP_Up},
    {"Left", XK_Left},
    {"Linefeed", XK_Linefeed},
    {"Menu", XK_Menu},
    {"Mode_switch", XK_Mode_switch},
    {"Next", XK_Next},
    {"Num_Lock", XK_Num_Lock},
    {"Page_Down", XK_Page_Down},
    {"Page_Up", XK_Page_Up},
    {"Pause", XK_Pause},
    {"Print", XK_Print},
    {"Prior", XK_Prior},
    {"Redo", XK_Redo},
    {"Return", XK_Return},
    {"Right", XK_Right},
    {"Scroll_Lock", XK_Scroll_Lock},
    {"Select", XK_Select},
    {"Sys_Req", XK_Sys_Req},
    {"Tab", XK_Tab},
    {"Undo", XK_Undo},
    {"Up", XK_Up},
    {"ampersand", XK_ampersand},
    {"apostrophe", XK_apostrophe},
    {"asciicircum", XK_asciicircum},
    {"asciitilde", XK_asciitilde},
    {"backslash", XK_backslash},
    {"bar", XK_bar},
    {"braceleft", XK_braceleft},
    {"braceright", XK_braceright},
    {"bracketleft", XK_bracketleft},
    {"bracketright", XK_bracketright},
    {"colon", XK_colon},
    {"comma", XK_comma},
    {"dollar", XK_dollar},
    {"equal", XK_equal},
    {"exclam", XK_exclam},
    {"grave", XK_grave},
    {"greater", XK_greater},
    {"less", XK_less},
    {"minus", XK_minus},
    {"numbersign", XK_numbersign},
    {"parenleft", XK_parenleft},
    {"parenright", XK_parenright},
    {"percent", XK_percent},
    {"period", XK_period},
    {"plus", XK_plus},
    {"question", XK_question},
    {"quotedbl", XK_quotedbl},
    {"semicolon", XK_semicolon},
    {"space", XK_space},
    {"slash", XK_slash},
    {"underscore", XK_underscore},
};

static const char *BrowserCompositionEventName(int phase);
static Window BrowserGetTkFocusWindow(void);
static Window BrowserGetTkGrabWindow(void);
static TkBrowserResource *BrowserWindowResource(Window window);
static void BrowserUnlinkChild(TkBrowserResource *resourcePtr);
static void BrowserLinkChildAtTop(TkBrowserResource *resourcePtr,
	Window parent);
static void BrowserRestackWindow(TkBrowserResource *resourcePtr,
	unsigned int valueMask, XWindowChanges *changes);
static void BrowserWindowCoordinatesFromRoot(Window window, int rootX,
	int rootY, int *xPtr, int *yPtr);
static int BrowserQueueEventInternal(XEvent *eventPtr, int internal);
static void BrowserMarkResourceDamage(TkBrowserResource *resourcePtr,
	int x, int y, unsigned int width, unsigned int height);
static int BrowserQueueExpose(TkBrowserResource *resourcePtr,
	int x, int y, unsigned int width, unsigned int height);
static int BrowserQueueConfigureNotify(TkBrowserResource *resourcePtr);
static void BrowserApplyWindowAttributes(TkBrowserResource *resourcePtr,
	unsigned long mask, XSetWindowAttributes *atts);
static int BrowserImageDestroy(XImage *image);
static unsigned long BrowserImageGetPixel(XImage *image, int x, int y);
static int BrowserImagePutPixel(XImage *image, int x, int y,
	unsigned long pixel);
static XImage *BrowserImageSubImage(XImage *image, int x, int y,
	unsigned int width, unsigned int height);
static int BrowserImageAddPixel(XImage *image, long value);

static char *
BrowserDupString(
    const char *string)
{
    size_t length;
    char *copy;

    if (string == NULL) {
	string = "";
    }
    length = strlen(string);
    copy = (char *)ckalloc(length + 1);
    memcpy(copy, string, length + 1);
    return copy;
}

static int
BrowserAsciiEqual(
    const char *a,
    const char *b)
{
    while ((*a != '\0') && (*b != '\0')) {
	if (tolower((unsigned char)*a) != tolower((unsigned char)*b)) {
	    return 0;
	}
	a++;
	b++;
    }
    return (*a == '\0') && (*b == '\0');
}

static int
BrowserHexDigit(
    int ch)
{
    if ((ch >= '0') && (ch <= '9')) {
	return ch - '0';
    }
    if ((ch >= 'a') && (ch <= 'f')) {
	return ch - 'a' + 10;
    }
    if ((ch >= 'A') && (ch <= 'F')) {
	return ch - 'A' + 10;
    }
    return -1;
}

static int
BrowserUtf8FromCodepoint(
    unsigned int codepoint,
    char *buffer,
    int bufferLength)
{
    if ((buffer == NULL) || (bufferLength <= 0)) {
	return 0;
    }
    if (codepoint <= 0x7fU) {
	if (bufferLength < 1) return 0;
	buffer[0] = (char)codepoint;
	return 1;
    }
    if (codepoint <= 0x7ffU) {
	if (bufferLength < 2) return 0;
	buffer[0] = (char)(0xc0U | (codepoint >> 6));
	buffer[1] = (char)(0x80U | (codepoint & 0x3fU));
	return 2;
    }
    if (codepoint <= 0xffffU) {
	if (bufferLength < 3) return 0;
	buffer[0] = (char)(0xe0U | (codepoint >> 12));
	buffer[1] = (char)(0x80U | ((codepoint >> 6) & 0x3fU));
	buffer[2] = (char)(0x80U | (codepoint & 0x3fU));
	return 3;
    }
    if (codepoint <= 0x10ffffU) {
	if (bufferLength < 4) return 0;
	buffer[0] = (char)(0xf0U | (codepoint >> 18));
	buffer[1] = (char)(0x80U | ((codepoint >> 12) & 0x3fU));
	buffer[2] = (char)(0x80U | ((codepoint >> 6) & 0x3fU));
	buffer[3] = (char)(0x80U | (codepoint & 0x3fU));
	return 4;
    }
    return 0;
}

static KeySym
BrowserKeySymFromCodepoint(
    unsigned int codepoint)
{
    if (codepoint <= 0xffU) {
	return (KeySym)codepoint;
    }
    if (codepoint <= 0x10ffffU) {
	return (KeySym)(TK_BROWSER_UNICODE_KEYSYM_BASE | codepoint);
    }
    return NoSymbol;
}

static int
BrowserIsUnicodeKeySym(
    KeySym keySym)
{
    return (((unsigned int)keySym & 0xff000000U)
	    == TK_BROWSER_UNICODE_KEYSYM_BASE);
}

static void
BrowserRememberKeycode(
    unsigned int keycode,
    KeySym keySym)
{
    if ((keycode <= TK_BROWSER_MAX_KEYCODE) && (keySym != NoSymbol)) {
	keycodeMap[keycode] = keySym;
    }
}

static unsigned int
BrowserNextSyntheticKeycode(void)
{
    unsigned int keycode = nextSyntheticKeycode;

    nextSyntheticKeycode++;
    if (nextSyntheticKeycode > TK_BROWSER_MAX_KEYCODE) {
	nextSyntheticKeycode = TK_BROWSER_SYNTHETIC_KEYCODE_START;
    }
    return keycode;
}

static unsigned int
BrowserKeycodeFromKeySym(
    KeySym keySym)
{
    unsigned int keycode;

    if (keySym == NoSymbol) {
	return 0;
    }
    keycode = ((unsigned int)keySym & 0xffU);
    if (BrowserIsUnicodeKeySym(keySym)
	    || (keycode < TK_BROWSER_MIN_KEYCODE)
	    || (keycode > TK_BROWSER_MAX_KEYCODE)) {
	keycode = BrowserNextSyntheticKeycode();
    }
    BrowserRememberKeycode(keycode, keySym);
    return keycode;
}

static unsigned int
BrowserNormalizeKeycode(
    unsigned int keycode,
    KeySym keySym)
{
    if ((keycode < TK_BROWSER_MIN_KEYCODE)
	    || (keycode > TK_BROWSER_MAX_KEYCODE)) {
	return BrowserKeycodeFromKeySym(keySym);
    }
    BrowserRememberKeycode(keycode, keySym);
    return keycode;
}

static KeySym
BrowserKeySymForKeycode(
    unsigned int keycode)
{
    if ((keycode <= TK_BROWSER_MAX_KEYCODE)
	    && (keycodeMap[keycode] != NoSymbol)) {
	return keycodeMap[keycode];
    }
    if ((keycode >= TK_BROWSER_MIN_KEYCODE)
	    && (keycode <= TK_BROWSER_MAX_KEYCODE)) {
	return (KeySym)keycode;
    }
    return NoSymbol;
}

static int
BrowserParseHexComponent(
    const char *string,
    size_t digits,
    unsigned int *valuePtr)
{
    size_t i;
    unsigned int value = 0;
    unsigned int maxValue = 0;

    for (i = 0; i < digits; i++) {
	int digit = BrowserHexDigit(string[i]);

	if (digit < 0) {
	    return 0;
	}
	value = (value << 4) | (unsigned int)digit;
	maxValue = (maxValue << 4) | 0xfU;
    }
    *valuePtr = (unsigned int)(((unsigned long)value * 0xffffUL
	    + (maxValue / 2U)) / maxValue);
    return 1;
}

static const char *
BrowserCompositionEventName(
    int phase)
{
    switch (phase) {
    case TK_BROWSER_COMPOSITION_START:
	return "TkBrowserCompositionStart";
    case TK_BROWSER_COMPOSITION_UPDATE:
	return "TkBrowserCompositionUpdate";
    case TK_BROWSER_COMPOSITION_END:
	return "TkBrowserCompositionEnd";
    default:
	return NULL;
    }
}

static unsigned int
BrowserJsXId(
    XID xid)
{
    return (unsigned int)xid;
}

static unsigned long
BrowserGCPixel(
    GC gc)
{
    if (gc == NULL) {
	return 0;
    }
    return gc->foreground;
}

static int
BrowserImageDataLength(
    XImage *image)
{
    if ((image == NULL) || (image->data == NULL)
	    || (image->bytes_per_line <= 0) || (image->height <= 0)) {
	return 0;
    }
    return image->bytes_per_line * image->height;
}

static int
BrowserParseColor(
    const char *name,
    XColor *colorPtr)
{
    unsigned int red = 0, green = 0, blue = 0;

    if ((name == NULL) || (colorPtr == NULL)) {
	return 0;
    }

    if (name[0] == '#') {
	size_t length = strlen(name + 1);
	size_t componentDigits = length / 3;

	if (((length % 3) != 0) || (componentDigits < 1)
		|| (componentDigits > 4)) {
	    return 0;
	}
	if (!BrowserParseHexComponent(name + 1, componentDigits, &red)
		|| !BrowserParseHexComponent(name + 1 + componentDigits,
			componentDigits, &green)
		|| !BrowserParseHexComponent(name + 1 + 2 * componentDigits,
			componentDigits, &blue)) {
	    return 0;
	}
    } else if (BrowserAsciiEqual(name, "black")) {
	red = green = blue = 0;
    } else if (BrowserAsciiEqual(name, "white")) {
	red = green = blue = 0xffffU;
    } else if (BrowserAsciiEqual(name, "red")) {
	red = 0xffffU;
    } else if (BrowserAsciiEqual(name, "green")) {
	green = 0xffffU;
    } else if (BrowserAsciiEqual(name, "blue")) {
	blue = 0xffffU;
    } else if (BrowserAsciiEqual(name, "gray")
	    || BrowserAsciiEqual(name, "grey")) {
	red = green = blue = 0x8080U;
    } else {
	return 0;
    }

    colorPtr->red = (unsigned short)red;
    colorPtr->green = (unsigned short)green;
    colorPtr->blue = (unsigned short)blue;
    colorPtr->flags = DoRed | DoGreen | DoBlue;
    colorPtr->pixel = ((unsigned long)(red >> 8) << 16)
	    | ((unsigned long)(green >> 8) << 8) | (unsigned long)(blue >> 8);
    colorPtr->pad = 0;
    return 1;
}

static Atom
BrowserPredefinedAtom(
    const char *name)
{
    if (strcmp(name, "PRIMARY") == 0) return XA_PRIMARY;
    if (strcmp(name, "SECONDARY") == 0) return XA_SECONDARY;
    if (strcmp(name, "ATOM") == 0) return XA_ATOM;
    if (strcmp(name, "BITMAP") == 0) return XA_BITMAP;
    if (strcmp(name, "CARDINAL") == 0) return XA_CARDINAL;
    if (strcmp(name, "COLORMAP") == 0) return XA_COLORMAP;
    if (strcmp(name, "CURSOR") == 0) return XA_CURSOR;
    if (strcmp(name, "DRAWABLE") == 0) return XA_DRAWABLE;
    if (strcmp(name, "FONT") == 0) return XA_FONT;
    if (strcmp(name, "INTEGER") == 0) return XA_INTEGER;
    if (strcmp(name, "PIXMAP") == 0) return XA_PIXMAP;
    if (strcmp(name, "STRING") == 0) return XA_STRING;
    if (strcmp(name, "VISUALID") == 0) return XA_VISUALID;
    if (strcmp(name, "WINDOW") == 0) return XA_WINDOW;
    if (strcmp(name, "WM_COMMAND") == 0) return XA_WM_COMMAND;
    if (strcmp(name, "WM_HINTS") == 0) return XA_WM_HINTS;
    if (strcmp(name, "WM_CLIENT_MACHINE") == 0) return XA_WM_CLIENT_MACHINE;
    if (strcmp(name, "WM_ICON_NAME") == 0) return XA_WM_ICON_NAME;
    if (strcmp(name, "WM_NAME") == 0) return XA_WM_NAME;
    if (strcmp(name, "WM_NORMAL_HINTS") == 0) return XA_WM_NORMAL_HINTS;
    if (strcmp(name, "WM_SIZE_HINTS") == 0) return XA_WM_SIZE_HINTS;
    if (strcmp(name, "WM_CLASS") == 0) return XA_WM_CLASS;
    if (strcmp(name, "WM_TRANSIENT_FOR") == 0) return XA_WM_TRANSIENT_FOR;
    return None;
}

static const char *
BrowserPredefinedAtomName(
    Atom atom)
{
    switch (atom) {
    case XA_PRIMARY: return "PRIMARY";
    case XA_SECONDARY: return "SECONDARY";
    case XA_ATOM: return "ATOM";
    case XA_BITMAP: return "BITMAP";
    case XA_CARDINAL: return "CARDINAL";
    case XA_COLORMAP: return "COLORMAP";
    case XA_CURSOR: return "CURSOR";
    case XA_DRAWABLE: return "DRAWABLE";
    case XA_FONT: return "FONT";
    case XA_INTEGER: return "INTEGER";
    case XA_PIXMAP: return "PIXMAP";
    case XA_STRING: return "STRING";
    case XA_VISUALID: return "VISUALID";
    case XA_WINDOW: return "WINDOW";
    case XA_WM_COMMAND: return "WM_COMMAND";
    case XA_WM_HINTS: return "WM_HINTS";
    case XA_WM_CLIENT_MACHINE: return "WM_CLIENT_MACHINE";
    case XA_WM_ICON_NAME: return "WM_ICON_NAME";
    case XA_WM_NAME: return "WM_NAME";
    case XA_WM_NORMAL_HINTS: return "WM_NORMAL_HINTS";
    case XA_WM_SIZE_HINTS: return "WM_SIZE_HINTS";
    case XA_WM_CLASS: return "WM_CLASS";
    case XA_WM_TRANSIENT_FOR: return "WM_TRANSIENT_FOR";
    default: return NULL;
    }
}

static void
BrowserInitImageFuncs(
    XImage *image)
{
    image->f.create_image = XCreateImage;
    image->f.destroy_image = BrowserImageDestroy;
    image->f.get_pixel = BrowserImageGetPixel;
    image->f.put_pixel = BrowserImagePutPixel;
    image->f.sub_image = BrowserImageSubImage;
    image->f.add_pixel = BrowserImageAddPixel;
}

static int
BrowserImageDestroy(
    XImage *image)
{
    if (image == NULL) {
	return Success;
    }
    if ((image->obdata == (XPointer)image) && (image->data != NULL)) {
	ckfree(image->data);
    }
    ckfree(image);
    return Success;
}

static unsigned long
BrowserImageGetPixel(
    XImage *image,
    int x,
    int y)
{
    int bytesPerPixel;
    unsigned char *pixelPtr;

    if ((image == NULL) || (image->data == NULL)
	    || (x < 0) || (y < 0) || (x >= image->width)
	    || (y >= image->height)) {
	return 0;
    }
    bytesPerPixel = image->bits_per_pixel / 8;
    if (bytesPerPixel <= 0) {
	return 0;
    }
    pixelPtr = (unsigned char *)image->data + y * image->bytes_per_line
	    + x * bytesPerPixel;
    if (bytesPerPixel >= 4) {
	return ((unsigned long)pixelPtr[0])
		| ((unsigned long)pixelPtr[1] << 8)
		| ((unsigned long)pixelPtr[2] << 16)
		| ((unsigned long)pixelPtr[3] << 24);
    }
    if (bytesPerPixel == 3) {
	return ((unsigned long)pixelPtr[0])
		| ((unsigned long)pixelPtr[1] << 8)
		| ((unsigned long)pixelPtr[2] << 16);
    }
    if (bytesPerPixel == 2) {
	return ((unsigned long)pixelPtr[0]) | ((unsigned long)pixelPtr[1] << 8);
    }
    return pixelPtr[0];
}

static int
BrowserImagePutPixel(
    XImage *image,
    int x,
    int y,
    unsigned long pixel)
{
    int bytesPerPixel;
    unsigned char *pixelPtr;

    if ((image == NULL) || (image->data == NULL)
	    || (x < 0) || (y < 0) || (x >= image->width)
	    || (y >= image->height)) {
	return 0;
    }
    bytesPerPixel = image->bits_per_pixel / 8;
    if (bytesPerPixel <= 0) {
	return 0;
    }
    pixelPtr = (unsigned char *)image->data + y * image->bytes_per_line
	    + x * bytesPerPixel;
    pixelPtr[0] = (unsigned char)(pixel & 0xff);
    if (bytesPerPixel > 1) pixelPtr[1] = (unsigned char)((pixel >> 8) & 0xff);
    if (bytesPerPixel > 2) pixelPtr[2] = (unsigned char)((pixel >> 16) & 0xff);
    if (bytesPerPixel > 3) pixelPtr[3] = (unsigned char)((pixel >> 24) & 0xff);
    return Success;
}

static XImage *
BrowserImageSubImage(
    XImage *image,
    int x,
    int y,
    unsigned int width,
    unsigned int height)
{
    XImage *subImage;
    unsigned int ix, iy;

    subImage = XCreateImage(NULL, NULL, (unsigned int)image->depth,
	    image->format, 0, NULL, width, height, image->bitmap_pad, 0);
    if (subImage == NULL) {
	return NULL;
    }
    subImage->data = (char *)ckalloc(subImage->bytes_per_line * height);
    memset(subImage->data, 0, subImage->bytes_per_line * height);
    subImage->obdata = (XPointer)subImage;
    for (iy = 0; iy < height; iy++) {
	for (ix = 0; ix < width; ix++) {
	    BrowserImagePutPixel(subImage, (int)ix, (int)iy,
		    BrowserImageGetPixel(image, x + (int)ix, y + (int)iy));
	}
    }
    return subImage;
}

static int
BrowserImageAddPixel(
    XImage *image,
    long value)
{
    (void)image;
    (void)value;
    return Success;
}

static void
BrowserInitGC(
    Display *display,
    GC gc)
{
    memset(gc, 0, sizeof(XGCValues));
    gc->function = GXcopy;
    gc->plane_mask = AllPlanes;
    gc->foreground = BlackPixel(display, DefaultScreen(display));
    gc->background = WhitePixel(display, DefaultScreen(display));
    gc->line_width = 1;
    gc->line_style = LineSolid;
    gc->fill_style = FillSolid;
    gc->fill_rule = EvenOddRule;
    gc->arc_mode = ArcPieSlice;
    gc->subwindow_mode = ClipByChildren;
    gc->graphics_exposures = True;
    gc->dashes = 4;
}

static void
BrowserApplyGCValues(
    GC gc,
    unsigned long mask,
    XGCValues *values)
{
    if (values == NULL) {
	return;
    }
#define COPY_GC_FIELD(bit, field) \
    if (mask & (bit)) { gc->field = values->field; }
    COPY_GC_FIELD(GCFunction, function);
    COPY_GC_FIELD(GCPlaneMask, plane_mask);
    COPY_GC_FIELD(GCForeground, foreground);
    COPY_GC_FIELD(GCBackground, background);
    COPY_GC_FIELD(GCLineWidth, line_width);
    COPY_GC_FIELD(GCLineStyle, line_style);
    COPY_GC_FIELD(GCCapStyle, cap_style);
    COPY_GC_FIELD(GCJoinStyle, join_style);
    COPY_GC_FIELD(GCFillStyle, fill_style);
    COPY_GC_FIELD(GCFillRule, fill_rule);
    COPY_GC_FIELD(GCTile, tile);
    COPY_GC_FIELD(GCStipple, stipple);
    COPY_GC_FIELD(GCTileStipXOrigin, ts_x_origin);
    COPY_GC_FIELD(GCTileStipYOrigin, ts_y_origin);
    COPY_GC_FIELD(GCFont, font);
    COPY_GC_FIELD(GCSubwindowMode, subwindow_mode);
    COPY_GC_FIELD(GCGraphicsExposures, graphics_exposures);
    COPY_GC_FIELD(GCClipXOrigin, clip_x_origin);
    COPY_GC_FIELD(GCClipYOrigin, clip_y_origin);
    COPY_GC_FIELD(GCClipMask, clip_mask);
    COPY_GC_FIELD(GCDashOffset, dash_offset);
    COPY_GC_FIELD(GCDashList, dashes);
    COPY_GC_FIELD(GCArcMode, arc_mode);
#undef COPY_GC_FIELD
}

static void
BrowserInitDisplay(void)
{
    TkBrowserDisplayState *state = &browserDisplay;

    if (browserDisplayInitialized) {
	return;
    }
    memset(state, 0, sizeof(*state));

    state->rootWindow = 1;
    state->focusWindow = state->rootWindow;
    state->pointerWindow = state->rootWindow;
    state->defaultColormap = 2;
    state->nextXId = 100;

    state->visual.visualid = 1;
    state->visual.c_class = TrueColor;
    state->visual.red_mask = 0xff0000;
    state->visual.green_mask = 0x00ff00;
    state->visual.blue_mask = 0x0000ff;
    state->visual.bits_per_rgb = 8;
    state->visual.map_entries = 256;

    state->depth.depth = 24;
    state->depth.nvisuals = 1;
    state->depth.visuals = &state->visual;

    state->screen.display = &state->display;
    state->screen.root = state->rootWindow;
    state->screen.width = 1024;
    state->screen.height = 768;
    state->screen.mwidth = 270;
    state->screen.mheight = 203;
    state->screen.ndepths = 1;
    state->screen.depths = &state->depth;
    state->screen.root_depth = 24;
    state->screen.root_visual = &state->visual;
    state->screen.cmap = state->defaultColormap;
    state->screen.white_pixel = 0xffffff;
    state->screen.black_pixel = 0x000000;
    state->screen.max_maps = 1;
    state->screen.min_maps = 1;
    state->screen.backing_store = NotUseful;
    state->screen.save_unders = False;

    state->display.fd = 0;
    state->display.proto_major_version = X_PROTOCOL;
    state->display.proto_minor_version = X_PROTOCOL_REVISION;
    state->display.vendor = (char *)"tcltk.wasm";
    state->display.resource_alloc = TkBrowserAllocXId;
    state->display.byte_order = LSBFirst;
    state->display.bitmap_unit = 32;
    state->display.bitmap_pad = 32;
    state->display.bitmap_bit_order = LSBFirst;
    state->display.release = 1;
    state->display.display_name = (char *)"browser";
    state->display.default_screen = 0;
    state->display.nscreens = 1;
    state->display.screens = &state->screen;
    state->display.min_keycode = 8;
    state->display.max_keycode = 255;

    BrowserInitGC(&state->display, &state->defaultGC);
    state->screen.default_gc = &state->defaultGC;

    state->rootResource.id = state->rootWindow;
    state->rootResource.type = TK_BROWSER_RESOURCE_WINDOW;
    state->rootResource.display = &state->display;
    state->rootResource.width = (unsigned int)state->screen.width;
    state->rootResource.height = (unsigned int)state->screen.height;
    state->rootResource.depth = (unsigned int)state->screen.root_depth;
    state->rootResource.mapped = 1;
    state->rootResource.atts.colormap = state->defaultColormap;
    state->rootResource.atts.event_mask = StructureNotifyMask
	    | ExposureMask | KeyPressMask | KeyReleaseMask | ButtonPressMask
	    | ButtonReleaseMask | PointerMotionMask;
    state->resourceList = &state->rootResource;

    browserDisplayInitialized = 1;
    (void)TkBrowserJsInit(state->screen.width, state->screen.height,
	    BrowserJsXId(state->rootWindow));
}

static void
BrowserUpdateQueueLength(void)
{
    if (browserDisplayInitialized) {
	browserDisplay.display.qlen = eventQueueCount;
    }
}

static int
BrowserWindowCanReceiveEvents(
    Window window)
{
    TkWindow *winPtr;

    if (window == None) {
	return 0;
    }
    winPtr = (TkWindow *)Tk_IdToWindow(&browserDisplay.display, window);
    return (winPtr != NULL) && (winPtr->mainPtr != NULL);
}

static Window
BrowserResolveEventWindow(
    Window window)
{
    Window focusWindow;

    BrowserInitDisplay();
    if (BrowserWindowCanReceiveEvents(window)) {
	return window;
    }
    focusWindow = BrowserGetTkFocusWindow();
    if (BrowserWindowCanReceiveEvents(focusWindow)) {
	return focusWindow;
    }
    if (BrowserWindowCanReceiveEvents(browserDisplay.focusWindow)) {
	return browserDisplay.focusWindow;
    }
    return browserDisplay.rootWindow;
}

static Window
BrowserGetTkFocusWindow(void)
{
    TkDisplay *dispPtr;

    BrowserInitDisplay();
    for (dispPtr = TkGetDisplayList(); dispPtr != NULL;
	    dispPtr = dispPtr->nextPtr) {
	if ((dispPtr->display == &browserDisplay.display)
		&& (dispPtr->focusPtr != NULL)
		&& (dispPtr->focusPtr->window != None)) {
	    return dispPtr->focusPtr->window;
	}
    }
    return None;
}

static Window
BrowserGetTkGrabWindow(void)
{
    TkDisplay *dispPtr;

    BrowserInitDisplay();
    for (dispPtr = TkGetDisplayList(); dispPtr != NULL;
	    dispPtr = dispPtr->nextPtr) {
	if (dispPtr->display != &browserDisplay.display) {
	    continue;
	}
	if ((dispPtr->grabWinPtr != NULL)
		&& (dispPtr->grabWinPtr->window != None)) {
	    return dispPtr->grabWinPtr->window;
	}
	if ((dispPtr->eventualGrabWinPtr != NULL)
		&& (dispPtr->eventualGrabWinPtr->window != None)) {
	    return dispPtr->eventualGrabWinPtr->window;
	}
    }
    return None;
}

static Window
BrowserResolveKeyEventWindow(
    Window window)
{
    Window focusWindow = BrowserGetTkFocusWindow();

    if ((focusWindow != None)
	    && (Tk_IdToWindow(&browserDisplay.display, focusWindow) != NULL)) {
	return focusWindow;
    }
    if ((window != None)
	    && (Tk_IdToWindow(&browserDisplay.display, window) != NULL)) {
	return window;
    }
    return BrowserResolveEventWindow(window);
}

static Tk_Window
BrowserResolveTkEventWindow(
    Window window)
{
    Window target = BrowserResolveKeyEventWindow(window);
    Tk_Window tkwin = Tk_IdToWindow(&browserDisplay.display, target);

    if (tkwin != NULL) {
	return tkwin;
    }
    return NULL;
}

static void
BrowserSetCommonEventFields(
    XEvent *eventPtr,
    int type,
    Window window,
    Time time)
{
    memset(eventPtr, 0, sizeof(XEvent));
    eventPtr->xany.type = type;
    eventPtr->xany.serial = eventSerial++;
    eventPtr->xany.send_event = False;
    eventPtr->xany.display = &browserDisplay.display;
    eventPtr->xany.window = window;
    if (time != CurrentTime) {
	eventTime = time;
    } else {
	eventTime++;
    }
}

static int
BrowserQueueVirtualEvent(
    Tk_Window tkwin,
    const char *eventName,
    Tcl_Obj *detailObj)
{
    union {
	XEvent general;
	XVirtualEvent virt;
    } event;

    if ((tkwin == NULL) || (eventName == NULL)) {
	return 0;
    }
    memset(&event, 0, sizeof(event));
    event.general.xany.type = VirtualEvent;
    event.general.xany.serial = eventSerial++;
    event.general.xany.send_event = False;
    event.general.xany.display = Tk_Display(tkwin);
    event.general.xany.window = Tk_WindowId(tkwin);
    event.virt.event = Tk_WindowId(tkwin);
    event.virt.root = browserDisplay.rootWindow;
    event.virt.time = ++eventTime;
    BrowserWindowCoordinatesFromRoot(Tk_WindowId(tkwin),
	    browserDisplay.pointerX, browserDisplay.pointerY, &event.virt.x,
	    &event.virt.y);
    event.virt.x_root = browserDisplay.pointerX;
    event.virt.y_root = browserDisplay.pointerY;
    event.virt.state = browserDisplay.pointerState;
    event.virt.name = Tk_GetUid(eventName);
    event.virt.same_screen = True;
    event.virt.user_data = detailObj;
    if (detailObj != NULL) {
	Tcl_IncrRefCount(detailObj);
    }
    if (!BrowserQueueEventInternal(&event.general, 1)) {
	if (detailObj != NULL) {
	    Tcl_DecrRefCount(detailObj);
	}
	return 0;
    }
    return 1;
}

static int
BrowserQueueEventInternal(
    XEvent *eventPtr,
    int internal)
{
    int tail;

    BrowserInitDisplay();
    if (eventQueueCount >= TK_BROWSER_EVENT_QUEUE_LIMIT) {
	return 0;
    }
    tail = (eventQueueHead + eventQueueCount) % TK_BROWSER_EVENT_QUEUE_LIMIT;
    eventQueue[tail].event = *eventPtr;
    eventQueue[tail].internal = internal;
    eventQueueCount++;
    BrowserUpdateQueueLength();
    return 1;
}

static int
BrowserQueueEvent(
    XEvent *eventPtr)
{
    return BrowserQueueEventInternal(eventPtr, 0);
}

static unsigned short
BrowserClampUShort(
    unsigned int value)
{
    return (value > 0xffffU) ? 0xffffU : (unsigned short)value;
}

static int
BrowserResourceWantsEvent(
    TkBrowserResource *resourcePtr,
    long mask)
{
    return (resourcePtr != NULL) && ((resourcePtr->atts.event_mask & mask) != 0);
}

static void
BrowserApplyWindowAttributes(
    TkBrowserResource *resourcePtr,
    unsigned long mask,
    XSetWindowAttributes *atts)
{
    if ((resourcePtr == NULL) || (atts == NULL)) {
	return;
    }
    if (mask & CWBackPixmap) {
	resourcePtr->atts.background_pixmap = atts->background_pixmap;
    }
    if (mask & CWBackPixel) {
	resourcePtr->atts.background_pixel = atts->background_pixel;
    }
    if (mask & CWBorderPixmap) {
	resourcePtr->atts.border_pixmap = atts->border_pixmap;
    }
    if (mask & CWBorderPixel) {
	resourcePtr->atts.border_pixel = atts->border_pixel;
    }
    if (mask & CWBitGravity) {
	resourcePtr->atts.bit_gravity = atts->bit_gravity;
    }
    if (mask & CWWinGravity) {
	resourcePtr->atts.win_gravity = atts->win_gravity;
    }
    if (mask & CWBackingStore) {
	resourcePtr->atts.backing_store = atts->backing_store;
    }
    if (mask & CWBackingPlanes) {
	resourcePtr->atts.backing_planes = atts->backing_planes;
    }
    if (mask & CWBackingPixel) {
	resourcePtr->atts.backing_pixel = atts->backing_pixel;
    }
    if (mask & CWOverrideRedirect) {
	resourcePtr->atts.override_redirect = atts->override_redirect;
    }
    if (mask & CWSaveUnder) {
	resourcePtr->atts.save_under = atts->save_under;
    }
    if (mask & CWEventMask) {
	resourcePtr->atts.event_mask = atts->event_mask;
    }
    if (mask & CWDontPropagate) {
	resourcePtr->atts.do_not_propagate_mask = atts->do_not_propagate_mask;
    }
    if (mask & CWColormap) {
	resourcePtr->atts.colormap = atts->colormap;
    }
    if (mask & CWCursor) {
	resourcePtr->atts.cursor = atts->cursor;
    }
}

static void
BrowserMarkResourceDamage(
    TkBrowserResource *resourcePtr,
    int x,
    int y,
    unsigned int width,
    unsigned int height)
{
    int x1, y1, x2, y2;
    int oldX1, oldY1, oldX2, oldY2;

    if ((resourcePtr == NULL) || (width == 0) || (height == 0)) {
	return;
    }
    if (x < 0) {
	unsigned int clipped = (unsigned int)-x;
	if (clipped >= width) {
	    return;
	}
	width -= clipped;
	x = 0;
    }
    if (y < 0) {
	unsigned int clipped = (unsigned int)-y;
	if (clipped >= height) {
	    return;
	}
	height -= clipped;
	y = 0;
    }
    if (((unsigned int)x >= resourcePtr->width)
	    || ((unsigned int)y >= resourcePtr->height)) {
	return;
    }
    if (width > resourcePtr->width - (unsigned int)x) {
	width = resourcePtr->width - (unsigned int)x;
    }
    if (height > resourcePtr->height - (unsigned int)y) {
	height = resourcePtr->height - (unsigned int)y;
    }
    if ((width == 0) || (height == 0)) {
	return;
    }

    x1 = x;
    y1 = y;
    x2 = x + (int)width;
    y2 = y + (int)height;
    if (resourcePtr->damaged) {
	oldX1 = resourcePtr->damage.x;
	oldY1 = resourcePtr->damage.y;
	oldX2 = oldX1 + resourcePtr->damage.width;
	oldY2 = oldY1 + resourcePtr->damage.height;
	if (oldX1 < x1) x1 = oldX1;
	if (oldY1 < y1) y1 = oldY1;
	if (oldX2 > x2) x2 = oldX2;
	if (oldY2 > y2) y2 = oldY2;
    }

    resourcePtr->damaged = 1;
    resourcePtr->damage.x = (short)x1;
    resourcePtr->damage.y = (short)y1;
    resourcePtr->damage.width = BrowserClampUShort((unsigned int)(x2 - x1));
    resourcePtr->damage.height = BrowserClampUShort((unsigned int)(y2 - y1));
    resourcePtr->damageSerial = damageSerial++;
}

static int
BrowserQueueExpose(
    TkBrowserResource *resourcePtr,
    int x,
    int y,
    unsigned int width,
    unsigned int height)
{
    XEvent event;

    BrowserMarkResourceDamage(resourcePtr, x, y, width, height);
    if ((resourcePtr == NULL)
	    || (resourcePtr->type != TK_BROWSER_RESOURCE_WINDOW)
	    || !resourcePtr->mapped
	    || !BrowserResourceWantsEvent(resourcePtr, ExposureMask)) {
	return 0;
    }
    BrowserSetCommonEventFields(&event, Expose, (Window)resourcePtr->id,
	    CurrentTime);
    event.xexpose.window = (Window)resourcePtr->id;
    event.xexpose.x = x;
    event.xexpose.y = y;
    event.xexpose.width = (int)width;
    event.xexpose.height = (int)height;
    event.xexpose.count = 0;
    return BrowserQueueEvent(&event);
}

static int
BrowserQueueConfigureNotify(
    TkBrowserResource *resourcePtr)
{
    XEvent event;

    if ((resourcePtr == NULL)
	    || (resourcePtr->type != TK_BROWSER_RESOURCE_WINDOW)
	    || !BrowserResourceWantsEvent(resourcePtr, StructureNotifyMask)) {
	return 0;
    }
    BrowserSetCommonEventFields(&event, ConfigureNotify,
	    (Window)resourcePtr->id, CurrentTime);
    event.xconfigure.event = (Window)resourcePtr->id;
    event.xconfigure.window = (Window)resourcePtr->id;
    event.xconfigure.x = resourcePtr->x;
    event.xconfigure.y = resourcePtr->y;
    event.xconfigure.width = (int)resourcePtr->width;
    event.xconfigure.height = (int)resourcePtr->height;
    event.xconfigure.border_width = (int)resourcePtr->borderWidth;
    event.xconfigure.above = None;
    event.xconfigure.override_redirect = resourcePtr->atts.override_redirect;
    return BrowserQueueEvent(&event);
}

static int
BrowserPopEvent(
    XEvent *eventPtr,
    int *internalPtr)
{
    BrowserInitDisplay();
    if (eventQueueCount <= 0) {
	if (eventPtr != NULL) {
	    memset(eventPtr, 0, sizeof(XEvent));
	}
	if (internalPtr != NULL) {
	    *internalPtr = 0;
	}
	return 0;
    }
    if (eventPtr != NULL) {
	*eventPtr = eventQueue[eventQueueHead].event;
    }
    if (internalPtr != NULL) {
	*internalPtr = eventQueue[eventQueueHead].internal;
    }
    eventQueueHead = (eventQueueHead + 1) % TK_BROWSER_EVENT_QUEUE_LIMIT;
    eventQueueCount--;
    BrowserUpdateQueueLength();
    return 1;
}

static void
BrowserWindowRootOffset(
    Window window,
    int *xPtr,
    int *yPtr)
{
    int x = 0;
    int y = 0;
    TkBrowserResource *resourcePtr;

    for (resourcePtr = TkBrowserFindResource(window);
	    resourcePtr != NULL && resourcePtr->id != browserDisplay.rootWindow;
	    resourcePtr = TkBrowserFindResource(resourcePtr->parent)) {
	x += resourcePtr->x;
	y += resourcePtr->y;
    }
    if (xPtr != NULL) {
	*xPtr = x;
    }
    if (yPtr != NULL) {
	*yPtr = y;
    }
}

static TkBrowserResource *
BrowserWindowResource(
    Window window)
{
    TkBrowserResource *resourcePtr = TkBrowserFindResource(window);

    if ((resourcePtr != NULL)
	    && (resourcePtr->type == TK_BROWSER_RESOURCE_WINDOW)) {
	return resourcePtr;
    }
    return NULL;
}

static void
BrowserUnlinkChild(
    TkBrowserResource *resourcePtr)
{
    TkBrowserResource *parentPtr;

    if (resourcePtr == NULL) {
	return;
    }
    parentPtr = resourcePtr->parentPtr;
    if (parentPtr != NULL) {
	if (parentPtr->firstChildPtr == resourcePtr) {
	    parentPtr->firstChildPtr = resourcePtr->nextSiblingPtr;
	}
	if (parentPtr->lastChildPtr == resourcePtr) {
	    parentPtr->lastChildPtr = resourcePtr->prevSiblingPtr;
	}
    }
    if (resourcePtr->prevSiblingPtr != NULL) {
	resourcePtr->prevSiblingPtr->nextSiblingPtr =
		resourcePtr->nextSiblingPtr;
    }
    if (resourcePtr->nextSiblingPtr != NULL) {
	resourcePtr->nextSiblingPtr->prevSiblingPtr =
		resourcePtr->prevSiblingPtr;
    }
    resourcePtr->parentPtr = NULL;
    resourcePtr->prevSiblingPtr = NULL;
    resourcePtr->nextSiblingPtr = NULL;
}

static void
BrowserLinkChildBefore(
    TkBrowserResource *resourcePtr,
    TkBrowserResource *parentPtr,
    TkBrowserResource *siblingPtr)
{
    if ((resourcePtr == NULL) || (parentPtr == NULL)
	    || (resourcePtr == parentPtr) || (resourcePtr == siblingPtr)) {
	return;
    }
    BrowserUnlinkChild(resourcePtr);
    resourcePtr->parentPtr = parentPtr;
    resourcePtr->nextSiblingPtr = siblingPtr;
    if (siblingPtr != NULL) {
	resourcePtr->prevSiblingPtr = siblingPtr->prevSiblingPtr;
	siblingPtr->prevSiblingPtr = resourcePtr;
    } else {
	resourcePtr->prevSiblingPtr = parentPtr->lastChildPtr;
	parentPtr->lastChildPtr = resourcePtr;
    }
    if (resourcePtr->prevSiblingPtr != NULL) {
	resourcePtr->prevSiblingPtr->nextSiblingPtr = resourcePtr;
    } else {
	parentPtr->firstChildPtr = resourcePtr;
    }
    if (resourcePtr->nextSiblingPtr == NULL) {
	parentPtr->lastChildPtr = resourcePtr;
    }
}

static void
BrowserLinkChildAfter(
    TkBrowserResource *resourcePtr,
    TkBrowserResource *parentPtr,
    TkBrowserResource *siblingPtr)
{
    if ((resourcePtr == NULL) || (parentPtr == NULL)
	    || (resourcePtr == parentPtr) || (resourcePtr == siblingPtr)) {
	return;
    }
    BrowserUnlinkChild(resourcePtr);
    resourcePtr->parentPtr = parentPtr;
    resourcePtr->prevSiblingPtr = siblingPtr;
    if (siblingPtr != NULL) {
	resourcePtr->nextSiblingPtr = siblingPtr->nextSiblingPtr;
	siblingPtr->nextSiblingPtr = resourcePtr;
    } else {
	resourcePtr->nextSiblingPtr = parentPtr->firstChildPtr;
	parentPtr->firstChildPtr = resourcePtr;
    }
    if (resourcePtr->nextSiblingPtr != NULL) {
	resourcePtr->nextSiblingPtr->prevSiblingPtr = resourcePtr;
    } else {
	parentPtr->lastChildPtr = resourcePtr;
    }
    if (resourcePtr->prevSiblingPtr == NULL) {
	parentPtr->firstChildPtr = resourcePtr;
    }
}

static void
BrowserLinkChildAtTop(
    TkBrowserResource *resourcePtr,
    Window parent)
{
    TkBrowserResource *parentPtr = BrowserWindowResource(parent);

    BrowserUnlinkChild(resourcePtr);
    if (parentPtr != NULL) {
	BrowserLinkChildBefore(resourcePtr, parentPtr, NULL);
    }
}

static void
BrowserLinkChildAtBottom(
    TkBrowserResource *resourcePtr,
    Window parent)
{
    TkBrowserResource *parentPtr = BrowserWindowResource(parent);

    BrowserUnlinkChild(resourcePtr);
    if (parentPtr != NULL) {
	BrowserLinkChildAfter(resourcePtr, parentPtr, NULL);
    }
}

static void
BrowserRestackWindow(
    TkBrowserResource *resourcePtr,
    unsigned int valueMask,
    XWindowChanges *changes)
{
    TkBrowserResource *siblingPtr = NULL;
    TkBrowserResource *parentPtr;
    int mode = Above;

    if ((resourcePtr == NULL)
	    || (resourcePtr->type != TK_BROWSER_RESOURCE_WINDOW)
	    || (resourcePtr->id == browserDisplay.rootWindow)) {
	return;
    }
    parentPtr = BrowserWindowResource(resourcePtr->parent);
    if (parentPtr == NULL) {
	return;
    }
    if ((valueMask & CWStackMode) && (changes != NULL)) {
	mode = changes->stack_mode;
    }
    if ((valueMask & CWSibling) && (changes != NULL)) {
	siblingPtr = BrowserWindowResource(changes->sibling);
	if ((siblingPtr == resourcePtr)
		|| (siblingPtr == NULL)
		|| (siblingPtr->parentPtr != parentPtr)) {
	    siblingPtr = NULL;
	}
    }

    switch (mode) {
    case Below:
    case BottomIf:
	if (siblingPtr != NULL) {
	    BrowserLinkChildBefore(resourcePtr, parentPtr, siblingPtr);
	} else {
	    BrowserLinkChildAtBottom(resourcePtr, (Window)parentPtr->id);
	}
	break;
    case Opposite:
	if (resourcePtr->nextSiblingPtr == NULL) {
	    BrowserLinkChildAtBottom(resourcePtr, (Window)parentPtr->id);
	} else {
	    BrowserLinkChildAtTop(resourcePtr, (Window)parentPtr->id);
	}
	break;
    case Above:
    case TopIf:
    default:
	if (siblingPtr != NULL) {
	    BrowserLinkChildAfter(resourcePtr, parentPtr, siblingPtr);
	} else {
	    BrowserLinkChildAtTop(resourcePtr, (Window)parentPtr->id);
	}
	break;
    }
}

static int
BrowserResourceIsVisible(
    TkBrowserResource *resourcePtr)
{
    while (resourcePtr != NULL) {
	if ((resourcePtr->type == TK_BROWSER_RESOURCE_WINDOW)
		&& !resourcePtr->mapped) {
	    return 0;
	}
	if (resourcePtr->id == browserDisplay.rootWindow) {
	    return 1;
	}
	resourcePtr = (resourcePtr->parentPtr != NULL)
		? resourcePtr->parentPtr
		: TkBrowserFindResource(resourcePtr->parent);
    }
    return 0;
}

static TkBrowserResource *
BrowserFindTopVisibleChildAt(
    TkBrowserResource *parentPtr,
    int x,
    int y)
{
    TkBrowserResource *childPtr;

    if (parentPtr == NULL) {
	return NULL;
    }
    for (childPtr = parentPtr->lastChildPtr; childPtr != NULL;
	    childPtr = childPtr->prevSiblingPtr) {
	if ((childPtr->type != TK_BROWSER_RESOURCE_WINDOW)
		|| !BrowserResourceIsVisible(childPtr)) {
	    continue;
	}
	if ((x >= childPtr->x) && (y >= childPtr->y)
		&& (x < (childPtr->x + (int)childPtr->width))
		&& (y < (childPtr->y + (int)childPtr->height))) {
	    return childPtr;
	}
    }
    return NULL;
}

static Window
BrowserHitTestRoot(
    int rootX,
    int rootY,
    int *xPtr,
    int *yPtr)
{
    TkBrowserResource *resourcePtr;
    TkBrowserResource *childPtr;
    int x = rootX;
    int y = rootY;

    BrowserInitDisplay();
    resourcePtr = &browserDisplay.rootResource;
    while ((childPtr = BrowserFindTopVisibleChildAt(resourcePtr, x, y))
	    != NULL) {
	x -= childPtr->x;
	y -= childPtr->y;
	resourcePtr = childPtr;
    }
    if (xPtr != NULL) {
	*xPtr = x;
    }
    if (yPtr != NULL) {
	*yPtr = y;
    }
    return (Window)resourcePtr->id;
}

static void
BrowserWindowCoordinatesFromRoot(
    Window window,
    int rootX,
    int rootY,
    int *xPtr,
    int *yPtr)
{
    int windowRootX = 0;
    int windowRootY = 0;

    BrowserWindowRootOffset(window, &windowRootX, &windowRootY);
    if (xPtr != NULL) {
	*xPtr = rootX - windowRootX;
    }
    if (yPtr != NULL) {
	*yPtr = rootY - windowRootY;
    }
}

static void
BrowserTranslateWindowCoordinates(
    Window source,
    Window destination,
    int sourceX,
    int sourceY,
    int *destXPtr,
    int *destYPtr)
{
    int sourceRootX = 0;
    int sourceRootY = 0;
    int destinationRootX = 0;
    int destinationRootY = 0;

    BrowserWindowRootOffset(source, &sourceRootX, &sourceRootY);
    BrowserWindowRootOffset(destination, &destinationRootX, &destinationRootY);
    if (destXPtr != NULL) {
	*destXPtr = sourceX + sourceRootX - destinationRootX;
    }
    if (destYPtr != NULL) {
	*destYPtr = sourceY + sourceRootY - destinationRootY;
    }
}

static int
BrowserWindowInTree(
    Window window,
    Window ancestor)
{
    TkBrowserResource *resourcePtr;

    if ((window == None) || (ancestor == None)) {
	return 0;
    }
    if (window == ancestor) {
	return 1;
    }
    for (resourcePtr = TkBrowserFindResource(window);
	    resourcePtr != NULL && resourcePtr->id != browserDisplay.rootWindow;
	    resourcePtr = TkBrowserFindResource(resourcePtr->parent)) {
	if (resourcePtr->parent == ancestor) {
	    return 1;
	}
    }
    return 0;
}

static Window
BrowserResolvePointerEventWindow(
    Window window,
    int *xPtr,
    int *yPtr)
{
    int rootX = (xPtr != NULL) ? *xPtr : 0;
    int rootY = (yPtr != NULL) ? *yPtr : 0;
    Window target;
    Window rawTarget;
    Window grabWindow;
    int grabOwnerEvents = 1;

    (void)window;
    BrowserInitDisplay();
    rawTarget = BrowserHitTestRoot(rootX, rootY, NULL, NULL);

    target = rawTarget;
    if (BrowserWindowCanReceiveEvents(browserDisplay.pointerCaptureWindow)) {
	target = browserDisplay.pointerCaptureWindow;
    }
    grabWindow = browserDisplay.pointerGrabWindow;
    if (BrowserWindowCanReceiveEvents(grabWindow)) {
	grabOwnerEvents = browserDisplay.pointerGrabOwnerEvents;
    } else {
	grabWindow = BrowserGetTkGrabWindow();
	grabOwnerEvents = 1;
    }

    if (BrowserWindowCanReceiveEvents(grabWindow)) {
	if (!grabOwnerEvents || !BrowserWindowInTree(rawTarget, grabWindow)) {
	    target = grabWindow;
	}
    } else if (!BrowserWindowCanReceiveEvents(target)) {
	target = BrowserResolveEventWindow(target);
    }
    if (!BrowserWindowCanReceiveEvents(target)) {
	target = BrowserResolveEventWindow(target);
    }

    BrowserWindowCoordinatesFromRoot(target, rootX, rootY, xPtr, yPtr);
    return target;
}

static void
BrowserUpdatePointerState(
    Window window,
    int rootX,
    int rootY,
    unsigned int state)
{
    browserDisplay.pointerWindow = window;
    browserDisplay.pointerX = rootX;
    browserDisplay.pointerY = rootY;
    browserDisplay.pointerState = state;
}

EMSCRIPTEN_KEEPALIVE int
TkBrowserQueueKeyEventFields(
    int type,
    unsigned int window,
    unsigned int keycode,
    unsigned int keySym,
    unsigned int state,
    int x,
    int y,
    unsigned int time)
{
    XEvent event;
    Window target;
    int rootX = x;
    int rootY = y;
    unsigned int resolvedKeycode;
    KeySym resolvedKeySym = (KeySym)keySym;

    if ((type != KeyPress) && (type != KeyRelease)) {
	return 0;
    }
    resolvedKeycode = BrowserNormalizeKeycode(keycode, resolvedKeySym);
    target = BrowserResolveKeyEventWindow((Window)window);
    BrowserWindowCoordinatesFromRoot(target, rootX, rootY, &x, &y);

    BrowserSetCommonEventFields(&event, type, target, (Time)time);
    event.xkey.root = browserDisplay.rootWindow;
    event.xkey.subwindow = None;
    event.xkey.time = eventTime;
    event.xkey.x = x;
    event.xkey.y = y;
    event.xkey.x_root = rootX;
    event.xkey.y_root = rootY;
    event.xkey.state = state;
    event.xkey.keycode = resolvedKeycode;
    event.xkey.same_screen = True;
    return BrowserQueueEvent(&event);
}

EMSCRIPTEN_KEEPALIVE int
TkBrowserQueueKeyEvent(
    int type,
    unsigned int window,
    unsigned int keySym,
    unsigned int state,
    unsigned int time)
{
    return TkBrowserQueueKeyEventFields(type, window,
	    BrowserKeycodeFromKeySym((KeySym)keySym), keySym, state,
	    browserDisplay.pointerX, browserDisplay.pointerY, time);
}

EMSCRIPTEN_KEEPALIVE int
TkBrowserQueueTextEvent(
    unsigned int window,
    unsigned int codepoint,
    unsigned int state,
    unsigned int time)
{
    KeySym keySym = BrowserKeySymFromCodepoint(codepoint);

    if (keySym == NoSymbol) {
	return 0;
    }
    return TkBrowserQueueKeyEventFields(KeyPress, window,
	    BrowserKeycodeFromKeySym(keySym), (unsigned int)keySym, state,
	    browserDisplay.pointerX, browserDisplay.pointerY, time);
}

EMSCRIPTEN_KEEPALIVE int
TkBrowserQueueCompositionEvent(
    int phase,
    unsigned int window,
    const char *utf8,
    int utf8Length)
{
    const char *eventName = BrowserCompositionEventName(phase);
    Tk_Window tkwin = BrowserResolveTkEventWindow((Window)window);
    Tcl_Obj *detailObj;

    if ((eventName == NULL) || (tkwin == NULL)) {
	return 0;
    }
    if (utf8 == NULL) {
	utf8 = "";
	utf8Length = 0;
    } else if (utf8Length < 0) {
	utf8Length = (int)strlen(utf8);
    }
    detailObj = Tcl_NewStringObj(utf8, utf8Length);
    return BrowserQueueVirtualEvent(tkwin, eventName, detailObj);
}

EMSCRIPTEN_KEEPALIVE int
TkBrowserQueuePointerEvent(
    int type,
    unsigned int window,
    unsigned int button,
    unsigned int state,
    int x,
    int y,
    unsigned int time)
{
    XEvent event;
    Window target;
    int rootX = x;
    int rootY = y;

    if ((type != ButtonPress) && (type != ButtonRelease)
	    && (type != MotionNotify)) {
	return 0;
    }
    target = BrowserResolvePointerEventWindow((Window)window, &x, &y);
    BrowserUpdatePointerState(target, rootX, rootY, state);
    if (type == ButtonPress) {
	browserDisplay.pointerCaptureWindow = target;
    }

    BrowserSetCommonEventFields(&event, type, target, (Time)time);
    if (type == MotionNotify) {
	event.xmotion.root = browserDisplay.rootWindow;
	event.xmotion.subwindow = None;
	event.xmotion.time = eventTime;
	event.xmotion.x = x;
	event.xmotion.y = y;
	event.xmotion.x_root = rootX;
	event.xmotion.y_root = rootY;
	event.xmotion.state = state;
	event.xmotion.is_hint = NotifyNormal;
	event.xmotion.same_screen = True;
    } else {
	event.xbutton.root = browserDisplay.rootWindow;
	event.xbutton.subwindow = None;
	event.xbutton.time = eventTime;
	event.xbutton.x = x;
	event.xbutton.y = y;
	event.xbutton.x_root = rootX;
	event.xbutton.y_root = rootY;
	event.xbutton.state = state;
	event.xbutton.button = button;
	event.xbutton.same_screen = True;
    }
    if (type == ButtonRelease) {
	browserDisplay.pointerCaptureWindow = None;
    }
    return BrowserQueueEvent(&event);
}

EMSCRIPTEN_KEEPALIVE int
TkBrowserQueueCrossingEvent(
    int type,
    unsigned int window,
    unsigned int state,
    int x,
    int y,
    unsigned int time)
{
    XEvent event;
    Window target;
    Window nextTarget;
    int rootX = x;
    int rootY = y;

    if ((type != EnterNotify) && (type != LeaveNotify)) {
	return 0;
    }
    (void)window;
    nextTarget = BrowserHitTestRoot(rootX, rootY, NULL, NULL);
    if (nextTarget == browserDisplay.pointerWindow) {
	BrowserUpdatePointerState(nextTarget, rootX, rootY, state);
	return 0;
    }
    if (type == LeaveNotify) {
	if (!BrowserWindowCanReceiveEvents(browserDisplay.pointerWindow)) {
	    BrowserUpdatePointerState(nextTarget, rootX, rootY, state);
	    return 0;
	}
	target = browserDisplay.pointerWindow;
	BrowserWindowCoordinatesFromRoot(target, rootX, rootY, &x, &y);
    } else {
	if (!BrowserWindowCanReceiveEvents(nextTarget)) {
	    BrowserUpdatePointerState(nextTarget, rootX, rootY, state);
	    return 0;
	}
	target = nextTarget;
	BrowserWindowCoordinatesFromRoot(target, rootX, rootY, &x, &y);
    }
    BrowserUpdatePointerState(nextTarget, rootX, rootY, state);

    BrowserSetCommonEventFields(&event, type, target, (Time)time);
    event.xcrossing.root = browserDisplay.rootWindow;
    event.xcrossing.subwindow = None;
    event.xcrossing.time = eventTime;
    event.xcrossing.x = x;
    event.xcrossing.y = y;
    event.xcrossing.x_root = rootX;
    event.xcrossing.y_root = rootY;
    event.xcrossing.mode = NotifyNormal;
    event.xcrossing.detail = NotifyNonlinear;
    event.xcrossing.same_screen = True;
    event.xcrossing.focus = (browserDisplay.focusWindow != None);
    event.xcrossing.state = state;
    return BrowserQueueEvent(&event);
}

EMSCRIPTEN_KEEPALIVE int
TkBrowserQueueFocusEvent(
    int type,
    unsigned int window,
    unsigned int time)
{
    XEvent event;
    Window target;
    Window eventTarget;
    Tk_Window tkwin;

    if ((type != FocusIn) && (type != FocusOut)) {
	return 0;
    }
    target = BrowserWindowCanReceiveEvents((Window)window)
	    ? (Window)window : BrowserResolveEventWindow((Window)window);
    if (!BrowserWindowCanReceiveEvents((Window)window)
	    && BrowserWindowCanReceiveEvents(browserDisplay.pointerWindow)) {
	target = browserDisplay.pointerWindow;
    }
    eventTarget = target;
    tkwin = Tk_IdToWindow(&browserDisplay.display, target);
    if (type == FocusIn) {
	browserDisplay.focusWindow = target;
	if (tkwin != NULL) {
	    TkSetFocusWin((TkWindow *)tkwin, 1);
	    return 1;
	}
    } else {
	TkWindow *winPtr = (TkWindow *)tkwin;

	while ((winPtr != NULL) && !(winPtr->flags & TK_TOP_HIERARCHY)) {
	    winPtr = winPtr->parentPtr;
	}
	if (winPtr != NULL) {
	    TkWindow *wrapperPtr = TkpGetWrapperWindow(winPtr);

	    if ((wrapperPtr != NULL) && (wrapperPtr->window != None)) {
		eventTarget = wrapperPtr->window;
	    }
	}
	if ((browserDisplay.focusWindow == target)
		|| (browserDisplay.focusWindow == eventTarget)) {
	    browserDisplay.focusWindow = None;
	}
    }

    BrowserSetCommonEventFields(&event, type, eventTarget, (Time)time);
    event.xfocus.serial = ++LastKnownRequestProcessed(&browserDisplay.display);
    event.xfocus.mode = NotifyNormal;
    event.xfocus.detail = NotifyNonlinear;
    return BrowserQueueEvent(&event);
}

EMSCRIPTEN_KEEPALIVE int
TkBrowserQueueWheelEvent(
    unsigned int window,
    int delta,
    unsigned int state,
    int x,
    int y,
    unsigned int time)
{
    XEvent event;
    Window target;
    int rootX = x;
    int rootY = y;

    if (delta == 0) {
	return 0;
    }
    target = BrowserResolvePointerEventWindow((Window)window, &x, &y);
    BrowserUpdatePointerState(target, rootX, rootY, state);

    BrowserSetCommonEventFields(&event, MouseWheelEvent, target, (Time)time);
    event.xbutton.root = browserDisplay.rootWindow;
    event.xbutton.subwindow = None;
    event.xbutton.time = eventTime;
    event.xbutton.x = x;
    event.xbutton.y = y;
    event.xbutton.x_root = rootX;
    event.xbutton.y_root = rootY;
    event.xbutton.state = state;
    event.xbutton.button = (unsigned int)delta;
    event.xbutton.same_screen = True;
    return BrowserQueueEventInternal(&event, 1);
}

int
TkBrowserServiceEvents(void)
{
    int count = 0;
    union {
	int type;
	XEvent x;
	TkKeyEvent k;
    } event;
    int internal;

    BrowserInitDisplay();
    while (eventQueueCount > 0) {
	(void)BrowserPopEvent(&event.x, &internal);
	if (!internal && (event.type >= VirtualEvent)
		&& (event.type <= MouseWheelEvent)) {
	    continue;
	}
	if ((event.type == KeyPress) || (event.type == KeyRelease)) {
	    event.k.charValuePtr = NULL;
	    event.k.charValueLen = 0;
	    event.k.keysym = NoSymbol;
	}
	Tk_QueueWindowEvent(&event.x, TCL_QUEUE_TAIL);
	count++;
    }
    return count;
}

Display *
TkBrowserGetDisplay(
    const char *displayName)
{
    (void)displayName;
    BrowserInitDisplay();
    return &browserDisplay.display;
}

XID
TkBrowserAllocXId(
    Display *display)
{
    (void)display;
    BrowserInitDisplay();
    return browserDisplay.nextXId++;
}

TkBrowserResource *
TkBrowserFindResource(
    XID id)
{
    TkBrowserResource *resourcePtr;

    BrowserInitDisplay();
    for (resourcePtr = browserDisplay.resourceList; resourcePtr != NULL;
	    resourcePtr = resourcePtr->nextPtr) {
	if (resourcePtr->id == id) {
	    return resourcePtr;
	}
    }
    return NULL;
}

TkBrowserResource *
TkBrowserCreateResource(
    Display *display,
    TkBrowserResourceType type)
{
    TkBrowserResource *resourcePtr;

    BrowserInitDisplay();
    if (display == NULL) {
	display = &browserDisplay.display;
    }
    resourcePtr = (TkBrowserResource *)ckalloc(sizeof(TkBrowserResource));
    memset(resourcePtr, 0, sizeof(TkBrowserResource));
    resourcePtr->id = TkBrowserAllocXId(display);
    resourcePtr->type = type;
    resourcePtr->display = display;
    resourcePtr->width = 1;
    resourcePtr->height = 1;
    resourcePtr->depth = 24;
    resourcePtr->atts.colormap = browserDisplay.defaultColormap;
    resourcePtr->nextPtr = browserDisplay.resourceList;
    browserDisplay.resourceList = resourcePtr;
    return resourcePtr;
}

void
TkBrowserDeleteResource(
    XID id)
{
    TkBrowserResource **linkPtr;

    BrowserInitDisplay();
    linkPtr = &browserDisplay.resourceList;
    while (*linkPtr != NULL) {
	TkBrowserResource *resourcePtr = *linkPtr;

	if (resourcePtr->id == id) {
	    if (resourcePtr == &browserDisplay.rootResource) {
		return;
	    }
	    while (resourcePtr->firstChildPtr != NULL) {
		TkBrowserResource *childPtr = resourcePtr->firstChildPtr;

		BrowserUnlinkChild(childPtr);
		childPtr->parent = None;
	    }
	    BrowserUnlinkChild(resourcePtr);
	    if (browserDisplay.focusWindow == (Window)id) {
		browserDisplay.focusWindow = None;
	    }
	    if (browserDisplay.pointerWindow == (Window)id) {
		browserDisplay.pointerWindow = browserDisplay.rootWindow;
	    }
	    if (browserDisplay.pointerCaptureWindow == (Window)id) {
		browserDisplay.pointerCaptureWindow = None;
	    }
	    if (browserDisplay.pointerGrabWindow == (Window)id) {
		browserDisplay.pointerGrabWindow = None;
	    }
	    *linkPtr = resourcePtr->nextPtr;
	    ckfree(resourcePtr);
	    return;
	}
	linkPtr = &resourcePtr->nextPtr;
    }
}

void
Tk_FreeXId(
    Display *display,
    XID xid)
{
    (void)display;
    (void)TkBrowserJsDestroyResource(BrowserJsXId(xid));
    TkBrowserDeleteResource(xid);
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
    obj.bytes = (char *) string;
    obj.length = strlen(string);
    obj.typePtr = NULL;

    code = Tcl_GetLongFromObj(interp, &obj, (long *)idPtr);
    if (obj.refCount > 1) {
	Tcl_Panic("invalid sharing of Tcl_Obj on C stack");
    }
    if (obj.typePtr && obj.typePtr->freeIntRepProc) {
	obj.typePtr->freeIntRepProc(&obj);
    }
    return code;
}

Display *
XOpenDisplay(
    _Xconst char *displayName)
{
    return TkBrowserGetDisplay(displayName);
}

int
XCloseDisplay(
    Display *display)
{
    (void)display;
    return Success;
}

Window
XCreateWindow(
    Display *display,
    Window parent,
    int x,
    int y,
    unsigned int width,
    unsigned int height,
    unsigned int borderWidth,
    int depth,
    unsigned int clazz,
    Visual *visual,
    unsigned long valueMask,
    XSetWindowAttributes *attributes)
{
    TkBrowserResource *resourcePtr;

    (void)clazz;
    (void)visual;
    if (display == NULL) {
	display = TkBrowserGetDisplay(NULL);
    }
    resourcePtr = TkBrowserCreateResource(display, TK_BROWSER_RESOURCE_WINDOW);
    resourcePtr->parent = parent;
    resourcePtr->x = x;
    resourcePtr->y = y;
    resourcePtr->width = width;
    resourcePtr->height = height;
    resourcePtr->borderWidth = borderWidth;
    resourcePtr->depth = (unsigned int)((depth == CopyFromParent)
	    ? DefaultDepth(display, DefaultScreen(display)) : depth);
    BrowserApplyWindowAttributes(resourcePtr, valueMask, attributes);
    BrowserLinkChildAtTop(resourcePtr, parent);
    (void)TkBrowserJsCreateWindow(BrowserJsXId(resourcePtr->id),
	    BrowserJsXId(parent), x, y, width, height, resourcePtr->depth,
	    resourcePtr->atts.event_mask);
    return (Window)resourcePtr->id;
}

int
XDestroyWindow(
    Display *display,
    Window window)
{
    (void)display;
    (void)TkBrowserJsDestroyResource(BrowserJsXId(window));
    TkBrowserDeleteResource(window);
    return Success;
}

int
XMapWindow(
    Display *display,
    Window window)
{
    TkBrowserResource *resourcePtr = TkBrowserFindResource(window);
    XEvent event;
    (void)display;
    if (resourcePtr != NULL) {
	resourcePtr->mapped = 1;
	(void)TkBrowserJsMapWindow(BrowserJsXId(window));
	BrowserSetCommonEventFields(&event, MapNotify, window, CurrentTime);
	event.xmap.event = window;
	event.xmap.window = window;
	event.xmap.override_redirect = resourcePtr->atts.override_redirect;
	(void)BrowserQueueEvent(&event);
	(void)BrowserQueueExpose(resourcePtr, 0, 0, resourcePtr->width,
		resourcePtr->height);
    }
    return Success;
}

int
XUnmapWindow(
    Display *display,
    Window window)
{
    TkBrowserResource *resourcePtr = TkBrowserFindResource(window);
    XEvent event;
    (void)display;
    if (resourcePtr != NULL) {
	resourcePtr->mapped = 0;
	(void)TkBrowserJsUnmapWindow(BrowserJsXId(window));
	BrowserSetCommonEventFields(&event, UnmapNotify, window, CurrentTime);
	event.xunmap.event = window;
	event.xunmap.window = window;
	event.xunmap.from_configure = False;
	(void)BrowserQueueEvent(&event);
    }
    return Success;
}

int
XMoveWindow(
    Display *display,
    Window window,
    int x,
    int y)
{
    XWindowChanges changes;
    changes.x = x;
    changes.y = y;
    return XConfigureWindow(display, window, CWX | CWY, &changes);
}

int
XResizeWindow(
    Display *display,
    Window window,
    unsigned int width,
    unsigned int height)
{
    XWindowChanges changes;
    changes.width = (int)width;
    changes.height = (int)height;
    return XConfigureWindow(display, window, CWWidth | CWHeight, &changes);
}

int
XMoveResizeWindow(
    Display *display,
    Window window,
    int x,
    int y,
    unsigned int width,
    unsigned int height)
{
    XWindowChanges changes;
    changes.x = x;
    changes.y = y;
    changes.width = (int)width;
    changes.height = (int)height;
    return XConfigureWindow(display, window, CWX | CWY | CWWidth | CWHeight,
	    &changes);
}

int
XConfigureWindow(
    Display *display,
    Window window,
    unsigned int valueMask,
    XWindowChanges *changes)
{
    TkBrowserResource *resourcePtr = TkBrowserFindResource(window);
    int sizeChanged;
    Display *eventDisplay;
    TkWindow *winPtr;
    (void)display;

    if ((resourcePtr == NULL) || (changes == NULL)) {
	return Success;
    }
    sizeChanged = ((valueMask & CWWidth)
	    && (resourcePtr->width != (unsigned int)changes->width))
	    || ((valueMask & CWHeight)
	    && (resourcePtr->height != (unsigned int)changes->height));
    if (valueMask & CWX) resourcePtr->x = changes->x;
    if (valueMask & CWY) resourcePtr->y = changes->y;
    if (valueMask & CWWidth) resourcePtr->width = (unsigned int)changes->width;
    if (valueMask & CWHeight) resourcePtr->height = (unsigned int)changes->height;
    if (valueMask & CWBorderWidth) {
	resourcePtr->borderWidth = (unsigned int)changes->border_width;
    }
    if (valueMask & (CWSibling | CWStackMode)) {
	BrowserRestackWindow(resourcePtr, valueMask, changes);
    }
    (void)TkBrowserJsConfigureWindow(BrowserJsXId(window), resourcePtr->x,
	    resourcePtr->y, resourcePtr->width, resourcePtr->height,
	    resourcePtr->borderWidth, valueMask);
    eventDisplay = resourcePtr->display;
    if (eventDisplay == NULL) {
	eventDisplay = TkBrowserGetDisplay(NULL);
    }
    winPtr = (TkWindow *)Tk_IdToWindow(eventDisplay, window);
    if ((winPtr == NULL) || (winPtr->flags & TK_WRAPPER)) {
	(void)BrowserQueueConfigureNotify(resourcePtr);
    }
    if (sizeChanged) {
	(void)BrowserQueueExpose(resourcePtr, 0, 0, resourcePtr->width,
		resourcePtr->height);
    }
    return Success;
}

Status
XReconfigureWMWindow(
    Display *display,
    Window window,
    int screen,
    unsigned int valueMask,
    XWindowChanges *changes)
{
    (void)screen;
    return XConfigureWindow(display, window, valueMask, changes);
}

int
XGetWindowAttributes(
    Display *display,
    Window window,
    XWindowAttributes *attributes)
{
    TkBrowserResource *resourcePtr = TkBrowserFindResource(window);

    if (attributes == NULL) {
	return False;
    }
    memset(attributes, 0, sizeof(XWindowAttributes));
    if (display == NULL) {
	display = TkBrowserGetDisplay(NULL);
    }
    if (resourcePtr == NULL) {
	resourcePtr = &browserDisplay.rootResource;
    }
    attributes->x = resourcePtr->x;
    attributes->y = resourcePtr->y;
    attributes->width = (int)resourcePtr->width;
    attributes->height = (int)resourcePtr->height;
    attributes->border_width = (int)resourcePtr->borderWidth;
    attributes->depth = (int)resourcePtr->depth;
    attributes->visual = DefaultVisual(display, DefaultScreen(display));
    attributes->root = RootWindow(display, DefaultScreen(display));
    attributes->c_class = InputOutput;
    attributes->colormap = DefaultColormap(display, DefaultScreen(display));
    attributes->map_installed = True;
    attributes->map_state = BrowserResourceIsVisible(resourcePtr) ? IsViewable
	    : (resourcePtr->mapped ? IsUnviewable : IsUnmapped);
    attributes->all_event_masks = resourcePtr->atts.event_mask;
    attributes->your_event_mask = resourcePtr->atts.event_mask;
    attributes->screen = DefaultScreenOfDisplay(display);
    return True;
}

Status
XGetGeometry(
    Display *display,
    Drawable drawable,
    Window *rootReturn,
    int *xReturn,
    int *yReturn,
    unsigned int *widthReturn,
    unsigned int *heightReturn,
    unsigned int *borderWidthReturn,
    unsigned int *depthReturn)
{
    TkBrowserResource *resourcePtr = TkBrowserFindResource(drawable);

    if (display == NULL) {
	display = TkBrowserGetDisplay(NULL);
    }
    if (resourcePtr == NULL) {
	resourcePtr = &browserDisplay.rootResource;
    }
    if (rootReturn != NULL) *rootReturn = RootWindow(display, DefaultScreen(display));
    if (xReturn != NULL) *xReturn = resourcePtr->x;
    if (yReturn != NULL) *yReturn = resourcePtr->y;
    if (widthReturn != NULL) *widthReturn = resourcePtr->width;
    if (heightReturn != NULL) *heightReturn = resourcePtr->height;
    if (borderWidthReturn != NULL) *borderWidthReturn = resourcePtr->borderWidth;
    if (depthReturn != NULL) *depthReturn = resourcePtr->depth;
    return True;
}

Bool
XTranslateCoordinates(
    Display *display,
    Window source,
    Window destination,
    int sourceX,
    int sourceY,
    int *destXReturn,
    int *destYReturn,
    Window *childReturn)
{
    TkBrowserResource *resourcePtr;
    TkBrowserResource *childPtr = NULL;
    int destX = sourceX;
    int destY = sourceY;

    (void)display;
    BrowserTranslateWindowCoordinates(source, destination, sourceX, sourceY,
	    &destX, &destY);
    resourcePtr = BrowserWindowResource(destination);
    childPtr = BrowserFindTopVisibleChildAt(resourcePtr, destX, destY);
    if (destXReturn != NULL) *destXReturn = destX;
    if (destYReturn != NULL) *destYReturn = destY;
    if (childReturn != NULL) {
	*childReturn = (childPtr != NULL) ? (Window)childPtr->id : None;
    }
    return True;
}

Status
XQueryTree(
    Display *display,
    Window window,
    Window *rootReturn,
    Window *parentReturn,
    Window **childrenReturn,
    unsigned int *nchildrenReturn)
{
    TkBrowserResource *resourcePtr;
    TkBrowserResource *childPtr;
    Window *children = NULL;
    unsigned int count = 0;
    unsigned int index = 0;

    if (display == NULL) {
	display = TkBrowserGetDisplay(NULL);
    }
    resourcePtr = TkBrowserFindResource(window);
    if (resourcePtr == NULL) {
	if (childrenReturn != NULL) *childrenReturn = NULL;
	if (nchildrenReturn != NULL) *nchildrenReturn = 0;
	return False;
    }
    for (childPtr = resourcePtr->firstChildPtr; childPtr != NULL;
	    childPtr = childPtr->nextSiblingPtr) {
	if (childPtr->type == TK_BROWSER_RESOURCE_WINDOW) {
	    count++;
	}
    }
    if (count > 0) {
	children = (Window *)ckalloc(sizeof(Window) * count);
	for (childPtr = resourcePtr->firstChildPtr; childPtr != NULL;
		childPtr = childPtr->nextSiblingPtr) {
	    if (childPtr->type == TK_BROWSER_RESOURCE_WINDOW) {
		children[index++] = (Window)childPtr->id;
	    }
	}
    }
    if (rootReturn != NULL) *rootReturn = RootWindow(display, DefaultScreen(display));
    if (parentReturn != NULL) {
	*parentReturn = (window == RootWindow(display, DefaultScreen(display)))
		? None : resourcePtr->parent;
    }
    if (childrenReturn != NULL) {
	*childrenReturn = children;
    } else if (children != NULL) {
	ckfree(children);
    }
    if (nchildrenReturn != NULL) *nchildrenReturn = count;
    return True;
}

Window
XRootWindow(
    Display *display,
    int screen)
{
    if (display == NULL) {
	display = TkBrowserGetDisplay(NULL);
    }
    return RootWindow(display, screen);
}

Pixmap
XCreatePixmap(
    Display *display,
    Drawable drawable,
    unsigned int width,
    unsigned int height,
    unsigned int depth)
{
    TkBrowserResource *resourcePtr;

    (void)drawable;
    resourcePtr = TkBrowserCreateResource(display, TK_BROWSER_RESOURCE_PIXMAP);
    resourcePtr->width = width;
    resourcePtr->height = height;
    resourcePtr->depth = depth;
    (void)TkBrowserJsCreatePixmap(BrowserJsXId(resourcePtr->id),
	    BrowserJsXId(drawable), width, height, depth);
    return (Pixmap)resourcePtr->id;
}

int
XFreePixmap(
    Display *display,
    Pixmap pixmap)
{
    (void)display;
    (void)TkBrowserJsDestroyResource(BrowserJsXId(pixmap));
    TkBrowserDeleteResource(pixmap);
    return Success;
}

Colormap
XCreateColormap(
    Display *display,
    Window window,
    Visual *visual,
    int alloc)
{
    TkBrowserResource *resourcePtr;
    (void)window;
    (void)visual;
    (void)alloc;
    resourcePtr = TkBrowserCreateResource(display, TK_BROWSER_RESOURCE_COLORMAP);
    return (Colormap)resourcePtr->id;
}

int
XFreeColormap(
    Display *display,
    Colormap colormap)
{
    (void)display;
    TkBrowserDeleteResource(colormap);
    return Success;
}

GC
XCreateGC(
    Display *display,
    Drawable drawable,
    unsigned long valueMask,
    XGCValues *values)
{
    GC gc;
    (void)drawable;
    if (display == NULL) {
	display = TkBrowserGetDisplay(NULL);
    }
    gc = (GC)ckalloc(sizeof(XGCValues));
    BrowserInitGC(display, gc);
    BrowserApplyGCValues(gc, valueMask, values);
    return gc;
}

int
XFreeGC(
    Display *display,
    GC gc)
{
    (void)display;
    if (gc != NULL) {
	ckfree(gc);
    }
    return Success;
}

int
XChangeGC(
    Display *display,
    GC gc,
    unsigned long mask,
    XGCValues *values)
{
    (void)display;
    if (gc != NULL) {
	BrowserApplyGCValues(gc, mask, values);
    }
    return Success;
}

int
XCopyGC(
    Display *display,
    GC src,
    unsigned long valuemask,
    GC dest)
{
    (void)display;
    (void)valuemask;
    if ((src != NULL) && (dest != NULL)) {
	*dest = *src;
    }
    return Success;
}

int
XGetGCValues(
    Display *display,
    GC gc,
    unsigned long valuemask,
    XGCValues *valuesReturn)
{
    (void)display;
    (void)valuemask;
    if ((gc == NULL) || (valuesReturn == NULL)) {
	return False;
    }
    *valuesReturn = *gc;
    return True;
}

int XSetForeground(Display *display, GC gc, unsigned long foreground)
{ (void)display; if (gc) gc->foreground = foreground; return Success; }
int XSetBackground(Display *display, GC gc, unsigned long background)
{ (void)display; if (gc) gc->background = background; return Success; }
int XSetFont(Display *display, GC gc, Font font)
{ (void)display; if (gc) gc->font = font; return Success; }
int XSetFunction(Display *display, GC gc, int function)
{ (void)display; if (gc) gc->function = function; return Success; }
int XSetFillStyle(Display *display, GC gc, int fillStyle)
{ (void)display; if (gc) gc->fill_style = fillStyle; return Success; }
int XSetFillRule(Display *display, GC gc, int fillRule)
{ (void)display; if (gc) gc->fill_rule = fillRule; return Success; }
int XSetArcMode(Display *display, GC gc, int arcMode)
{ (void)display; if (gc) gc->arc_mode = arcMode; return Success; }
int XSetStipple(Display *display, GC gc, Pixmap stipple)
{ (void)display; if (gc) gc->stipple = stipple; return Success; }
int XSetClipMask(Display *display, GC gc, Pixmap pixmap)
{ (void)display; if (gc) gc->clip_mask = pixmap; return Success; }
int XSetClipOrigin(Display *display, GC gc, int x, int y)
{ (void)display; if (gc) { gc->clip_x_origin = x; gc->clip_y_origin = y; } return Success; }
int XSetTSOrigin(Display *display, GC gc, int x, int y)
{ (void)display; if (gc) { gc->ts_x_origin = x; gc->ts_y_origin = y; } return Success; }

int
XSetLineAttributes(
    Display *display,
    GC gc,
    unsigned int lineWidth,
    int lineStyle,
    int capStyle,
    int joinStyle)
{
    (void)display;
    if (gc != NULL) {
	gc->line_width = (int)lineWidth;
	gc->line_style = lineStyle;
	gc->cap_style = capStyle;
	gc->join_style = joinStyle;
    }
    return Success;
}

int
XSetDashes(
    Display *display,
    GC gc,
    int dashOffset,
    _Xconst char *dashList,
    int n)
{
    (void)display;
    if (gc != NULL) {
	gc->dash_offset = dashOffset;
	gc->dashes = ((dashList != NULL) && (n > 0)) ? dashList[0] : 4;
    }
    return Success;
}

int
XSetClipRectangles(
    Display *display,
    GC gc,
    int clipXOrigin,
    int clipYOrigin,
    XRectangle rectangles[],
    int n,
    int ordering)
{
    (void)rectangles;
    (void)n;
    (void)ordering;
    return XSetClipOrigin(display, gc, clipXOrigin, clipYOrigin);
}

int
XSetRegion(
    Display *display,
    GC gc,
    Region region)
{
    (void)display;
    (void)gc;
    (void)region;
    return Success;
}

Region
XCreateRegion(void)
{
    TkBrowserRegion *regionPtr = (TkBrowserRegion *)ckalloc(sizeof(TkBrowserRegion));
    memset(regionPtr, 0, sizeof(TkBrowserRegion));
    regionPtr->empty = 1;
    return (Region)regionPtr;
}

int
XDestroyRegion(
    Region region)
{
    if (region != NULL) {
	ckfree(region);
    }
    return Success;
}

Bool
XEmptyRegion(
    Region region)
{
    return (region == NULL) || ((TkBrowserRegion *)region)->empty;
}

int
XClipBox(
    Region region,
    XRectangle *rectReturn)
{
    if (rectReturn != NULL) {
	if (region == NULL) {
	    memset(rectReturn, 0, sizeof(XRectangle));
	} else {
	    *rectReturn = ((TkBrowserRegion *)region)->extents;
	}
    }
    return Success;
}

int
XRectInRegion(
    Region region,
    int x,
    int y,
    unsigned int width,
    unsigned int height)
{
    TkBrowserRegion *regionPtr = (TkBrowserRegion *)region;
    (void)x;
    (void)y;
    (void)width;
    (void)height;
    return ((regionPtr == NULL) || regionPtr->empty) ? RectangleOut : RectangleIn;
}

int
XOffsetRegion(
    Region region,
    int dx,
    int dy)
{
    TkBrowserRegion *regionPtr = (TkBrowserRegion *)region;
    if ((regionPtr != NULL) && !regionPtr->empty) {
	regionPtr->extents.x += (short)dx;
	regionPtr->extents.y += (short)dy;
    }
    return Success;
}

int
XUnionRectWithRegion(
    XRectangle *rectangle,
    Region source,
    Region dest)
{
    TkBrowserRegion *destPtr = (TkBrowserRegion *)dest;
    (void)source;
    if ((destPtr != NULL) && (rectangle != NULL)) {
	destPtr->empty = 0;
	destPtr->extents = *rectangle;
    }
    return Success;
}

int
XUnionRegion(
    Region sourceA,
    Region sourceB,
    Region dest)
{
    TkBrowserRegion *aPtr = (TkBrowserRegion *)sourceA;
    TkBrowserRegion *bPtr = (TkBrowserRegion *)sourceB;
    TkBrowserRegion *destPtr = (TkBrowserRegion *)dest;
    if (destPtr == NULL) {
	return Success;
    }
    if ((aPtr != NULL) && !aPtr->empty) {
	destPtr->empty = 0;
	destPtr->extents = aPtr->extents;
    } else if ((bPtr != NULL) && !bPtr->empty) {
	destPtr->empty = 0;
	destPtr->extents = bPtr->extents;
    } else {
	destPtr->empty = 1;
	memset(&destPtr->extents, 0, sizeof(destPtr->extents));
    }
    return Success;
}

int
XIntersectRegion(
    Region sourceA,
    Region sourceB,
    Region dest)
{
    TkBrowserRegion *aPtr = (TkBrowserRegion *)sourceA;
    TkBrowserRegion *bPtr = (TkBrowserRegion *)sourceB;
    TkBrowserRegion *destPtr = (TkBrowserRegion *)dest;
    if (destPtr == NULL) {
	return Success;
    }
    if ((aPtr == NULL) || aPtr->empty || (bPtr == NULL) || bPtr->empty) {
	destPtr->empty = 1;
	memset(&destPtr->extents, 0, sizeof(destPtr->extents));
    } else {
	*destPtr = *aPtr;
    }
    return Success;
}

int
XSubtractRegion(
    Region sourceA,
    Region sourceB,
    Region dest)
{
    (void)sourceB;
    return XUnionRegion(sourceA, NULL, dest);
}

XImage *
XCreateImage(
    Display *display,
    Visual *visual,
    unsigned int depth,
    int format,
    int offset,
    char *data,
    unsigned int width,
    unsigned int height,
    int bitmapPad,
    int bytesPerLine)
{
    XImage *imagePtr;
    int bitsPerPixel;

    (void)display;
    (void)visual;
    imagePtr = (XImage *)ckalloc(sizeof(XImage));
    memset(imagePtr, 0, sizeof(XImage));
    bitsPerPixel = (depth <= 1) ? 1 : ((depth <= 8) ? 8 : ((depth <= 16) ? 16 : 32));
    imagePtr->width = (int)width;
    imagePtr->height = (int)height;
    imagePtr->xoffset = offset;
    imagePtr->format = format;
    imagePtr->data = data;
    imagePtr->byte_order = LSBFirst;
    imagePtr->bitmap_unit = 32;
    imagePtr->bitmap_bit_order = LSBFirst;
    imagePtr->bitmap_pad = (bitmapPad != 0) ? bitmapPad : 32;
    imagePtr->depth = (int)depth;
    imagePtr->bits_per_pixel = bitsPerPixel;
    imagePtr->bytes_per_line = (bytesPerLine != 0) ? bytesPerLine
	    : (int)(((width * (unsigned int)bitsPerPixel) + 7U) / 8U);
    imagePtr->red_mask = 0xff0000;
    imagePtr->green_mask = 0x00ff00;
    imagePtr->blue_mask = 0x0000ff;
    BrowserInitImageFuncs(imagePtr);
    return imagePtr;
}

int
_XInitImageFuncPtrs(
    XImage *image)
{
    if (image != NULL) {
	BrowserInitImageFuncs(image);
    }
    return Success;
}

XImage *
XGetImage(
    Display *display,
    Drawable drawable,
    int x,
    int y,
    unsigned int width,
    unsigned int height,
    unsigned long planeMask,
    int format)
{
    XImage *imagePtr;
    (void)drawable;
    (void)x;
    (void)y;
    (void)planeMask;
    imagePtr = XCreateImage(display, DefaultVisual(display, DefaultScreen(display)),
	    32, format, 0, NULL, width, height, 32, 0);
    if (imagePtr != NULL) {
	imagePtr->data = (char *)ckalloc(imagePtr->bytes_per_line * height);
	memset(imagePtr->data, 0, imagePtr->bytes_per_line * height);
	imagePtr->obdata = (XPointer)imagePtr;
    }
    return imagePtr;
}

int
XPutImage(
    Display *display,
    Drawable drawable,
    GC gc,
    XImage *image,
    int srcX,
    int srcY,
    int destX,
    int destY,
    unsigned int width,
    unsigned int height)
{
    TkBrowserResource *resourcePtr = TkBrowserFindResource(drawable);
    (void)gc;
    (void)display;
    (void)TkBrowserJsPutImage(BrowserJsXId(drawable),
	    (image != NULL) ? image->data : NULL, BrowserImageDataLength(image),
	    srcX, srcY, destX, destY, width, height,
	    (image != NULL) ? image->bytes_per_line : 0,
	    (image != NULL) ? image->bits_per_pixel : 0);
    BrowserMarkResourceDamage(resourcePtr, destX, destY, width, height);
    return Success;
}

Pixmap
XCreateBitmapFromData(
    Display *display,
    Drawable drawable,
    _Xconst char *data,
    unsigned int width,
    unsigned int height)
{
    (void)data;
    return XCreatePixmap(display, drawable, width, height, 1);
}

#define TK_BROWSER_DRAW_STUB(name, args, names) \
int name args { (void)names; return Success; }

int XCopyArea(Display *d, Drawable s, Drawable t, GC g, int sx, int sy,
	unsigned int w, unsigned int h, int dx, int dy)
{
    TkBrowserResource *targetPtr = TkBrowserFindResource(t);
    (void)d;
    (void)g;
    (void)TkBrowserJsCopyArea(BrowserJsXId(s), BrowserJsXId(t), sx, sy, w, h,
	    dx, dy);
    BrowserMarkResourceDamage(targetPtr, dx, dy, w, h);
    return Success;
}
int XCopyPlane(Display *d, Drawable s, Drawable t, GC g, int sx, int sy,
	unsigned int w, unsigned int h, int dx, int dy, unsigned long p)
{
    (void)p;
    return XCopyArea(d, s, t, g, sx, sy, w, h, dx, dy);
}
int XDrawArc(Display *d, Drawable dr, GC g, int x, int y, unsigned int w,
	unsigned int h, int a1, int a2)
{ (void)d; (void)dr; (void)g; (void)x; (void)y; (void)w; (void)h; (void)a1; (void)a2; return Success; }
int XDrawArcs(Display *d, Drawable dr, GC g, XArc *a, int n)
{ (void)d; (void)dr; (void)g; (void)a; (void)n; return Success; }
int XDrawLine(Display *d, Drawable dr, GC g, int x1, int y1, int x2, int y2)
{
    TkBrowserResource *resourcePtr = TkBrowserFindResource(dr);
    int x = (x1 < x2) ? x1 : x2;
    int y = (y1 < y2) ? y1 : y2;
    unsigned int width = (unsigned int)(((x1 > x2) ? x1 - x2 : x2 - x1) + 1);
    unsigned int height = (unsigned int)(((y1 > y2) ? y1 - y2 : y2 - y1) + 1);
    (void)d;
    (void)TkBrowserJsDrawLine(BrowserJsXId(dr), BrowserGCPixel(g), x1, y1,
	    x2, y2);
    BrowserMarkResourceDamage(resourcePtr, x, y, width, height);
    return Success;
}
int XDrawLines(Display *d, Drawable dr, GC g, XPoint *p, int n, int m)
{
    int i;
    int x;
    int y;

    (void)d;
    if ((p == NULL) || (n <= 1)) {
	return Success;
    }
    x = p[0].x;
    y = p[0].y;
    for (i = 1; i < n; i++) {
	int nextX = p[i].x;
	int nextY = p[i].y;

	if (m == CoordModePrevious) {
	    nextX += x;
	    nextY += y;
	}
	(void)XDrawLine(d, dr, g, x, y, nextX, nextY);
	x = nextX;
	y = nextY;
    }
    return Success;
}
int XDrawPoint(Display *d, Drawable dr, GC g, int x, int y)
{
    return XFillRectangle(d, dr, g, x, y, 1, 1);
}
int XDrawPoints(Display *d, Drawable dr, GC g, XPoint *p, int n, int m)
{ (void)d; (void)dr; (void)g; (void)p; (void)n; (void)m; return Success; }
int XDrawRectangle(Display *d, Drawable dr, GC g, int x, int y,
	unsigned int w, unsigned int h)
{
    TkBrowserResource *resourcePtr = TkBrowserFindResource(dr);
    (void)d;
    (void)TkBrowserJsDrawRectangle(BrowserJsXId(dr), BrowserGCPixel(g), x, y,
	    w, h, 0);
    BrowserMarkResourceDamage(resourcePtr, x, y, w + 1, h + 1);
    return Success;
}
int XDrawRectangles(Display *d, Drawable dr, GC g, XRectangle *r, int n)
{
    int i;
    (void)d;
    for (i = 0; (r != NULL) && (i < n); i++) {
	(void)XDrawRectangle(d, dr, g, r[i].x, r[i].y, r[i].width,
		r[i].height);
    }
    return Success;
}
int XDrawSegments(Display *d, Drawable dr, GC g, XSegment *s, int n)
{
    int i;
    (void)d;
    for (i = 0; (s != NULL) && (i < n); i++) {
	(void)XDrawLine(d, dr, g, s[i].x1, s[i].y1, s[i].x2, s[i].y2);
    }
    return Success;
}
int XFillArc(Display *d, Drawable dr, GC g, int x, int y, unsigned int w,
	unsigned int h, int a1, int a2)
{ (void)d; (void)dr; (void)g; (void)x; (void)y; (void)w; (void)h; (void)a1; (void)a2; return Success; }
int XFillArcs(Display *d, Drawable dr, GC g, XArc *a, int n)
{ (void)d; (void)dr; (void)g; (void)a; (void)n; return Success; }
int XFillPolygon(Display *d, Drawable dr, GC g, XPoint *p, int n, int shape,
	int mode)
{ (void)d; (void)dr; (void)g; (void)p; (void)n; (void)shape; (void)mode; return Success; }
int XFillRectangle(Display *d, Drawable dr, GC g, int x, int y,
	unsigned int w, unsigned int h)
{
    TkBrowserResource *resourcePtr = TkBrowserFindResource(dr);
    (void)d;
    (void)TkBrowserJsDrawRectangle(BrowserJsXId(dr), BrowserGCPixel(g), x, y,
	    w, h, 1);
    BrowserMarkResourceDamage(resourcePtr, x, y, w, h);
    return Success;
}
int XFillRectangles(Display *d, Drawable dr, GC g, XRectangle *r, int n)
{
    int i;
    (void)d;
    for (i = 0; (r != NULL) && (i < n); i++) {
	(void)XFillRectangle(d, dr, g, r[i].x, r[i].y, r[i].width,
		r[i].height);
    }
    return Success;
}

Status
XAllocColor(
    Display *display,
    Colormap colormap,
    XColor *color)
{
    (void)display;
    (void)colormap;
    if (color != NULL) {
	color->flags = DoRed | DoGreen | DoBlue;
	color->pixel = ((unsigned long)(color->red >> 8) << 16)
		| ((unsigned long)(color->green >> 8) << 8)
		| (unsigned long)(color->blue >> 8);
    }
    return True;
}

Status
XAllocNamedColor(
    Display *display,
    Colormap colormap,
    _Xconst char *name,
    XColor *screenDefReturn,
    XColor *exactDefReturn)
{
    XColor color;
    (void)display;
    (void)colormap;
    if (!BrowserParseColor(name, &color)) {
	return False;
    }
    if (screenDefReturn != NULL) *screenDefReturn = color;
    if (exactDefReturn != NULL) *exactDefReturn = color;
    return True;
}

Status
XLookupColor(
    Display *display,
    Colormap colormap,
    _Xconst char *name,
    XColor *exactDefReturn,
    XColor *screenDefReturn)
{
    return XAllocNamedColor(display, colormap, name, screenDefReturn,
	    exactDefReturn);
}

Status
XParseColor(
    Display *display,
    Colormap colormap,
    _Xconst char *spec,
    XColor *color)
{
    (void)display;
    (void)colormap;
    return BrowserParseColor(spec, color) ? True : False;
}

int
XQueryColor(
    Display *display,
    Colormap colormap,
    XColor *color)
{
    (void)display;
    (void)colormap;
    if (color != NULL) {
	color->red = (unsigned short)(((color->pixel >> 16) & 0xff) * 257U);
	color->green = (unsigned short)(((color->pixel >> 8) & 0xff) * 257U);
	color->blue = (unsigned short)((color->pixel & 0xff) * 257U);
	color->flags = DoRed | DoGreen | DoBlue;
    }
    return Success;
}

int
XQueryColors(
    Display *display,
    Colormap colormap,
    XColor *defs,
    int ncolors)
{
    int i;
    for (i = 0; i < ncolors; i++) {
	XQueryColor(display, colormap, &defs[i]);
    }
    return Success;
}

XVisualInfo *
XGetVisualInfo(
    Display *display,
    long mask,
    XVisualInfo *templatePtr,
    int *nitemsReturn)
{
    XVisualInfo *infoPtr;

    (void)mask;
    (void)templatePtr;
    if (display == NULL) {
	display = TkBrowserGetDisplay(NULL);
    }
    infoPtr = (XVisualInfo *)ckalloc(sizeof(XVisualInfo));
    memset(infoPtr, 0, sizeof(XVisualInfo));
    infoPtr->visual = DefaultVisual(display, DefaultScreen(display));
    infoPtr->visualid = infoPtr->visual->visualid;
    infoPtr->screen = DefaultScreen(display);
    infoPtr->depth = DefaultDepth(display, DefaultScreen(display));
    infoPtr->c_class = infoPtr->visual->c_class;
    infoPtr->red_mask = infoPtr->visual->red_mask;
    infoPtr->green_mask = infoPtr->visual->green_mask;
    infoPtr->blue_mask = infoPtr->visual->blue_mask;
    infoPtr->colormap_size = infoPtr->visual->map_entries;
    infoPtr->bits_per_rgb = infoPtr->visual->bits_per_rgb;
    if (nitemsReturn != NULL) {
	*nitemsReturn = 1;
    }
    return infoPtr;
}

VisualID
XVisualIDFromVisual(
    Visual *visual)
{
    return (visual != NULL) ? visual->visualid : 0;
}

Atom
XInternAtom(
    Display *display,
    _Xconst char *name,
    Bool onlyIfExists)
{
    TkBrowserAtomName *atomPtr;
    Atom predefined;
    (void)display;

    if (name == NULL) {
	return None;
    }
    predefined = BrowserPredefinedAtom(name);
    if (predefined != None) {
	return predefined;
    }
    for (atomPtr = atomList; atomPtr != NULL; atomPtr = atomPtr->nextPtr) {
	if (strcmp(atomPtr->name, name) == 0) {
	    return atomPtr->atom;
	}
    }
    if (onlyIfExists) {
	return None;
    }
    atomPtr = (TkBrowserAtomName *)ckalloc(sizeof(TkBrowserAtomName));
    atomPtr->atom = ++nextAtom;
    atomPtr->name = BrowserDupString(name);
    atomPtr->nextPtr = atomList;
    atomList = atomPtr;
    return atomPtr->atom;
}

char *
XGetAtomName(
    Display *display,
    Atom atom)
{
    TkBrowserAtomName *atomPtr;
    const char *predefined;
    (void)display;

    predefined = BrowserPredefinedAtomName(atom);
    if (predefined != NULL) {
	return BrowserDupString(predefined);
    }
    for (atomPtr = atomList; atomPtr != NULL; atomPtr = atomPtr->nextPtr) {
	if (atomPtr->atom == atom) {
	    return BrowserDupString(atomPtr->name);
	}
    }
    return BrowserDupString("");
}

Font
XLoadFont(
    Display *display,
    _Xconst char *name)
{
    TkBrowserResource *resourcePtr;
    (void)name;
    resourcePtr = TkBrowserCreateResource(display, TK_BROWSER_RESOURCE_FONT);
    return (Font)resourcePtr->id;
}

XFontStruct *
XLoadQueryFont(
    Display *display,
    _Xconst char *name)
{
    XFontStruct *fontPtr = (XFontStruct *)ckalloc(sizeof(XFontStruct));
    (void)name;
    memset(fontPtr, 0, sizeof(XFontStruct));
    fontPtr->fid = XLoadFont(display, name);
    fontPtr->direction = FontLeftToRight;
    fontPtr->min_char_or_byte2 = 0;
    fontPtr->max_char_or_byte2 = 255;
    fontPtr->all_chars_exist = True;
    fontPtr->default_char = '?';
    fontPtr->min_bounds.width = 8;
    fontPtr->max_bounds.width = 8;
    fontPtr->min_bounds.ascent = 11;
    fontPtr->max_bounds.ascent = 11;
    fontPtr->min_bounds.descent = 3;
    fontPtr->max_bounds.descent = 3;
    fontPtr->ascent = 11;
    fontPtr->descent = 3;
    return fontPtr;
}

int
XFreeFont(
    Display *display,
    XFontStruct *font)
{
    if (font != NULL) {
	TkBrowserDeleteResource(font->fid);
	ckfree(font);
    }
    (void)display;
    return Success;
}

char **
XListFonts(
    Display *display,
    _Xconst char *pattern,
    int maxnames,
    int *actualCountReturn)
{
    char **names;
    (void)display;
    if (actualCountReturn != NULL) {
	*actualCountReturn = (maxnames > 0) ? 1 : 0;
    }
    if (maxnames <= 0) {
	return NULL;
    }
    names = (char **)ckalloc(sizeof(char *));
    names[0] = BrowserDupString((pattern != NULL) ? pattern : "fixed");
    return names;
}

int
XFreeFontNames(
    char **list)
{
    if (list != NULL) {
	if (list[0] != NULL) {
	    ckfree(list[0]);
	}
	ckfree(list);
    }
    return Success;
}

Bool
XGetFontProperty(
    XFontStruct *font,
    Atom atom,
    unsigned long *valueReturn)
{
    if ((font == NULL) || (valueReturn == NULL)) {
	return False;
    }
    if (atom == XA_UNDERLINE_POSITION) {
	*valueReturn = 1;
	return True;
    }
    if (atom == XA_UNDERLINE_THICKNESS) {
	*valueReturn = 1;
	return True;
    }
    if ((atom == XA_FONT) || (atom == XA_FONT_NAME)) {
	*valueReturn = font->fid;
	return True;
    }
    return False;
}

int XTextWidth(XFontStruct *font, _Xconst char *string, int count)
{ (void)font; return ((string == NULL) || (count <= 0)) ? 0 : count * 8; }
int XTextWidth16(XFontStruct *font, _Xconst XChar2b *string, int count)
{ (void)font; (void)string; return (count <= 0) ? 0 : count * 8; }
static int
BrowserDrawUtf8Text(
    Drawable drawable,
    GC gc,
    int x,
    int y,
    const char *utf8,
    int length)
{
    TkBrowserResource *resourcePtr = TkBrowserFindResource(drawable);
    int width;

    if ((utf8 == NULL) || (length <= 0)) {
	return Success;
    }
    width = XTextWidth(NULL, utf8, length);
    (void)TkBrowserJsDrawText(BrowserJsXId(drawable), BrowserGCPixel(gc), x,
	    y, utf8, length);
    BrowserMarkResourceDamage(resourcePtr, x, y - 12,
	    (unsigned int)(width + 2), 16);
    return Success;
}

int
XDrawString(
    Display *d,
    Drawable dr,
    GC gc,
    int x,
    int y,
    _Xconst char *string,
    int length)
{
    char *copy;
    int result;

    (void)d;
    if ((string == NULL) || (length <= 0)) {
	return Success;
    }
    copy = (char *)ckalloc((unsigned int)length + 1U);
    memcpy(copy, string, (size_t)length);
    copy[length] = '\0';
    result = BrowserDrawUtf8Text(dr, gc, x, y, copy, length);
    ckfree(copy);
    return result;
}

int
XDrawString16(
    Display *d,
    Drawable dr,
    GC gc,
    int x,
    int y,
    _Xconst XChar2b *string,
    int length)
{
    char *utf8;
    int out = 0;
    int i;
    int result;

    (void)d;
    if ((string == NULL) || (length <= 0)) {
	return Success;
    }
    utf8 = (char *)ckalloc((unsigned int)(length * 4 + 1));
    for (i = 0; i < length; i++) {
	unsigned int codepoint = ((unsigned int)string[i].byte1 << 8)
		| (unsigned int)string[i].byte2;
	int written = BrowserUtf8FromCodepoint(codepoint, utf8 + out,
		length * 4 - out);

	if (written <= 0) {
	    continue;
	}
	out += written;
    }
    utf8[out] = '\0';
    result = BrowserDrawUtf8Text(dr, gc, x, y, utf8, out);
    ckfree(utf8);
    return result;
}

Cursor
XCreatePixmapCursor(
    Display *display,
    Pixmap source,
    Pixmap mask,
    XColor *foreground,
    XColor *background,
    unsigned int x,
    unsigned int y)
{
    TkBrowserResource *resourcePtr;
    (void)source; (void)mask; (void)foreground; (void)background; (void)x; (void)y;
    resourcePtr = TkBrowserCreateResource(display, TK_BROWSER_RESOURCE_CURSOR);
    return (Cursor)resourcePtr->id;
}

Cursor
XCreateGlyphCursor(
    Display *display,
    Font sourceFont,
    Font maskFont,
    unsigned int sourceChar,
    unsigned int maskChar,
    XColor _Xconst *foreground,
    XColor _Xconst *background)
{
    (void)sourceFont; (void)maskFont; (void)sourceChar; (void)maskChar;
    return XCreatePixmapCursor(display, None, None, (XColor *)foreground,
	    (XColor *)background, 0, 0);
}

int XDefineCursor(Display *display, Window window, Cursor cursor)
{ (void)display; (void)window; (void)cursor; return Success; }
int XFreeCursor(Display *display, Cursor cursor)
{ (void)display; TkBrowserDeleteResource(cursor); return Success; }

KeySym
XStringToKeysym(
    _Xconst char *name)
{
    size_t i;

    if ((name == NULL) || (name[0] == '\0')) {
	return NoSymbol;
    }
    if (name[1] == '\0') {
	return (KeySym)(unsigned char)name[0];
    }
    if ((name[0] == 'F') && (name[1] >= '1') && (name[1] <= '9')) {
	int number = 0;
	const char *p;

	for (p = name + 1; *p != '\0'; p++) {
	    if ((*p < '0') || (*p > '9')) {
		number = 0;
		break;
	    }
	    number = number * 10 + (*p - '0');
	}
	if ((number >= 1) && (number <= 35)) {
	    return XK_F1 + (KeySym)(number - 1);
	}
    }
    if ((strncmp(name, "KP_", 3) == 0) && (name[3] >= '0')
	    && (name[3] <= '9') && (name[4] == '\0')) {
	return XK_KP_0 + (KeySym)(name[3] - '0');
    }
    for (i = 0; i < sizeof(browserKeySymNames) / sizeof(browserKeySymNames[0]);
	    i++) {
	if (strcmp(name, browserKeySymNames[i].name) == 0) {
	    return browserKeySymNames[i].keySym;
	}
    }
    return NoSymbol;
}

char *
XKeysymToString(
    KeySym keySym)
{
    static char buffer[8];
    size_t i;

    if ((keySym >= XK_F1) && (keySym <= XK_F35)) {
	snprintf(buffer, sizeof(buffer), "F%lu",
		(unsigned long)(keySym - XK_F1 + 1));
	return buffer;
    }
    if ((keySym >= XK_KP_0) && (keySym <= XK_KP_9)) {
	snprintf(buffer, sizeof(buffer), "KP_%lu",
		(unsigned long)(keySym - XK_KP_0));
	return buffer;
    }
    for (i = 0; i < sizeof(browserKeySymNames) / sizeof(browserKeySymNames[0]);
	    i++) {
	if (keySym == browserKeySymNames[i].keySym) {
	    return (char *)browserKeySymNames[i].name;
	}
    }
    if ((keySym >= 0x21) && (keySym <= 0x7e)) {
	buffer[0] = (char)keySym;
	buffer[1] = '\0';
	return buffer;
    }
    return NULL;
}

KeyCode XKeysymToKeycode(Display *display, KeySym keySym)
{ (void)display; return (KeyCode)BrowserKeycodeFromKeySym(keySym); }
KeySym XKeycodeToKeysym(Display *display, unsigned int keycode, int index)
{ (void)display; (void)index; return BrowserKeySymForKeycode(keycode); }
KeySym XLookupKeysym(XKeyEvent *event, int index)
{ (void)index; return (event != NULL) ? BrowserKeySymForKeycode(event->keycode) : NoSymbol; }
int XLookupString(XKeyEvent *event, char *buffer, int bytes, KeySym *keySym,
	XComposeStatus *status)
{
    KeySym sym = XLookupKeysym(event, 0);
    unsigned int codepoint;
    int length;

    (void)status;
    if (keySym != NULL) *keySym = sym;
    if (((unsigned int)sym & 0xff000000U) == TK_BROWSER_UNICODE_KEYSYM_BASE) {
	codepoint = ((unsigned int)sym & 0x00ffffffU);
	length = BrowserUtf8FromCodepoint(codepoint, buffer, bytes);
	return length;
    }
    if ((buffer != NULL) && (bytes > 0) && (sym >= 0x20) && (sym <= 0x7e)) {
	buffer[0] = (char)sym;
	return 1;
    }
    return 0;
}

int
XmbLookupString(
    XIC inputContext,
    XKeyPressedEvent *event,
    char *buffer,
    int bytes,
    KeySym *keySym,
    Status *status)
{
    (void)inputContext;
    if (status != NULL) {
	*status = XLookupNone;
    }
    return XLookupString(event, buffer, bytes, keySym, NULL);
}

int
Xutf8LookupString(
    XIC inputContext,
    XKeyPressedEvent *event,
    char *buffer,
    int bytes,
    KeySym *keySym,
    Status *status)
{
    return XmbLookupString(inputContext, event, buffer, bytes, keySym, status);
}

XIM
XOpenIM(
    Display *display,
    XPointer rdb,
    char *resourceName,
    char *resourceClass)
{
    (void)display;
    (void)rdb;
    (void)resourceName;
    (void)resourceClass;
    return NULL;
}

Status
XCloseIM(
    XIM inputMethod)
{
    (void)inputMethod;
    return True;
}

char *
XSetLocaleModifiers(
    _Xconst char *modifierList)
{
    (void)modifierList;
    return NULL;
}

Bool
XRegisterIMInstantiateCallback(
    Display *display,
    struct _XrmHashBucketRec *rdb,
    char *resourceName,
    char *resourceClass,
    XIDProc callback,
    XPointer clientData)
{
    (void)display;
    (void)rdb;
    (void)resourceName;
    (void)resourceClass;
    (void)callback;
    (void)clientData;
    return False;
}

Bool
XUnregisterIMInstantiateCallback(
    Display *display,
    struct _XrmHashBucketRec *rdb,
    char *resourceName,
    char *resourceClass,
    XIDProc callback,
    XPointer clientData)
{
    (void)display;
    (void)rdb;
    (void)resourceName;
    (void)resourceClass;
    (void)callback;
    (void)clientData;
    return False;
}

XIC
XCreateIC(
    XIM inputMethod,
    ...)
{
    (void)inputMethod;
    return NULL;
}

void
XDestroyIC(
    XIC inputContext)
{
    (void)inputContext;
}

char *
XGetICValues(
    XIC inputContext,
    ...)
{
    (void)inputContext;
    return NULL;
}

char *
XSetICValues(
    XIC inputContext,
    ...)
{
    (void)inputContext;
    return NULL;
}

void
XSetICFocus(
    XIC inputContext)
{
    (void)inputContext;
}

void
XUnsetICFocus(
    XIC inputContext)
{
    (void)inputContext;
}

char *
XGetIMValues(
    XIM inputMethod,
    ...)
{
    (void)inputMethod;
    return (char *)"browser input methods are not backed by XIM";
}

char *
XSetIMValues(
    XIM inputMethod,
    ...)
{
    (void)inputMethod;
    return NULL;
}

XVaNestedList
XVaCreateNestedList(
    int unused,
    ...)
{
    (void)unused;
    return NULL;
}

XFontSet
XCreateFontSet(
    Display *display,
    _Xconst char *baseFontNameList,
    char ***missingCharsetListReturn,
    int *missingCharsetCountReturn,
    char **defStringReturn)
{
    (void)display;
    (void)baseFontNameList;
    if (missingCharsetListReturn != NULL) {
	*missingCharsetListReturn = NULL;
    }
    if (missingCharsetCountReturn != NULL) {
	*missingCharsetCountReturn = 0;
    }
    if (defStringReturn != NULL) {
	*defStringReturn = NULL;
    }
    return NULL;
}

void
XFreeFontSet(
    Display *display,
    XFontSet fontSet)
{
    (void)display;
    (void)fontSet;
}

void
XFreeStringList(
    char **list)
{
    (void)XFreeFontNames(list);
}

XModifierKeymap *
XGetModifierMapping(
    Display *display)
{
    XModifierKeymap *mapPtr = (XModifierKeymap *)ckalloc(sizeof(XModifierKeymap));
    (void)display;
    mapPtr->max_keypermod = 1;
    mapPtr->modifiermap = (KeyCode *)ckalloc(sizeof(KeyCode) * 8);
    memset(mapPtr->modifiermap, 0, sizeof(KeyCode) * 8);
    return mapPtr;
}

int
XFreeModifiermap(
    XModifierKeymap *mapPtr)
{
    if (mapPtr != NULL) {
	if (mapPtr->modifiermap != NULL) {
	    ckfree(mapPtr->modifiermap);
	}
	ckfree(mapPtr);
    }
    return Success;
}

int XDisplayKeycodes(Display *display, int *minReturn, int *maxReturn)
{ if (minReturn) *minReturn = 8; if (maxReturn) *maxReturn = 255; (void)display; return Success; }
int XRefreshKeyboardMapping(XMappingEvent *event)
{ (void)event; return Success; }

int
XEventsQueued(
    Display *display,
    int mode)
{
    (void)display;
    (void)mode;
    BrowserUpdateQueueLength();
    return eventQueueCount;
}

int
XNextEvent(
    Display *display,
    XEvent *event)
{
    (void)display;
    (void)BrowserPopEvent(event, NULL);
    return Success;
}

int
XPutBackEvent(
    Display *display,
    XEvent *event)
{
    (void)display;
    BrowserInitDisplay();
    if ((event == NULL) || (eventQueueCount >= TK_BROWSER_EVENT_QUEUE_LIMIT)) {
	return Success;
    }
    eventQueueHead = (eventQueueHead + TK_BROWSER_EVENT_QUEUE_LIMIT - 1)
	    % TK_BROWSER_EVENT_QUEUE_LIMIT;
    eventQueue[eventQueueHead].event = *event;
    eventQueue[eventQueueHead].internal = 0;
    eventQueueCount++;
    BrowserUpdateQueueLength();
    return Success;
}

int
XWindowEvent(
    Display *display,
    Window window,
    long mask,
    XEvent *event)
{
    (void)display;
    (void)window;
    (void)mask;
    return XNextEvent(display, event);
}

Status
XSendEvent(
    Display *display,
    Window window,
    Bool propagate,
    long mask,
    XEvent *event)
{
    XEvent copy;

    (void)display;
    (void)propagate;
    (void)mask;
    if (event == NULL) {
	return False;
    }
    copy = *event;
    copy.xany.window = BrowserResolveEventWindow(window);
    copy.xany.display = &browserDisplay.display;
    return BrowserQueueEvent(&copy) ? True : False;
}
Bool XFilterEvent(XEvent *event, Window window)
{ (void)event; (void)window; return False; }

Bool
XQueryPointer(
    Display *display,
    Window window,
    Window *rootReturn,
    Window *childReturn,
    int *rootXReturn,
    int *rootYReturn,
    int *winXReturn,
    int *winYReturn,
    unsigned int *maskReturn)
{
    TkBrowserResource *resourcePtr;
    TkBrowserResource *childPtr = NULL;
    int winX = browserDisplay.pointerX;
    int winY = browserDisplay.pointerY;

    if (display == NULL) display = TkBrowserGetDisplay(NULL);
    resourcePtr = BrowserWindowResource(window);
    if (resourcePtr != NULL) {
	BrowserWindowCoordinatesFromRoot(window, browserDisplay.pointerX,
		browserDisplay.pointerY, &winX, &winY);
	childPtr = BrowserFindTopVisibleChildAt(resourcePtr, winX, winY);
    }
    if (rootReturn) *rootReturn = RootWindow(display, DefaultScreen(display));
    if (childReturn) {
	*childReturn = (childPtr != NULL) ? (Window)childPtr->id : None;
    }
    if (rootXReturn) *rootXReturn = browserDisplay.pointerX;
    if (rootYReturn) *rootYReturn = browserDisplay.pointerY;
    if (winXReturn) *winXReturn = winX;
    if (winYReturn) *winYReturn = winY;
    if (maskReturn) *maskReturn = browserDisplay.pointerState;
    return True;
}

int
XGetInputFocus(
    Display *display,
    Window *focusReturn,
    int *revertReturn)
{
    if (display == NULL) {
	display = TkBrowserGetDisplay(NULL);
    }
    if (focusReturn) {
	*focusReturn = (browserDisplay.focusWindow != None)
		? browserDisplay.focusWindow
		: RootWindow(display, DefaultScreen(display));
    }
    if (revertReturn) *revertReturn = RevertToParent;
    return Success;
}

int
XSetInputFocus(
    Display *display,
    Window focus,
    int revertTo,
    Time time)
{
    (void)display;
    (void)revertTo;
    (void)time;
    browserDisplay.focusWindow = BrowserResolveEventWindow(focus);
    return Success;
}
int XGrabKeyboard(Display *display, Window window, Bool ownerEvents, int pointerMode, int keyboardMode, Time time)
{ (void)display; (void)window; (void)ownerEvents; (void)pointerMode; (void)keyboardMode; (void)time; return GrabSuccess; }
int
XGrabPointer(
    Display *display,
    Window grabWindow,
    Bool ownerEvents,
    unsigned int eventMask,
    int pointerMode,
    int keyboardMode,
    Window confineTo,
    Cursor cursor,
    Time time)
{
    (void)display;
    (void)pointerMode;
    (void)keyboardMode;
    (void)confineTo;
    (void)cursor;
    (void)time;
    browserDisplay.pointerGrabWindow = BrowserResolveEventWindow(grabWindow);
    browserDisplay.pointerGrabOwnerEvents = ownerEvents ? 1 : 0;
    browserDisplay.pointerGrabEventMask = eventMask;
    return GrabSuccess;
}
int XUngrabKeyboard(Display *display, Time time)
{ (void)display; (void)time; return Success; }
int
XUngrabPointer(
    Display *display,
    Time time)
{
    (void)display;
    (void)time;
    browserDisplay.pointerGrabWindow = None;
    browserDisplay.pointerGrabOwnerEvents = 0;
    browserDisplay.pointerGrabEventMask = 0;
    return Success;
}
int XWarpPointer(Display *display, Window src, Window dest, int srcX, int srcY, unsigned int srcW, unsigned int srcH, int destX, int destY)
{ (void)display; (void)src; (void)dest; (void)srcX; (void)srcY; (void)srcW; (void)srcH; (void)destX; (void)destY; return Success; }

int XBell(Display *display, int percent)
{ (void)display; (void)percent; return Success; }
int XFlush(Display *display)
{ (void)display; return TkBrowserJsFlush(); }
int XSync(Display *display, Bool discard)
{ (void)discard; return XFlush(display); }
int XNoOp(Display *display)
{
    if (display == NULL) {
	display = TkBrowserGetDisplay(NULL);
    }
    LastKnownRequestProcessed(display)++;
    return Success;
}
int XGrabServer(Display *display)
{ (void)display; return Success; }
int XUngrabServer(Display *display)
{ (void)display; return Success; }
int XForceScreenSaver(Display *display, int mode)
{ (void)display; (void)mode; return Success; }
int XResetScreenSaver(Display *display)
{ return XForceScreenSaver(display, ScreenSaverReset); }

XAfterFunction
XSynchronize(
    Display *display,
    Bool onoff)
{
    (void)display;
    (void)onoff;
    return NULL;
}

XErrorHandler
XSetErrorHandler(
    XErrorHandler handler)
{
    XErrorHandler oldHandler = errorHandler;
    errorHandler = handler;
    return oldHandler;
}

int
XFree(
    void *data)
{
    if (data != NULL) {
	ckfree(data);
    }
    return Success;
}

XClassHint *
XAllocClassHint(void)
{
    XClassHint *hintPtr = (XClassHint *)ckalloc(sizeof(XClassHint));
    memset(hintPtr, 0, sizeof(XClassHint));
    return hintPtr;
}

XSizeHints *
XAllocSizeHints(void)
{
    XSizeHints *hintPtr = (XSizeHints *)ckalloc(sizeof(XSizeHints));
    memset(hintPtr, 0, sizeof(XSizeHints));
    return hintPtr;
}

XWMHints *
XAllocWMHints(void)
{
    XWMHints *hintPtr = (XWMHints *)ckalloc(sizeof(XWMHints));
    memset(hintPtr, 0, sizeof(XWMHints));
    return hintPtr;
}

int XSetClassHint(Display *display, Window window, XClassHint *hints)
{ (void)display; (void)window; (void)hints; return Success; }
int XSetCommand(Display *display, Window window, char **argv, int argc)
{ (void)display; (void)window; (void)argv; (void)argc; return Success; }
int XSetIconName(Display *display, Window window, _Xconst char *name)
{ (void)display; (void)window; (void)name; return Success; }
int XStoreName(Display *display, Window window, _Xconst char *name)
{ (void)display; (void)window; (void)name; return Success; }
int XSetTransientForHint(Display *display, Window window, Window propWindow)
{ (void)display; (void)window; (void)propWindow; return Success; }
int XSetWMHints(Display *display, Window window, XWMHints *hints)
{ (void)display; (void)window; (void)hints; return Success; }
void XSetWMNormalHints(Display *display, Window window, XSizeHints *hints)
{ (void)display; (void)window; (void)hints; }
Status XGetWMColormapWindows(Display *display, Window window, Window **windows, int *count)
{ (void)display; (void)window; if (windows) *windows = NULL; if (count) *count = 0; return False; }
Status XSetWMColormapWindows(Display *display, Window window, Window *windows, int count)
{ (void)display; (void)window; (void)windows; (void)count; return True; }
void XSetWMClientMachine(Display *display, Window window, XTextProperty *textProp)
{ (void)display; (void)window; (void)textProp; }

Status
XStringListToTextProperty(
    char **list,
    int count,
    XTextProperty *textPropReturn)
{
    const char *value = ((list != NULL) && (count > 0) && (list[0] != NULL))
	    ? list[0] : "";
    size_t length = strlen(value);

    if (textPropReturn == NULL) {
	return False;
    }
    textPropReturn->value = (unsigned char *)ckalloc(length + 1);
    memcpy(textPropReturn->value, value, length + 1);
    textPropReturn->encoding = XA_STRING;
    textPropReturn->format = 8;
    textPropReturn->nitems = (unsigned long)length;
    return True;
}

int
XChangeProperty(
    Display *display,
    Window window,
    Atom property,
    Atom type,
    int format,
    int mode,
    _Xconst unsigned char *data,
    int nelements)
{
    (void)display; (void)window; (void)property; (void)type;
    (void)format; (void)mode; (void)data; (void)nelements;
    return Success;
}

int XDeleteProperty(Display *display, Window window, Atom property)
{ (void)display; (void)window; (void)property; return Success; }

int
XGetWindowProperty(
    Display *display,
    Window window,
    Atom property,
    long offset,
    long length,
    Bool deleteProperty,
    Atom reqType,
    Atom *actualTypeReturn,
    int *actualFormatReturn,
    unsigned long *nitemsReturn,
    unsigned long *bytesAfterReturn,
    unsigned char **propReturn)
{
    (void)display; (void)window; (void)property; (void)offset;
    (void)length; (void)deleteProperty; (void)reqType;
    if (actualTypeReturn) *actualTypeReturn = None;
    if (actualFormatReturn) *actualFormatReturn = 0;
    if (nitemsReturn) *nitemsReturn = 0;
    if (bytesAfterReturn) *bytesAfterReturn = 0;
    if (propReturn) {
	*propReturn = (unsigned char *)ckalloc(1);
	(*propReturn)[0] = '\0';
    }
    return Success;
}

int XConvertSelection(Display *display, Atom selection, Atom target, Atom property, Window requestor, Time time)
{ (void)display; (void)selection; (void)target; (void)property; (void)requestor; (void)time; return Success; }
int XSetSelectionOwner(Display *display, Atom selection, Window owner, Time time)
{ (void)display; (void)selection; (void)owner; (void)time; return Success; }

int XSetWindowBackground(Display *display, Window window, unsigned long pixel)
{ (void)display; (void)window; (void)pixel; return Success; }
int XSetWindowBackgroundPixmap(Display *display, Window window, Pixmap pixmap)
{ (void)display; (void)window; (void)pixmap; return Success; }
int XSetWindowBorder(Display *display, Window window, unsigned long pixel)
{ (void)display; (void)window; (void)pixel; return Success; }
int XSetWindowBorderPixmap(Display *display, Window window, Pixmap pixmap)
{ (void)display; (void)window; (void)pixmap; return Success; }
int XSetWindowBorderWidth(Display *display, Window window, unsigned int width)
{ (void)display; (void)window; (void)width; return Success; }
int XSetWindowColormap(Display *display, Window window, Colormap colormap)
{ (void)display; (void)window; (void)colormap; return Success; }
int XChangeWindowAttributes(Display *display, Window window, unsigned long mask, XSetWindowAttributes *atts)
{
    TkBrowserResource *r = TkBrowserFindResource(window);

    (void)display;
    BrowserApplyWindowAttributes(r, mask, atts);
    return Success;
}
int XSelectInput(Display *display, Window window, long mask)
{ TkBrowserResource *r = TkBrowserFindResource(window); (void)display; if (r) r->atts.event_mask = mask; return Success; }

int XRaiseWindow(Display *display, Window window)
{
    XWindowChanges changes;

    (void)display;
    changes.stack_mode = Above;
    BrowserRestackWindow(TkBrowserFindResource(window), CWStackMode, &changes);
    return Success;
}
int XLowerWindow(Display *display, Window window)
{
    XWindowChanges changes;

    (void)display;
    changes.stack_mode = Below;
    BrowserRestackWindow(TkBrowserFindResource(window), CWStackMode, &changes);
    return Success;
}
int
XReparentWindow(
    Display *display,
    Window window,
    Window parent,
    int x,
    int y)
{
    TkBrowserResource *resourcePtr = TkBrowserFindResource(window);
    XEvent event;

    (void)display;
    if (resourcePtr != NULL) {
	BrowserUnlinkChild(resourcePtr);
	resourcePtr->parent = parent;
	resourcePtr->x = x;
	resourcePtr->y = y;
	BrowserLinkChildAtTop(resourcePtr, parent);
	(void)TkBrowserJsReparentWindow(BrowserJsXId(window),
		BrowserJsXId(parent), x, y);
	BrowserSetCommonEventFields(&event, ReparentNotify, window,
		CurrentTime);
	event.xreparent.event = window;
	event.xreparent.window = window;
	event.xreparent.parent = parent;
	event.xreparent.x = x;
	event.xreparent.y = y;
	event.xreparent.override_redirect =
		resourcePtr->atts.override_redirect;
	(void)BrowserQueueEvent(&event);
    }
    return Success;
}
Status XIconifyWindow(Display *display, Window window, int screen)
{ (void)display; (void)window; (void)screen; return True; }
Status XWithdrawWindow(Display *display, Window window, int screen)
{ (void)display; (void)window; (void)screen; return True; }
int XClearWindow(Display *display, Window window)
{
    TkBrowserResource *resourcePtr = TkBrowserFindResource(window);

    (void)display;
    (void)TkBrowserJsClearWindow(BrowserJsXId(window));
    if (resourcePtr != NULL) {
	BrowserMarkResourceDamage(resourcePtr, 0, 0, resourcePtr->width,
		resourcePtr->height);
    }
    return Success;
}

XHostAddress *XListHosts(Display *display, int *nhosts, Bool *state)
{ (void)display; if (nhosts) *nhosts = 0; if (state) *state = False; return NULL; }
GContext XGContextFromGC(GC gc)
{ return (GContext)(uintptr_t)gc; }
int XFreeColors(Display *display, Colormap colormap, unsigned long *pixels, int npixels, unsigned long planes)
{ (void)display; (void)colormap; (void)pixels; (void)npixels; (void)planes; return Success; }
