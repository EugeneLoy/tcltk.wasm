/* Browser text layout, included after UnixFont in tkUnixFont.c. */

static void BrowserDrawAngledChars(Display *, Drawable, GC, Tk_Font,
    const char *, int, int, int, double, double, double);

static int
BrowserFontNextChar(const char *source, const char *end, int *chPtr)
{
    char buffer[10] = {0};
    int available = (int)(end - source);
    int copied = (available < 6) ? available : 6;
    int consumed;

    memcpy(buffer, source, (size_t)copied);
    consumed = TkUtfToUniChar(buffer, chPtr);
    return (consumed < available) ? consumed : available;
}

static int
BrowserFontMeasure(UnixFont *fontPtr, const char *source, int numBytes,
    int rangeStart, int rangeLength, int maxLength, int flags, int *lengthPtr)
{
    const char *start, *end, *p, *next, *term;
    int *widths;
    int curX, newX, termX, ch, sawNonSpace, base, result;
    int layoutBytes = numBytes;

    *lengthPtr = 0;
    if ((rangeStart < 0) || (rangeLength < 0) || (rangeStart > numBytes)
	    || (rangeLength > numBytes - rangeStart)) {
	return 0;
    }
    if (rangeLength == 0) {
	return 0;
    }
    if ((maxLength >= 0) && (flags & TK_ISOLATE_END)) {
	layoutBytes = rangeStart + rangeLength;
    }
    if (layoutBytes >= INT_MAX / (int)sizeof(int)) {
	return -1;
    }
    widths = (int *)ckalloc(((size_t)layoutBytes + 1) * sizeof(int));
    result = X11WasmTextRunWidths(fontPtr->subFontArray[0].fontStructPtr,
	    source, layoutBytes, widths);
    if (result < 0) {
	ckfree(widths);
	return -1;
    }
    base = widths[rangeStart];
    if (maxLength < 0) {
	*lengthPtr = widths[rangeStart + rangeLength] - base;
	ckfree(widths);
	return rangeLength;
    }

    /* Preserve the Unix flags/word-boundary algorithm, including zero widths. */
    start = source + rangeStart;
    end = start + rangeLength;
    p = term = start;
    next = p + BrowserFontNextChar(p, end, &ch);
    newX = curX = termX = 0;
    sawNonSpace = (ch > 255) || !isspace(ch);
    for (;;) {
	newX = widths[next - source] - base;
	if (newX > maxLength) {
	    break;
	}
	curX = newX;
	p = next;
	if (p >= end) {
	    term = end;
	    termX = curX;
	    break;
	}
	next = p + BrowserFontNextChar(p, end, &ch);
	if ((ch < 256) && isspace(ch)) {
	    if (sawNonSpace) {
		term = p;
		termX = curX;
		sawNonSpace = 0;
	    }
	} else {
	    sawNonSpace = 1;
	}
    }
    if ((flags & TK_PARTIAL_OK) && (p < end) && (curX < maxLength)) {
	curX = newX;
	p = next;
    }
    if ((flags & TK_AT_LEAST_ONE) && (term == start) && (p < end)) {
	term = p;
	termX = curX;
	if (term == start) {
	    term = next;
	    termX = newX;
	}
    } else if ((p >= end) || !(flags & TK_WHOLE_WORDS)) {
	term = p;
	termX = curX;
    }
    *lengthPtr = termX;
    result = (int)(term - start);
    ckfree(widths);
    return result;
}

static int
BrowserFontDrawContext(UnixFont *fontPtr, Display *display, Drawable drawable,
    GC gc, const char *source, int numBytes, int rangeStart, int rangeLength,
    int x, int y)
{
    int startWidth, width;

    if (BrowserFontMeasure(fontPtr, source, numBytes, 0, rangeStart,
	    -1, 0, &startWidth) < 0
	    || BrowserFontMeasure(fontPtr, source, numBytes, rangeStart,
		    rangeLength, -1, 0, &width) < 0) {
	return -1;
    }
    X11WasmDrawTextInContext(display, drawable, gc, source, numBytes,
	    rangeStart, rangeLength, x, y);
    if (width > 0) {
	if (fontPtr->font.fa.underline) {
	    XFillRectangle(display, drawable, gc, x + startWidth,
		    y + fontPtr->underlinePos, (unsigned)width,
		    (unsigned)fontPtr->barHeight);
	}
	if (fontPtr->font.fa.overstrike) {
	    XFillRectangle(display, drawable, gc, x + startWidth,
		    y - fontPtr->font.fm.descent - fontPtr->font.fm.ascent / 10,
		    (unsigned)width, (unsigned)fontPtr->barHeight);
	}
    }
    return 0;
}
