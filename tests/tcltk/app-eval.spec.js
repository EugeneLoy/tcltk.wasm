// @ts-check

const path = require("node:path");
const { test, expect } = require("@playwright/test");

async function openApp(page) {
  await page.route("**/app.html*", (route) => route.fulfill({
    path: path.resolve(__dirname, "../../browser/app/app.html"),
    contentType: "text/html",
  }));
  const query = new URLSearchParams({ eval: "set ::appEvalSeed ready" });
  await page.goto(`/app.html?${query}`);
  await expect(page.locator("#tcl-run")).toBeEnabled({ timeout: 15000 });
  await page.waitForFunction(() =>
    !/** @type {any} */ (window).Asyncify?.currData,
  );
}

async function openFakeApp(page) {
  await page.addInitScript(() => {
    const target = /** @type {any} */ (window);
    /** @type {{ pending: boolean }[]} */
    const frees = [];
    const state = { allocations: 0, calls: 0, frees };
    target.appEvalTest = state;
    target.Module = {
      HEAPU8: new Uint8Array(65536),
      _malloc: () => 64 + 256 * state.allocations++,
      _free: () => state.frees.push({ pending: !!target.Asyncify?.currData }),
    };
  });
  await page.route("**/tcltk.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: "Module.postRun.forEach(callback => callback());",
  }));
  await openApp(page);
}

for (const fail of [false, true]) {
  test(`app eval waits for poll(0) before reporting ${fail ? "error" : "success"}`, async ({ page }) => {
    await openApp(page);
    const result = await page.evaluate(async (fail) => {
      const target = /** @type {any} */ (window);
      const module = target.Module;
      const evalFn = module._TkBrowserEval;
      const free = module._free;
      const poll = target.doPollAsync;
      const calls = [];
      const frees = [];
      const timeouts = [];
      let scriptPointer = 0;
      module._TkBrowserEval = (pointer) => {
        scriptPointer = pointer;
        const value = evalFn(pointer);
        calls.push({ value, pending: !!target.Asyncify.currData });
        return value;
      };
      module._free = (pointer) => {
        if (pointer === scriptPointer) {
          frees.push({ pending: !!target.Asyncify.currData });
        }
        free(pointer);
      };
      target.doPollAsync = (fds, count, timeout) => {
        timeouts.push(timeout);
        return poll(fds, count, timeout);
      };
      async function evaluate(script) {
        const code = await target.tclTkBrowserEval(script);
        const state = {
          code,
          result: module.tkBrowserEvalResult,
          pending: !!target.Asyncify.currData,
          output: document.getElementById("tcl-shell-output")?.textContent || "",
        };
        // Drain only the broken old caller, so its failure cannot leak to teardown.
        if (target.Asyncify.currData && !target.Asyncify.asyncPromiseHandlers) {
          await target.Asyncify.whenDone();
        }
        return state;
      }
      try {
        const first = await evaluate(fail
          ? "update; error {app async failure}"
          : "update; set ::appEvalValue {app async success}");
        const next = await evaluate("expr {6 * 7}");
        return { first, next, calls, frees, timeouts };
      } finally {
        module._TkBrowserEval = evalFn;
        module._free = free;
        target.doPollAsync = poll;
      }
    }, fail);
    expect(result.calls[0]).toEqual({ value: 0, pending: true });
    expect(result.timeouts).toContain(0);
    expect(result).toMatchObject({
      frees: [{ pending: false }, { pending: false }],
      first: {
        code: fail ? 1 : 0,
        result: fail ? "app async failure" : "app async success",
        pending: false,
      },
      next: { code: 0, result: "42", pending: false },
    });
    expect(result.first.output).toContain(
      fail ? "! app async failure\n" : "= app async success\n",
    );
    expect(result.next.output).toContain("= 42\n");
  });
}

test("app eval waits for an idle native unwind without stealing its waiter", async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const target = /** @type {any} */ (window);
    target.MainLoop.func();
    const nativePending = !!target.Asyncify.currData;
    const nativeDone = target.Asyncify.whenDone();
    const handlers = target.Asyncify.asyncPromiseHandlers;
    const evaluation = target.tclTkBrowserEval("update; set ::appNativeIdle waited");
    const waiterPreserved = target.Asyncify.asyncPromiseHandlers === handlers;
    await nativeDone;
    const code = await evaluation;
    return {
      nativePending,
      waiterPreserved,
      code,
      result: target.Module.tkBrowserEvalResult,
      pending: !!target.Asyncify.currData,
    };
  });
  expect(result).toEqual({
    nativePending: true,
    waiterPreserved: true,
    code: 0,
    result: "waited",
    pending: false,
  });
});

test("app Run and repeated sequential evals survive idle event-loop polling", async ({ page }) => {
  await openApp(page);
  await page.locator("#tcl-command").fill("update; set ::appRunValue {run complete}");
  await page.locator("#tcl-run").click();
  await expect(page.locator("#tcl-shell-output")).toContainText("= run complete\n");
  await expect(page.locator("#tcl-run")).toBeEnabled();
  const results = await page.evaluate(async () => {
    const target = /** @type {any} */ (window);
    const results = [];
    for (let index = 0; index < 30; index++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const code = await target.tclTkBrowserEval(`update; set ::appRepeat ${index}`);
      results.push({ code, result: target.Module.tkBrowserEvalResult });
    }
    return results;
  });
  expect(results).toEqual(
    Array.from({ length: 30 }, (_, index) => ({
      code: 0, result: String(index),
    })),
  );
  await expect(page.locator("#tcl-run")).toBeEnabled();
  await expect(page.locator("#tcl-demo")).toBeEnabled();
});

