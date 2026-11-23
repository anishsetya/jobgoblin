// What a screen that cannot open says, rendered to HTML in Node (no browser needed).
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { networkProblem } from "@/api/client";
import { RouteErrorScreen } from "./RouteErrorScreen";

function renderErrorScreen(error: unknown, { inFrame }: { inFrame: boolean }): string {
  return renderToStaticMarkup(<RouteErrorScreen error={error} onRetry={() => undefined} inFrame={inFrame} />);
}

describe("RouteErrorScreen", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says Jobgoblin could not be reached, and offers Try again, when the screen got no answer", () => {
    const html = renderErrorScreen(networkProblem(), { inFrame: true });

    expect(html).toContain("This screen could not open");
    expect(html).toContain("Jobgoblin could not be reached.");
    expect(html).toContain("Check that Jobgoblin is still open on your computer, then try again.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Something went wrong");
  });

  it("keeps the calm words, and no raw error text, for a mistake in the screen itself", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const html = renderErrorScreen(new TypeError("screen.render is not a function"), { inFrame: true });

    expect(html).toContain("Something went wrong on this screen.");
    expect(html).not.toContain("screen.render is not a function");
  });

  it("leaves the main landmark to the sidebar frame inside it, and brings its own as a whole page", () => {
    expect(renderErrorScreen(networkProblem(), { inFrame: true })).not.toContain("<main");
    expect(renderErrorScreen(networkProblem(), { inFrame: false })).toContain("<main");
  });
});
