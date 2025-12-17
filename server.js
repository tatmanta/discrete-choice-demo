const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve all static files in this folder (index.html, results.html, /css, etc.)
app.use(express.static(path.join(__dirname)));

// Friendly routes (optional, but nice)
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/results", (req, res) => res.sendFile(path.join(__dirname, "results.html")));

app.listen(PORT, () => console.log(`Listening on ${PORT}`));
