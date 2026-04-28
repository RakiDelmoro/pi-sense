import { build, serve } from "bun";

const PORT = Number(process.env.PORT) || 3000;
const ENABLE_BROKER = process.env.ENABLE_BROKER === "true";
const MQTT_BROKER = ENABLE_BROKER ? "localhost" : (process.env.MQTT_BROKER || "localhost");
const MQTT_WS_PORT = process.env.MQTT_WS_PORT || "9001";

export async function buildClient() {
  await build({
    entrypoints: ["./src/client/app.ts"],
    outdir: "./dist",
    naming: "client.js",
    target: "browser",
    define: {
      "globalThis.__MQTT_BROKER__": `"${MQTT_BROKER}"`,
      "globalThis.__MQTT_WS_PORT__": `"${MQTT_WS_PORT}"`,
    },
  });
}

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;

  let filePath = "public" + pathname;
  let file = Bun.file(filePath);

  if (await file.exists()) {
    const headers = new Headers();
    if (pathname.endsWith(".js")) headers.set("Content-Type", "application/javascript");
    else if (pathname.endsWith(".css")) headers.set("Content-Type", "text/css");
    else if (pathname.endsWith(".html")) headers.set("Content-Type", "text/html");
    return new Response(file, { headers });
  }

  filePath = "dist" + pathname;
  file = Bun.file(filePath);

  if (await file.exists()) {
    const headers = new Headers();
    if (pathname.endsWith(".js")) headers.set("Content-Type", "application/javascript");
    else if (pathname.endsWith(".css")) headers.set("Content-Type", "text/css");
    else if (pathname.endsWith(".html")) headers.set("Content-Type", "text/html");
    return new Response(file, { headers });
  }

  return new Response("Not found", { status: 404 });
}

if (import.meta.main) {
  if (ENABLE_BROKER) {
    const { startBroker } = await import("./broker.ts");
    startBroker();
  }

  console.log("[main] Building client bundle...");
  await buildClient();
  console.log("[main] Client built: dist/client.js");

  serve({
    port: PORT,
    fetch: handleRequest,
  });

  console.log(`[main] Pi Sense server running at http://0.0.0.0:${PORT}`);
  if (ENABLE_BROKER) console.log("[main] Built-in broker enabled");
}
