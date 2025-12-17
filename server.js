const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_FILES = new Set([
  "/gate.html",
  "/css/styles.css",
  "/favicon.ico",
  "/robots.txt"
]);

// Gate middleware (checks a cookie set by the gate)
app.use((req, res, next) => {
  const p = req.path;

  // allow gate + assets
  if (
    p === "/gate" ||
    p === "/gate.html" ||
    p.startsWith("/css/") ||
    p.startsWith("/img/") ||
    p.startsWith("/assets/") ||
    PUBLIC_FILES.has(p)
  ) {
    return next();
  }

  // If already authorized via cookie, allow
  const cookie = req.headers.cookie || "";
  const ok = cookie.includes("dc_access_ok=1");
  if (ok) return next();

  // Otherwise, redirect to gate
  // (store intended path in query so gate can send them back)
  const nextPath = encodeURIComponent(p === "/" ? "/index.html" : p);
  return res.redirect(`/gate.html?next=${nextPath}`);
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Gate route to set cookie (called from gate.html)
app.get("/unlock", (req, res) => {
  const code = String(req.query.code || "").trim();
  const ACCESS_CODE = process.env.ACCESS_CODE || "HAL2025";

  if (code !== ACCESS_CODE) {
    return res.status(401).send("NO");
  }

  // Session cookie (expires when browser closes)
  res.setHeader(
    "Set-Cookie",
    "dc_access_ok=1; Path=/; SameSite=Lax; HttpOnly"
  );
  return res.send("OK");
});

// Friendly routes
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/results", (req, res) => res.sendFile(path.join(__dirname, "results.html")));

app.listen(PORT, () => console.log(`Listening on ${PORT}`));
