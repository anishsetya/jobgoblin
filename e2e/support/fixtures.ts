// The Playwright `test` every spec imports. It adds `startServer`, which starts a real Jobgoblin server
// (see server.ts) and stops it, with everything it started, when the test ends, pass or fail.
// On a failure the server's own output is attached to the report.
// Spec: ARCHITECTURE.md section 15 (e2e).
import { test as base, expect } from "@playwright/test";
import { startTestServer, type TestServer, type TestServerOptions } from "./server";

type Fixtures = {
  startServer: (options?: TestServerOptions) => Promise<TestServer>;
};

export const test = base.extend<Fixtures>({
  startServer: async ({}, use, testInfo) => {
    const started: TestServer[] = [];

    await use(async (options) => {
      const server = await startTestServer(options);
      started.push(server);
      return server;
    });

    for (const server of started) {
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach(`server-output-${server.pid}.txt`, { body: server.output(), contentType: "text/plain" });
      }
      await server.stop();
    }
  },
});

export { expect };
