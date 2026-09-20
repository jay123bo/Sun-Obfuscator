import { detectLua } from "@/lua-detector";

describe("Lua detector", () => {
  test("accepts valid Lua", () => {
    const result = detectLua('local x = 10\nprint("hello")');
    expect(result.isLua).toBe(true);
    expect(result.parserValid).toBe(true);
  });

  test("rejects JavaScript", () => {
    const result = detectLua('const x = 10; console.log("hello");');
    expect(result.isLua).toBe(false);
  });

  test("rejects Python", () => {
    const result = detectLua('def hello(name):\n    return f"Hi {name}"');
    expect(result.isLua).toBe(false);
  });

  test("rejects empty input", () => {
    expect(detectLua("").isLua).toBe(false);
  });
});
