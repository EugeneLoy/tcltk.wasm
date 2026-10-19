const assert = require("node:assert/strict");
const { test } = require("node:test");
const { evalTcl } = require("./tcltk");

function pageWith(module, target = {}) {
  return {
    async evaluate(fn, arg) {
      const previous = global.window;
      global.window = { ...target, Module: module };
      try {
        return await fn(arg);
      } finally {
        global.window = previous;
      }
    },
  };
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
