/*
 * tkBrowserXlibDecls.h --
 *
 *	Function declarations for the Xlib-shaped ABI that generic Tk still
 *	uses while the browser backend replaces the Unix/X11 implementation.
 */

#ifndef _TK_BROWSER_XLIB_DECLS
#define _TK_BROWSER_XLIB_DECLS

#ifdef __cplusplus
extern "C" {
#endif

EXTERN int XSetDashes(Display *display, GC gc, int dash_offset,
	_Xconst char *dash_list, int n);
EXTERN XModifierKeymap *XGetModifierMapping(Display *d);
EXTERN XImage *XCreateImage(Display *d, Visual *v, unsigned int ui1,
	int i1, int i2, char *cp, unsigned int ui2, unsigned int ui3,
	int i3, int i4);
EXTERN XImage *XGetImage(Display *d, Drawable dr, int i1, int i2,
	unsigned int ui1, unsigned int ui2, unsigned long ul, int i3);
EXTERN char *XGetAtomName(Display *d, Atom a);
EXTERN char *XKeysymToString(KeySym k);
EXTERN Colormap XCreateColormap(Display *d, Window w, Visual *v, int i);
EXTERN Cursor XCreatePixmapCursor(Display *d, Pixmap p1, Pixmap p2,
	XColor *x1, XColor *x2, unsigned int ui1, unsigned int ui2);
EXTERN Cursor XCreateGlyphCursor(Display *d, Font f1, Font f2,
	unsigned int ui1, unsigned int ui2, XColor _Xconst *x1,
	XColor _Xconst *x2);
EXTERN GContext XGContextFromGC(GC g);
EXTERN XHostAddress *XListHosts(Display *d, int *i, Bool *b);
EXTERN KeySym XKeycodeToKeysym(Display *d, unsigned int k, int i);
EXTERN KeySym XStringToKeysym(_Xconst char *c);
EXTERN Window XRootWindow(Display *d, int i);
EXTERN XErrorHandler XSetErrorHandler(XErrorHandler x);
EXTERN Status XIconifyWindow(Display *d, Window w, int i);
EXTERN Status XWithdrawWindow(Display *d, Window w, int i);
EXTERN Status XGetWMColormapWindows(Display *d, Window w, Window **wpp,
	int *ip);
EXTERN Status XAllocColor(Display *d, Colormap c, XColor *xp);
EXTERN Status XAllocNamedColor(Display *d, Colormap c, _Xconst char *name,
	XColor *screen_def_return, XColor *exact_def_return);
EXTERN int XBell(Display *d, int i);
EXTERN int XChangeProperty(Display *d, Window w, Atom a1, Atom a2,
	int i1, int i2, _Xconst unsigned char *c, int i3);
EXTERN int XChangeWindowAttributes(Display *d, Window w, unsigned long ul,
	XSetWindowAttributes *x);
EXTERN int XClearWindow(Display *d, Window w);
EXTERN int XConfigureWindow(Display *d, Window w, unsigned int i,
	XWindowChanges *x);
EXTERN int XConvertSelection(Display *d, Atom selection, Atom target,
	Atom property, Window requestor, Time time);
EXTERN int XCopyArea(Display *d, Drawable dr1, Drawable dr2, GC g,
	int i1, int i2, unsigned int ui1, unsigned int ui2, int i3, int i4);
EXTERN int XCopyPlane(Display *d, Drawable dr1, Drawable dr2, GC g,
	int i1, int i2, unsigned int ui1, unsigned int ui2, int i3, int i4,
	unsigned long ul);
EXTERN int XCopyGC(Display *d, GC src, unsigned long valuemask, GC dest);
EXTERN Pixmap XCreateBitmapFromData(Display *display, Drawable d,
	_Xconst char *data, unsigned int width, unsigned int height);
EXTERN int XDefineCursor(Display *d, Window w, Cursor c);
EXTERN int XDeleteProperty(Display *d, Window w, Atom a);
EXTERN int XDestroyWindow(Display *d, Window w);
EXTERN int XDrawArc(Display *d, Drawable dr, GC g, int i1, int i2,
	unsigned int ui1, unsigned int ui2, int i3, int i4);
EXTERN int XDrawLines(Display *d, Drawable dr, GC g, XPoint *x, int i1,
	int i2);
EXTERN int XDrawRectangle(Display *d, Drawable dr, GC g, int i1, int i2,
	unsigned int ui1, unsigned int ui2);
EXTERN int XFillArc(Display *d, Drawable dr, GC g, int i1, int i2,
	unsigned int ui1, unsigned int ui2, int i3, int i4);
EXTERN int XFillPolygon(Display *d, Drawable dr, GC g, XPoint *x, int i1,
	int i2, int i3);
EXTERN int XFillRectangles(Display *d, Drawable dr, GC g, XRectangle *x,
	int i);
EXTERN int XForceScreenSaver(Display *d, int i);
EXTERN int XFreeColormap(Display *d, Colormap c);
EXTERN int XFreeColors(Display *d, Colormap c, unsigned long *ulp, int i,
	unsigned long ul);
EXTERN int XFreeCursor(Display *d, Cursor c);
EXTERN int XFreeFont(Display *d, XFontStruct *font_struct);
EXTERN int XFreeFontNames(char **list);
EXTERN int XFreeModifiermap(XModifierKeymap *x);
EXTERN int XFreePixmap(Display *d, Pixmap pixmap);
EXTERN Status XGetGeometry(Display *d, Drawable dr, Window *w, int *i1,
	int *i2, unsigned int *ui1, unsigned int *ui2, unsigned int *ui3,
	unsigned int *ui4);
EXTERN int XGetInputFocus(Display *d, Window *w, int *i);
EXTERN int XGetWindowProperty(Display *d, Window w, Atom a1, long l1,
	long l2, Bool b, Atom a2, Atom *ap, int *ip,
	unsigned long *ulp1, unsigned long *ulp2, unsigned char **cpp);
EXTERN Status XGetWindowAttributes(Display *d, Window w,
	XWindowAttributes *x);
EXTERN Bool XGetFontProperty(XFontStruct *font_struct, Atom atom,
	unsigned long *value_return);
EXTERN int XGetGCValues(Display *d, GC gc, unsigned long valuemask,
	XGCValues *values_return);
EXTERN int XGrabKeyboard(Display *d, Window w, Bool b, int i1, int i2,
	Time t);
EXTERN int XGrabPointer(Display *d, Window w1, Bool b, unsigned int ui,
	int i1, int i2, Window w2, Cursor c, Time t);
EXTERN KeyCode XKeysymToKeycode(Display *d, KeySym k);
EXTERN Status XLookupColor(Display *d, Colormap c1, _Xconst char *c2,
	XColor *x1, XColor *x2);
EXTERN KeySym XLookupKeysym(XKeyEvent *key_event, int index);
EXTERN int XLookupString(XKeyEvent *event_struct, char *buffer_return,
	int bytes_buffer, KeySym *keysym_return, XComposeStatus *status);
EXTERN int XMapWindow(Display *d, Window w);
EXTERN int XMoveResizeWindow(Display *d, Window w, int i1, int i2,
	unsigned int ui1, unsigned int ui2);
EXTERN int XMoveWindow(Display *d, Window w, int i1, int i2);
EXTERN int XNextEvent(Display *d, XEvent *x);
EXTERN int XPutBackEvent(Display *d, XEvent *x);
EXTERN int XQueryColors(Display *d, Colormap c, XColor *x, int i);
EXTERN int XQueryColor(Display *d, Colormap c, XColor *def_in_out);
EXTERN Bool XQueryPointer(Display *d, Window w1, Window *w2, Window *w3,
	int *i1, int *i2, int *i3, int *i4, unsigned int *ui);
EXTERN Status XQueryTree(Display *d, Window w1, Window *w2, Window *w3,
	Window **w4, unsigned int *ui);
EXTERN int XRaiseWindow(Display *d, Window w);
EXTERN int XRefreshKeyboardMapping(XMappingEvent *x);
EXTERN Status XReconfigureWMWindow(Display *d, Window w, int screen,
	unsigned int value_mask, XWindowChanges *values);
EXTERN int XResetScreenSaver(Display *d);
EXTERN int XResizeWindow(Display *d, Window w, unsigned int ui1,
	unsigned int ui2);
EXTERN int XSelectInput(Display *d, Window w, long l);
EXTERN Status XSendEvent(Display *d, Window w, Bool b, long l, XEvent *x);
EXTERN int XSetCommand(Display *d, Window w, char **c, int i);
EXTERN int XSetClassHint(Display *d, Window w, XClassHint *class_hints);
EXTERN int XSetIconName(Display *d, Window w, _Xconst char *c);
EXTERN int XSetInputFocus(Display *d, Window w, int i, Time t);
EXTERN int XSetSelectionOwner(Display *d, Atom a, Window w, Time t);
EXTERN int XSetTransientForHint(Display *d, Window w, Window prop_window);
EXTERN Status XSetWMColormapWindows(Display *d, Window w,
	Window *colormap_windows, int count);
EXTERN int XSetWindowBackground(Display *d, Window w, unsigned long ul);
EXTERN int XSetWindowBackgroundPixmap(Display *d, Window w, Pixmap p);
EXTERN int XSetWindowBorder(Display *d, Window w, unsigned long ul);
EXTERN int XSetWindowBorderPixmap(Display *d, Window w, Pixmap p);
EXTERN int XSetWindowBorderWidth(Display *d, Window w, unsigned int ui);
EXTERN int XSetWindowColormap(Display *d, Window w, Colormap c);
EXTERN int XStoreName(Display *d, Window w, _Xconst char *name);
EXTERN Bool XTranslateCoordinates(Display *d, Window w1, Window w2,
	int i1, int i2, int *i3, int *i4, Window *w3);
EXTERN int XUnloadFont(Display *d, Font font);
EXTERN int XUngrabKeyboard(Display *d, Time t);
EXTERN int XUngrabPointer(Display *d, Time t);
EXTERN int XUnmapWindow(Display *d, Window w);
EXTERN int XWindowEvent(Display *d, Window w, long l, XEvent *x);
EXTERN void XDestroyIC(XIC x);
EXTERN Bool XFilterEvent(XEvent *x, Window w);
EXTERN int XmbLookupString(XIC xi, XKeyPressedEvent *xk, char *c, int i,
	KeySym *k, Status *s);
EXTERN int Xutf8LookupString(XIC xi, XKeyPressedEvent *xk, char *c, int i,
	KeySym *k, Status *s);
EXTERN char *XGetICValues(XIC xi, ...);
EXTERN char *XSetICValues(XIC xi, ...);
EXTERN void XSetICFocus(XIC xi);
EXTERN void XUnsetICFocus(XIC xi);
EXTERN XIM XOpenIM(Display *display, XPointer rdb, char *resourceName,
	char *resourceClass);
EXTERN Status XCloseIM(XIM xim);
EXTERN char *XSetLocaleModifiers(_Xconst char *modifierList);
EXTERN Bool XRegisterIMInstantiateCallback(Display *display,
	struct _XrmHashBucketRec *rdb, char *resourceName, char *resourceClass,
	XIDProc callback, XPointer clientData);
EXTERN Bool XUnregisterIMInstantiateCallback(Display *display,
	struct _XrmHashBucketRec *rdb, char *resourceName, char *resourceClass,
	XIDProc callback, XPointer clientData);
EXTERN char *XGetIMValues(XIM xim, ...);
EXTERN char *XSetIMValues(XIM xim, ...);
EXTERN XVaNestedList XVaCreateNestedList(int unused, ...);
EXTERN XFontSet XCreateFontSet(Display *display, _Xconst char *baseFontNameList,
	char ***missingCharsetListReturn, int *missingCharsetCountReturn,
	char **defStringReturn);
EXTERN void XFreeFontSet(Display *display, XFontSet fontSet);
EXTERN void XFreeStringList(char **list);
EXTERN int TkPutImage(unsigned long *colors, int ncolors, Display *display,
	Drawable d, GC gc, XImage *image, int src_x, int src_y, int dest_x,
	int dest_y, unsigned int width, unsigned int height);
EXTERN int XSetClipRectangles(Display *display, GC gc, int clip_x_origin,
	int clip_y_origin, XRectangle rectangles[], int n, int ordering);
EXTERN Status XParseColor(Display *display, Colormap map, _Xconst char *spec,
	XColor *colorPtr);
EXTERN GC XCreateGC(Display *display, Drawable d, unsigned long valuemask,
	XGCValues *values);
EXTERN int XFreeGC(Display *display, GC gc);
EXTERN Atom XInternAtom(Display *display, _Xconst char *atom_name,
	Bool only_if_exists);
EXTERN int XSetBackground(Display *display, GC gc, unsigned long foreground);
EXTERN int XSetForeground(Display *display, GC gc, unsigned long foreground);
EXTERN int XSetClipMask(Display *display, GC gc, Pixmap pixmap);
EXTERN int XSetClipOrigin(Display *display, GC gc, int clip_x_origin,
	int clip_y_origin);
EXTERN int XSetTSOrigin(Display *display, GC gc, int ts_x_origin,
	int ts_y_origin);
EXTERN int XChangeGC(Display *d, GC gc, unsigned long mask,
	XGCValues *values);
EXTERN int XSetFont(Display *display, GC gc, Font font);
EXTERN int XSetArcMode(Display *display, GC gc, int arc_mode);
EXTERN int XSetStipple(Display *display, GC gc, Pixmap stipple);
EXTERN int XSetFillRule(Display *display, GC gc, int fill_rule);
EXTERN int XSetFillStyle(Display *display, GC gc, int fill_style);
EXTERN int XSetFunction(Display *display, GC gc, int function);
EXTERN int XSetLineAttributes(Display *display, GC gc,
	unsigned int line_width, int line_style, int cap_style, int join_style);
EXTERN int _XInitImageFuncPtrs(XImage *image);
EXTERN XIC XCreateIC(XIM xim, ...);
EXTERN XVisualInfo *XGetVisualInfo(Display *display, long vinfo_mask,
	XVisualInfo *vinfo_template, int *nitems_return);
EXTERN void XSetWMClientMachine(Display *display, Window w,
	XTextProperty *text_prop);
EXTERN Status XStringListToTextProperty(char **list, int count,
	XTextProperty *text_prop_return);
EXTERN int XDrawLine(Display *d, Drawable dr, GC g, int x1, int y1,
	int x2, int y2);
EXTERN int XWarpPointer(Display *d, Window s, Window dw, int sx, int sy,
	unsigned int sw, unsigned int sh, int dx, int dy);
EXTERN int XFillRectangle(Display *display, Drawable d, GC gc, int x, int y,
	unsigned int width, unsigned int height);
EXTERN int XFlush(Display *display);
EXTERN int XGrabServer(Display *display);
EXTERN int XUngrabServer(Display *display);
EXTERN int XFree(void *data);
EXTERN int XNoOp(Display *display);
EXTERN XAfterFunction XSynchronize(Display *display, Bool onoff);
EXTERN int XSync(Display *display, Bool discard);
EXTERN VisualID XVisualIDFromVisual(Visual *visual);
EXTERN int XOffsetRegion(Region rgn, int dx, int dy);
EXTERN int XUnionRegion(Region srca, Region srcb, Region dr_return);
EXTERN Window XCreateWindow(Display *display, Window parent, int x, int y,
	unsigned int width, unsigned int height, unsigned int border_width,
	int depth, unsigned int clazz, Visual *visual, unsigned long value_mask,
	XSetWindowAttributes *attributes);
EXTERN Pixmap XCreatePixmap(Display *display, Drawable d, unsigned int width,
	unsigned int height, unsigned int depth);
EXTERN int XLowerWindow(Display *d, Window w);
EXTERN int XFillArcs(Display *d, Drawable dr, GC gc, XArc *a, int n);
EXTERN int XDrawArcs(Display *d, Drawable dr, GC gc, XArc *a, int n);
EXTERN int XDrawRectangles(Display *d, Drawable dr, GC gc, XRectangle *r,
	int n);
EXTERN int XDrawSegments(Display *d, Drawable dr, GC gc, XSegment *s, int n);
EXTERN int XDrawPoint(Display *d, Drawable dr, GC gc, int x, int y);
EXTERN int XDrawPoints(Display *d, Drawable dr, GC gc, XPoint *p, int n,
	int m);
EXTERN int XReparentWindow(Display *d, Window w, Window p, int x, int y);
EXTERN int XPutImage(Display *d, Drawable dr, GC gc, XImage *im, int sx,
	int sy, int dx, int dy, unsigned int w, unsigned int h);

EXTERN Display *XOpenDisplay(_Xconst char *display_name);
EXTERN int XCloseDisplay(Display *display);
EXTERN int XEventsQueued(Display *display, int mode);
EXTERN int XDisplayKeycodes(Display *display, int *min_keycodes_return,
	int *max_keycodes_return);
EXTERN Font XLoadFont(Display *display, _Xconst char *name);
EXTERN XFontStruct *XLoadQueryFont(Display *display, _Xconst char *name);
EXTERN char **XListFonts(Display *display, _Xconst char *pattern,
	int maxnames, int *actual_count_return);
EXTERN int XTextWidth(XFontStruct *font_struct, _Xconst char *string,
	int count);
EXTERN int XTextWidth16(XFontStruct *font_struct, _Xconst XChar2b *string,
	int count);
EXTERN int XDrawString(Display *display, Drawable d, GC gc, int x, int y,
	_Xconst char *string, int length);
EXTERN int XDrawString16(Display *display, Drawable d, GC gc, int x, int y,
	_Xconst XChar2b *string, int length);

#ifdef __cplusplus
}
#endif

#endif /* _TK_BROWSER_XLIB_DECLS */
