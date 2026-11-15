// Zero-dependency local server: static files from public/ + the same /api handlers Vercel runs.
//   node dev.js            -> http://localhost:3000
//   FINN_OFFLINE=1 node dev.js  -> /api uses the test fixture instead of the network (for demos without internet)
const http = require("http"), fs = require("fs"), path = require("path"), url = require("url");
if (process.env.FINN_OFFLINE) {
  const html = fs.readFileSync(path.join(__dirname, "test/fixture_screener.html"), "utf8");
  const real = global.fetch;
  global.fetch = async (u, o) => (String(u).includes("screener.in") ? new Response(html, { status: 200 }) : real(u, o));
}
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  if (u.pathname.startsWith("/api/")) {
    const f = path.join(__dirname, "api", path.basename(u.pathname) + ".js");
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end("{}"); }
    const shim = { status(c) { res.statusCode = c; return shim; }, setHeader: (k, v) => res.setHeader(k, v), json(o) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); } };
    req.query = u.query;
    return require(f)(req, shim);
  }
  let p = path.join(__dirname, "public", u.pathname === "/" ? "index.html" : u.pathname);
  if (!p.startsWith(path.join(__dirname, "public")) || !fs.existsSync(p)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log("FINN on http://localhost:" + (process.env.PORT || 3000)));
