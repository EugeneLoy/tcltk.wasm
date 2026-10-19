const path = require("node:path");
const base = require("../../playwright.config.js");

// A slow driver must not let startup timers observe pre-action browser state.
module.exports = {
  ...base,
  fullyParallel: true,
  testDir: path.resolve(__dirname, "../tcltk"),
  grep: /Tk screen dimensions follow browser root element size|Tk clipboard get reads text cached from browser paste|Tk clipboard get reads text synced from navigator clipboard|Tk browser paste selection advertises targets and timestamp/,
  use: {
    ...base.use,
    launchOptions: { slowMo: 1500 },
  },
};
