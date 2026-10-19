const path = require("node:path");
const base = require("../../playwright.config.js");

// A slow driver must not let startup timers observe pre-action browser state.
module.exports = {
  ...base,
  fullyParallel: true,
  testDir: path.resolve(__dirname, "../tcltk"),
  grep: /Tk screen dimensions follow browser root element size/,
  use: {
    ...base.use,
    launchOptions: { slowMo: 1500 },
  },
};
