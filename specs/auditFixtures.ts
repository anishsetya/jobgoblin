// The audit's `test`: the product's own test (startServer) plus a watcher on every page that records console
// errors, uncaught page errors, failed requests and 4xx/5xx answers into AUDIT_DIR/observations.jsonl.
// A test that CAUSES an error on purpose calls audit.expectNoise(/pattern/) first so it is not reported as noise.
import type { BrowserContext, Page } from "@playwright/test";
import { test as base, expect } from "../support/fixtures";
import { observation } from "./record";

export type Audit = {
  // URLs (or console texts) matching this are expected in this test and are not recorded.
  expectNoise(pattern: RegExp): void;
};

export const test = base.extend<{ audit: Audit }>({
  audit: [
    async ({ context }, use) => {
      const expected: RegExp[] = [];
      const isExpected = (text: string): boolean => expected.some((pattern) => pattern.test(text));
      const watched = new WeakSet<Page>();

      function watch(page: Page): void {
        if (watched.has(page)) return;
        watched.add(page);
        page.on("console", (message) => {
          if (message.type() !== "error" && message.type() !== "warning") return;
          const text = message.text();
          if (isExpected(text)) return;
          observation("console", { level: message.type(), text, url: page.url() });
        });
        page.on("pageerror", (error) => {
          if (isExpected(error.message)) return;
          observation("pageerror", { text: error.message, url: page.url() });
        });
        page.on("requestfailed", (request) => {
          const url = request.url();
          if (isExpected(url)) return;
          observation("requestfailed", { method: request.method(), url, reason: request.failure()?.errorText, page: page.url() });
        });
        page.on("response", (response) => {
          if (response.status() < 400) return;
          const url = response.url();
          if (isExpected(url)) return;
          observation("http", { status: response.status(), method: response.request().method(), url, page: page.url() });
        });
      }

      watchContext(context, watch);
      await use({ expectNoise: (pattern) => expected.push(pattern) });
    },
    { auto: true },
  ],
});

function watchContext(context: BrowserContext, watch: (page: Page) => void): void {
  for (const page of context.pages()) watch(page);
  context.on("page", watch);
}

export { expect };