for (const asyncify of [false, true]) {
  test(`app eval preserves synchronous runtime with Asyncify ${asyncify ? "idle" : "absent"}`, async ({ page }) => {
    await openFakeApp(page);
    const result = await page.evaluate(async (asyncify) => {
      const target = /** @type {any} */ (window);
      if (asyncify) {
        target.Asyncify = {
          currData: null,
          whenDone: () => {
            throw new Error("unexpected completion waiter");
          },
        };
      }
      target.Module._TkBrowserEval = () => {
        target.appEvalTest.calls++;
        target.Module.tkBrowserEvalResult = "sync complete";
        return 0;
      };
      const code = await target.tclTkBrowserEval("sync script");
      return { code, ...target.appEvalTest };
    }, asyncify);
    expect(result).toMatchObject({
      code: 0,
      calls: 1,
      allocations: 1,
      frees: [{ pending: false }],
    });
    await expect(page.locator("#tcl-shell-output")).toContainText("= sync complete\n");
    await expect(page.locator("#tcl-run")).toBeEnabled();
  });
}

for (const mode of [
  "Asyncify success",
  "Asyncify error",
  "Asyncify rejection",
  "Promise success",
  "Promise rejection",
]) {
  test(`app eval retains pointer and busy ownership through ${mode}`, async ({ page }) => {
    await openFakeApp(page);
    const result = await page.evaluate(async (mode) => {
      const target = /** @type {any} */ (window);
      const module = target.Module;
      const state = target.appEvalTest;
      const promiseRuntime = mode.startsWith("Promise");
      const rejects = mode.endsWith("rejection");
      const error = mode.endsWith("error");
      /** @type {() => void} */
      let finish = () => {
        throw new Error("missing completion waiter");
      };
      let waiters = 0;
      const completion = () => new Promise((resolve, reject) => {
        finish = () => {
          target.Asyncify.currData = null;
          module.tkBrowserEvalResult = error ? "Tcl failure" : "async complete";
          if (rejects) {
            reject(new Error("runtime failure"));
          } else {
            resolve(error ? 1 : 0);
          }
        };
      });
      target.Asyncify = {
        currData: null,
        whenDone: () => {
          if (promiseRuntime) {
            throw new Error("Promise runtime already owns completion");
          }
          waiters++;
          return completion();
        },
      };
      module._TkBrowserEval = () => {
        state.calls++;
        target.Asyncify.currData = 1;
        return promiseRuntime ? completion() : 0;
      };
      const snapshot = () => ({
        allocations: state.allocations,
        calls: state.calls,
        frees: state.frees.length,
        runDisabled: /** @type {HTMLButtonElement} */ (
          document.querySelector("#tcl-run")
        ).disabled,
        demoDisabled: /** @type {HTMLButtonElement} */ (
          document.querySelector("#tcl-demo")
        ).disabled,
      });
      const first = target.tclTkBrowserEval("first script");
      const before = snapshot();
      const refusedCode = await target.tclTkBrowserEval("overlapping script");
      const afterRefusal = snapshot();
      finish();
      const code = await first;
      const afterCompletion = snapshot();
      const output = document.getElementById("tcl-shell-output")?.textContent || "";
      module._TkBrowserEval = () => {
        state.calls++;
        module.tkBrowserEvalResult = "recovered";
        return 0;
      };
      const nextCode = await target.tclTkBrowserEval("next script");
      return {
        before,
        afterRefusal,
        afterCompletion,
        refusedCode,
        code,
        output,
        nextCode,
        waiters,
        final: snapshot(),
        frees: state.frees,
      };
    }, mode);
    const busy = {
      allocations: 1,
      calls: 1,
      frees: 0,
      runDisabled: true,
      demoDisabled: true,
    };
    expect(result.before).toEqual(busy);
    expect(result.afterRefusal).toEqual(busy);
    expect(result.refusedCode).toBe(1);
    expect(result.code).toBe(mode.endsWith("success") ? 0 : 1);
    expect(result.waiters).toBe(mode.startsWith("Promise") ? 0 : 1);
    expect(result.afterCompletion).toMatchObject({
      frees: 1,
      runDisabled: false,
      demoDisabled: false,
    });
    expect(result.output).toContain(
      mode.endsWith("rejection")
        ? "! runtime failure\n"
        : mode.endsWith("error") ? "! Tcl failure\n" : "= async complete\n",
    );
    expect(result.nextCode).toBe(0);
    expect(result.final).toEqual({
      allocations: 2,
      calls: 2,
      frees: 2,
      runDisabled: false,
      demoDisabled: false,
    });
    expect(result.frees).toEqual([{ pending: false }, { pending: false }]);
    await expect(page.locator("#tcl-shell-output")).toContainText("= recovered\n");
  });
}
