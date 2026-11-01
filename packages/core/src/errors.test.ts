import { describe, expect, it } from "vitest";
import { CoreError } from "./errors";

describe("CoreError", () => {
  it("is an Error that carries a code and a message", () => {
    const error = new CoreError("invalid-input", "That value cannot be hashed.");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CoreError);
    expect(error.code).toBe("invalid-input");
    expect(error.message).toBe("That value cannot be hashed.");
    expect(error.name).toBe("CoreError");
  });
});
