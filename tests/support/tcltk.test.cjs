const assert = require("node:assert/strict");
const { test } = require("node:test");
const { evalTcl } = require("./tcltk");

function pageWith(module, target = {}) {
  const browserWindow = { ...target, Module: module };
  return {
    async evaluate(fn, arg) {
      const previous = global.window;
      global.window = browserWindow;
      try {
        return await fn(arg);
      } finally {
        global.window = previous;
      }
    },
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function runtime() {
  const state = { allocations: 0, calls: 0, frees: [], waiters: 0 };
  const asyncify = {
    currData: 0,
    whenDone() {
      state.waiters++;
      throw new Error("unexpected completion waiter");
    },
  };
  const module = {
    HEAPU8: new Uint8Array(128),
    tkBrowserEvalResult: "stale result",
    _malloc() { state.allocations++; return 8; },
    _free(pointer) { state.frees.push({ pointer, pending: !!asyncify.currData }); },
    _TkBrowserEval() { state.calls++; return 0; },
  };
  return { module, asyncify, state, page: pageWith(module, { Asyncify: asyncify }) };
}

test("Tcl helper reads the current heap after allocation and preserves result bytes", async () => {
  const freed = [];
  const module = {
    HEAPU8: new Uint8Array(1),
    _malloc(size) {
      this.HEAPU8 = new Uint8Array(size + 8);
      return 8;
    },
    async _TkBrowserEval(pointer) {
      const source = new TextDecoder().decode(this.HEAPU8.subarray(pointer, -1));
      assert.equal(source, "set value {\u3042}");
      assert.equal(this.HEAPU8.at(-1), 0);
      this.tkBrowserEvalResult = "A\0B";
      return 0;
    },
    _free(pointer) { freed.push(pointer); },
  };
  assert.equal(await evalTcl(pageWith(module), "set value {\u3042}"), "A\0B");
  assert.deepEqual(freed, [8]);
});

test("Tcl helper releases its allocation on native and evaluation failures", async () => {
  for (const throws of [false, true]) {
    const freed = [];
    const module = {
      HEAPU8: new Uint8Array(64),
      _malloc: () => 8,
      _TkBrowserEval() {
        if (throws) throw new Error("native failure");
        this.tkBrowserEvalResult = "Tcl failure";
        return 1;
      },
      _free(pointer) { freed.push(pointer); },
    };
    await assert.rejects(evalTcl(pageWith(module), "error failure"),
      throws ? /native failure/ : /Tcl failure/);
    assert.deepEqual(freed, [8]);
  }
});

test("Tcl helper supports synchronous exports with idle Asyncify", async () => {
  const { page, module, state } = runtime();
  module._TkBrowserEval = () => {
    state.calls++;
    module.tkBrowserEvalResult = "sync result";
    return 0;
  };
  assert.equal(await evalTcl(page, "sync"), "sync result");
  assert.deepEqual(state, {
    allocations: 1, calls: 1, waiters: 0,
    frees: [{ pointer: 8, pending: false }],
  });
});

for (const mode of ["numeric", "Promise"]) {
  for (const outcome of ["success", "Tcl error", "rejection"]) {
    test(`Tcl helper retains its pointer through ${mode} ${outcome}`, async () => {
      const { page, module, asyncify, state } = runtime();
      const completion = deferred();
      if (mode === "numeric") {
        asyncify.whenDone = () => { state.waiters++; return completion.promise; };
      }
      module._TkBrowserEval = () => {
        state.calls++;
        asyncify.currData = 1;
        return mode === "Promise" ? completion.promise : 0;
      };
      const evaluation = evalTcl(page, "update; final result");
      // Observe after the old helper's numeric await would have returned.
      await new Promise(setImmediate);
      const before = { frees: [...state.frees], waiters: state.waiters };
      asyncify.currData = 0;
      module.tkBrowserEvalResult = outcome === "success" ? "final\0result" : "final Tcl failure";
      if (outcome === "rejection") {
        // The old numeric caller never subscribes to this rejection.
        completion.promise.catch(() => {});
        completion.reject(new Error("native rejection"));
      } else {
        completion.resolve(outcome === "Tcl error" ? 1 : 0);
      }
      const result = await evaluation.then(value => ({ value }), error => ({ error }));
      assert.deepEqual(before, { frees: [], waiters: mode === "numeric" ? 1 : 0 });
      if (outcome === "success") {
        assert.deepEqual(result, { value: "final\0result" });
      } else {
        assert.match(String(result.error), outcome === "Tcl error" ? /final Tcl failure/ : /native rejection/);
      }
      assert.deepEqual(state.frees, [{ pointer: 8, pending: false }]);
      module._TkBrowserEval = () => { module.tkBrowserEvalResult = "recovered"; return 0; };
      assert.equal(await evalTcl(page, "next"), "recovered");
      assert.equal(state.allocations, 2);
      assert.equal(state.frees.length, 2);
    });
  }
}

test("Tcl helper preserves an existing native completion waiter before allocating", async () => {
  const { page, module, asyncify, state } = runtime();
  const native = deferred();
  const handlers = {};
  asyncify.currData = 1;
  asyncify.asyncPromiseHandlers = handlers;
  asyncify.whenDone = () => { state.waiters++; return native.promise; };
  const nativeDone = asyncify.whenDone();
  module._TkBrowserEval = () => {
    state.calls++;
    module.tkBrowserEvalResult = "after native idle";
    return 0;
  };
  const evaluation = evalTcl(page, "after idle");
  await new Promise(setImmediate);
  const before = { ...state, frees: [...state.frees] };
  asyncify.currData = 0;
  native.resolve(0);
  await nativeDone;
  const result = await evaluation;
  assert.deepEqual(before, { allocations: 0, calls: 0, frees: [], waiters: 1 });
  assert.equal(asyncify.asyncPromiseHandlers, handlers);
  assert.equal(state.waiters, 1);
  assert.equal(result, "after native idle");
  assert.deepEqual(state.frees, [{ pointer: 8, pending: false }]);
});

for (const nativePending of [false, true]) {
  test(`Tcl helper rejects concurrent evaluation while ${nativePending ? "waiting for native idle" : "evaluating"}`, async () => {
    const { page, module, asyncify, state } = runtime();
    const completion = deferred();
    asyncify.currData = nativePending ? 1 : 0;
    asyncify.whenDone = () => { state.waiters++; return completion.promise; };
    module._TkBrowserEval = () => {
      state.calls++;
      if (nativePending) {
        module.tkBrowserEvalResult = "first result";
        return 0;
      }
      asyncify.currData = 1;
      return completion.promise;
    };
    const first = evalTcl(page, "first");
    const overlapping = evalTcl(page, "second").then(value => ({ value }), error => ({ error }));
    await new Promise(setImmediate);
    asyncify.currData = 0;
    module.tkBrowserEvalResult = "first result";
    completion.resolve(0);
    assert.equal(await first, "first result");
    const second = await overlapping;
    assert.match(String(second.error), /Tcl evaluation is already in progress/);
    assert.equal(state.allocations, 1);
    assert.equal(state.calls, 1);
    assert.equal(state.waiters, 0);
    assert.deepEqual(state.frees, [{ pointer: 8, pending: false }]);
  });
}

test("Tcl helper releases busy ownership after allocation and heap failures", async () => {
  const { page, module, state } = runtime();
  module._malloc = () => 0;
  await assert.rejects(evalTcl(page, "allocation failure"), /failed to allocate Tcl script/);
  assert.deepEqual(state.frees, []);
  module._malloc = () => 8;
  module.HEAPU8 = undefined;
  await assert.rejects(evalTcl(page, "heap failure"), /missing Tcl wasm heap/);
  assert.deepEqual(state.frees, [{ pointer: 8, pending: false }]);
  module.HEAPU8 = new Uint8Array(128);
  module._TkBrowserEval = () => { module.tkBrowserEvalResult = "recovered"; return 0; };
  assert.equal(await evalTcl(page, "next"), "recovered");
});
