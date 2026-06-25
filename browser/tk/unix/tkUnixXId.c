/*
 * tkUnixXId.c --
 *
 *	Tk's Unix Makefile still expects this translation unit. The browser
 *	Xlib compatibility implementation is built from third-party/x11.wasm as
 *	libx11wasm.a; this file intentionally keeps only the Tk-side bind slot.
 */

#include "tkUnixInt.h"
#include "tkSelect.h"
#include <X11Wasm/Runtime.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

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

static int
TkBrowserImageDataLength(
    XImage *imagePtr)
{
    if ((imagePtr == NULL) || (imagePtr->bytes_per_line <= 0)
	    || (imagePtr->height <= 0)) {
	return 0;
    }
    return imagePtr->bytes_per_line * imagePtr->height;
}

static XImage *
TkBrowserConvertPaletteImage(
    unsigned long *colors,
    int ncolors,
    Display *display,
    Drawable drawable,
    XImage *image,
    int srcX,
    int srcY,
    unsigned int width,
    unsigned int height)
{
    XImage *convertedImage;
    Window root;
    int x, y;
    unsigned int drawableWidth, drawableHeight, borderWidth, depth;
    int dataLength;
    unsigned int ix, iy;

    if ((colors == NULL) || (ncolors <= 0) || (display == NULL)
	    || (image == NULL) || (image->format == XYBitmap)
	    || (image->bits_per_pixel >= 16)) {
	return image;
    }
    if (XGetGeometry(display, drawable, &root, &x, &y, &drawableWidth,
	    &drawableHeight, &borderWidth, &depth) == 0) {
	return image;
    }
    convertedImage = XCreateImage(display, DefaultVisual(display,
	    DefaultScreen(display)), depth, ZPixmap, 0, NULL, width, height,
	    32, 0);
    if (convertedImage == NULL) {
	return NULL;
    }
    dataLength = TkBrowserImageDataLength(convertedImage);
    if (dataLength <= 0) {
	(void)XDestroyImage(convertedImage);
	return NULL;
    }
    convertedImage->data = (char *)ckalloc((unsigned int)dataLength);
    memset(convertedImage->data, 0, (unsigned int)dataLength);
    convertedImage->obdata = (XPointer)convertedImage;
    for (iy = 0; iy < height; iy++) {
	for (ix = 0; ix < width; ix++) {
	    unsigned long pixel = XGetPixel(image, srcX + (int)ix,
		    srcY + (int)iy);

	    if (pixel < (unsigned long)ncolors) {
		pixel = colors[pixel];
	    }
	    (void)XPutPixel(convertedImage, (int)ix, (int)iy, pixel);
	}
    }
    return convertedImage;
}

int
TkPutImage(
    unsigned long *colors,
    int ncolors,
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
    XImage *putImage = TkBrowserConvertPaletteImage(colors, ncolors, display,
	    drawable, image, srcX, srcY, width, height);
    int result;

    if (putImage == NULL) {
	return Success;
    }
    result = XPutImage(display, drawable, gc, putImage,
	    (putImage == image) ? srcX : 0, (putImage == image) ? srcY : 0,
	    destX, destY, width, height);
    if (putImage != image) {
	(void)XDestroyImage(putImage);
    }
    return result;
}

void
TkSetPixmapColormap(
    Pixmap pixmap,
    Colormap colormap)
{
    X11WasmSetPixmapColormap(pixmap, colormap);
}

Pixmap
TkpCreateNativeBitmap(
    Display *display,
    const void *source)
{
    return X11WasmCreateNativeBitmap(display, source);
}

Pixmap
TkpGetNativeAppBitmap(
    Display *display,
    const char *name,
    int *width,
    int *height)
{
    return X11WasmGetNativeAppBitmap(display, name, width, height);
}

EMSCRIPTEN_KEEPALIVE int
TkBrowserTestPutImagePalette(void)
{
    Display *display = XOpenDisplay(NULL);
    Pixmap pixmap = None;
    GC gc = NULL;
    XImage *image = NULL;
    XImage *readback = NULL;
    unsigned char imageData[4];
    unsigned long colors[3] = {
	0xff0000UL, 0x00ff00UL, 0x0000ffUL
    };
    int result = 0;

    if (display == NULL) {
	return 0;
    }
    memset(imageData, 0, sizeof(imageData));
    imageData[0] = 0;
    imageData[1] = 1;
    imageData[2] = 2;
    pixmap = XCreatePixmap(display,
	    RootWindow(display, DefaultScreen(display)), 3, 1,
	    (unsigned int)DefaultDepth(display, DefaultScreen(display)));
    gc = (pixmap != None) ? XCreateGC(display, pixmap, 0, NULL) : NULL;
    image = XCreateImage(display, DefaultVisual(display, DefaultScreen(display)),
	    8, ZPixmap, 0, (char *)imageData, 3, 1, 32, 0);
    if ((pixmap == None) || (gc == NULL) || (image == NULL)
	    || (TkPutImage(colors, 3, display, pixmap, gc, image, 0, 0, 0, 0,
		    3, 1) != Success)) {
	goto cleanup;
    }
    readback = XGetImage(display, pixmap, 0, 0, 3, 1, AllPlanes, ZPixmap);
    if ((readback == NULL)
	    || (XGetPixel(readback, 0, 0) != colors[0])
	    || (XGetPixel(readback, 1, 0) != colors[1])
	    || (XGetPixel(readback, 2, 0) != colors[2])) {
	goto cleanup;
    }
    result = 1;

cleanup:
    if (readback != NULL) {
	(void)XDestroyImage(readback);
    }
    if (image != NULL) {
	(void)XDestroyImage(image);
    }
    if (gc != NULL) {
	(void)XFreeGC(display, gc);
    }
    if (pixmap != None) {
	(void)XFreePixmap(display, pixmap);
    }
    return result;
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
