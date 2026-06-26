// @ts-check

const { test, expect } = require("@playwright/test");

test("Tk bell notifies the browser backend", async ({ page }) => {
  await page.addInitScript(() => {
    const target =
      /** @type {Window & { __bellCalls?: unknown[], __bellEvents?: unknown[] }} */ (
        window
      );
    target.__bellCalls = [];
    target.__bellEvents = [];

    class FakeAudioNode {
      constructor() {
        this.connected = false;
      }

      connect() {
        this.connected = true;
        target.__bellCalls?.push({ kind: "connect" });
      }

      disconnect() {
        this.connected = false;
        target.__bellCalls?.push({ kind: "disconnect" });
      }
    }

    class FakeOscillator extends FakeAudioNode {
      constructor() {
        super();
        this.frequency = { value: 0 };
        this.type = "";
        this.onended = null;
      }

      addEventListener() {}

      start(time) {
        target.__bellCalls?.push({
          frequency: this.frequency.value,
          kind: "start",
          time,
          type: this.type,
        });
      }

      stop(time) {
        target.__bellCalls?.push({ kind: "stop", time });
      }
    }

    class FakeGain extends FakeAudioNode {
      constructor() {
        super();
        this.gain = { value: 0 };
      }
    }

    class FakeAudioContext {
      constructor() {
        this.currentTime = 2;
        this.destination = {};
        this.state = "running";
        target.__bellCalls?.push({ kind: "context" });
      }

      createGain() {
        target.__bellCalls?.push({ kind: "gain" });
        return new FakeGain();
      }

      createOscillator() {
        target.__bellCalls?.push({ kind: "oscillator" });
        return new FakeOscillator();
      }
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (duration) => {
        target.__bellCalls?.push({ duration, kind: "vibrate" });
        return true;
      },
    });
    window.addEventListener("x11wasmbell", (event) => {
      target.__bellEvents?.push(
        event instanceof CustomEvent && event.detail ? event.detail : {},
      );
    });
  });

  const script = ["bell", "update", "list ready"].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  await expect(page.locator("#tk-browser-result")).toHaveText("ready");

  const bell = await page.evaluate(() => {
    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot & { bellAudioStatus?: string, bellVibrationStatus?: string, bellCount?: number, lastBellDuration?: number, lastBellFrequency?: number, lastBellPercent?: number, lastBellVolume?: number } }, __bellCalls?: unknown[], __bellEvents?: unknown[] }} */ (
        window
      ).Module?.x11WasmBackend;
    return {
      audioStatus: backend?.bellAudioStatus,
      calls:
        /** @type {Window & { __bellCalls?: unknown[] }} */ (window)
          .__bellCalls || [],
      count: backend?.bellCount,
      duration: backend?.lastBellDuration,
      events:
        /** @type {Window & { __bellEvents?: unknown[] }} */ (window)
          .__bellEvents || [],
      frequency: backend?.lastBellFrequency,
      percent: backend?.lastBellPercent,
      vibrationStatus: backend?.bellVibrationStatus,
      volume: backend?.lastBellVolume,
    };
  });

  expect(bell.count).toBeGreaterThanOrEqual(1);
  expect(bell.percent).toBe(50);
  expect(bell.audioStatus).toBe("played");
  expect(bell.vibrationStatus).toBe("vibrated");
  expect(bell.duration).toBe(100);
  expect(bell.frequency).toBe(400);
  expect(bell.volume).toBeCloseTo(0.5);
  expect(bell.calls).toContainEqual({ kind: "context" });
  expect(bell.calls).toContainEqual({
    frequency: 400,
    kind: "start",
    time: 2,
    type: "sine",
  });
  expect(bell.calls).toContainEqual({
    duration: bell.duration,
    kind: "vibrate",
  });
  expect(bell.events).toContainEqual(
    expect.objectContaining({
      audioStatus: "played",
      count: bell.count,
      duration: bell.duration,
      frequency: 400,
      percent: 50,
      vibrationStatus: "vibrated",
    }),
  );
});

test("Tk inactive reset notifies the browser backend", async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener("x11wasmscreensaver", (event) => {
      const detail =
        event instanceof CustomEvent && event.detail ? event.detail : {};
      const target = /** @type {Window & { __screenSaverEvents?: unknown[] }} */ (
        window
      );
      target.__screenSaverEvents = target.__screenSaverEvents || [];
      target.__screenSaverEvents.push(detail);
    });
  });

  const script = ["tk inactive reset", "update", "list ready"].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  await expect(page.locator("#tk-browser-result")).toHaveText("ready");

  const screenSaver = await page.evaluate(() => {
    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot & { screenSaverResetCount?: number, lastScreenSaverMode?: number, lastUserActivityTime?: number } }, __screenSaverEvents?: unknown[] }} */ (
        window
      ).Module?.x11WasmBackend;
    const root = document.getElementById("tk-browser-root");
    return {
      count: backend?.screenSaverResetCount,
      mode: backend?.lastScreenSaverMode,
      lastUserActivityTime: backend?.lastUserActivityTime,
      rootLastUserActivityTime: root?.getAttribute(
        "data-x11-wasm-last-user-activity-time",
      ),
      rootMode: root?.getAttribute("data-x11-wasm-screensaver-mode"),
      rootResetCount: root?.getAttribute("data-x11-wasm-screensaver-reset-count"),
      events:
        /** @type {Window & { __screenSaverEvents?: unknown[] }} */ (window)
          .__screenSaverEvents || [],
    };
  });

  expect(screenSaver.count).toBe(1);
  expect(screenSaver.mode).toBe(0);
  expect(screenSaver.lastUserActivityTime).toBeGreaterThan(0);
  expect(screenSaver.rootMode).toBe("0");
  expect(screenSaver.rootResetCount).toBe("1");
  expect(screenSaver.rootLastUserActivityTime).toBe(
    String(screenSaver.lastUserActivityTime),
  );
  expect(screenSaver.events).toEqual([
    {
      mode: 0,
      resetCount: 1,
      lastUserActivityTime: screenSaver.lastUserActivityTime,
    },
  ]);
});

test("Tk inactive reports browser idle time", async ({ page }) => {
  const script = [
    "tk inactive reset",
    "after 50",
    "set idle [tk inactive]",
    "list ready $idle",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });

  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result[0]).toBe("ready");
  const idle = Number.parseInt(result[1] || "", 10);
  expect(Number.isFinite(idle)).toBe(true);
  expect(idle).toBeGreaterThanOrEqual(1);
});

test("Tcl clock clicks keeps browser wide microsecond values", async ({
  page,
}) => {
  await page.goto("/tcltk.html");
  await expect(page.locator("#tk-browser-status")).toHaveText("running", {
    timeout: 15000,
  });

  const result = await page.evaluate(() => {
    const module =
      /** @type {Window & { Module?: { _TclBrowserTestClockClicksUsesWideTime?: Function } }} */ (
        window
      ).Module;
    if (!module?._TclBrowserTestClockClicksUsesWideTime) {
      throw new Error("missing Tcl clock clicks test hook");
    }
    return module._TclBrowserTestClockClicksUsesWideTime();
  });

  expect(result).toBe(1);
});
