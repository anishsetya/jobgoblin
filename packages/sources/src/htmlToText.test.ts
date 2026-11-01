import { describe, expect, it } from "vitest";
import { decodeEntities } from "./entities";
import { htmlToText } from "./htmlToText";

describe("htmlToText", () => {
  it("keeps paragraph breaks as blank lines", () => {
    const text = htmlToText("<p>First paragraph.</p><p>Second paragraph.</p>");

    expect(text).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("turns a list into dash-prefixed lines", () => {
    const text = htmlToText("<p>You will:</p><ul><li>Write Python</li><li>Run Kubernetes</li></ul>");

    expect(text).toBe("You will:\n\n- Write Python\n- Run Kubernetes");
  });

  it("treats line breaks in the HTML source as spaces, since only tags make real breaks", () => {
    const text = htmlToText("<ul>\n<li>Write Python</li>\n<li>Run Kubernetes</li>\n</ul>\n<p>One sentence\nover two lines.</p>");

    expect(text).toBe("- Write Python\n- Run Kubernetes\n\nOne sentence over two lines.");
  });

  it("keeps a bullet and its paragraph on one line", () => {
    const text = htmlToText("<ul><li><p>Build APIs</p></li><li><p>Review code</p></li></ul>");

    expect(text).toBe("- Build APIs\n\n- Review code");
  });

  it("turns line breaks into new lines", () => {
    expect(htmlToText("Line one<br>Line two<br/>Line three")).toBe("Line one\nLine two\nLine three");
  });

  it("decodes named and numeric entities", () => {
    const text = htmlToText("Q&amp;A &ndash; caf&#233; &#x2F; &#x1F600; &lt;3 &nbsp;done");

    expect(text).toBe("Q&A – café / \u{1F600} <3 done");
  });

  it("decodes entities only once", () => {
    expect(decodeEntities("&amp;lt;p&amp;gt;")).toBe("&lt;p&gt;");
  });

  it("leaves unknown or invalid references exactly as written", () => {
    expect(decodeEntities("&madeup; &#0; &#xD800; &#99999999;")).toBe("&madeup; &#0; &#xD800; &#99999999;");
  });

  it("keeps escaped tags as words, because they were never tags", () => {
    expect(htmlToText("<p>Use &lt;div&gt; and &lt;span&gt; sparingly.</p>")).toBe("Use <div> and <span> sparingly.");
  });

  it("drops scripts, styles and comments", () => {
    const html = "<style>p { color: red }</style><p>Visible</p><script>alert('x')</script><!-- note -->";

    expect(htmlToText(html)).toBe("Visible");
  });

  it("keeps text that styling hides, because posting text is untrusted data either way", () => {
    const text = htmlToText('<p>Real text</p><p style="display:none">Hidden instruction</p>');

    expect(text).toBe("Real text\n\nHidden instruction");
  });

  it("squeezes spaces and caps blank lines at one", () => {
    const text = htmlToText("<div>  Spaced   out  </div><div>&nbsp;</div><div></div><div>Next</div>");

    expect(text).toBe("Spaced out\n\nNext");
  });

  it("returns an empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
  });
});
