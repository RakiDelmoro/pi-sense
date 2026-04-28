import { describe, it, expect } from "bun:test";
import { handleRequest, buildClient } from "../src/server/main";

describe("server", () => {
  it("builds client bundle without error", async () => {
    await buildClient();
    const file = Bun.file("dist/client.js");
    expect(await file.exists()).toBe(true);
    expect((await file.stat()).size).toBeGreaterThan(0);
  });

  it("serves index.html at root", async () => {
    const req = new Request("http://localhost/");
    const res = await handleRequest(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html");
    const text = await res.text();
    expect(text).toContain("PiSense");
  });

  it("serves style.css", async () => {
    const req = new Request("http://localhost/style.css");
    const res = await handleRequest(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/css");
  });

  it("serves client.js", async () => {
    const req = new Request("http://localhost/client.js");
    const res = await handleRequest(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/javascript");
  });

  it("returns 404 for unknown paths", async () => {
    const req = new Request("http://localhost/nonexistent.txt");
    const res = await handleRequest(req);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe("Not found");
  });
});
