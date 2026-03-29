import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = Number.parseInt(process.env.PORT ?? "5173", 10);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".txt", "text/plain; charset=utf-8"],
]);

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath);
  const noQuery = decoded.split("?")[0].split("#")[0];
  const normalized = path
    .normalize(noQuery)
    .replaceAll("\\", "/")
    .replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.join(root, normalized);
  if (!full.startsWith(root)) return null;
  return full;
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = safeJoin(__dirname, pathname.slice(1));
    if (!filePath) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad Request");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = contentTypes.get(ext) ?? "application/octet-stream";

    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-cache",
    });
    if (method === "HEAD") {
      res.end();
    } else {
      res.end(data);
    }
  } catch (e) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Serving on http://localhost:${port}/`);
});
