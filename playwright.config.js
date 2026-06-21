// @ts-check

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
    testDir: "tests",
    timeout: 30000,
    webServer: {
	command: "python3 -m http.server 8765 -d build/browser",
	url: "http://127.0.0.1:8765/tcltk.html",
	reuseExistingServer: true,
	timeout: 120000,
    },
    use: {
	baseURL: "http://127.0.0.1:8765",
	trace: "retain-on-failure",
	screenshot: "only-on-failure",
    },
};
