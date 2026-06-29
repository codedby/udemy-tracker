const express = require("express");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
const PORT = 3001;

const PROJECT_ROOT = path.join(__dirname, "..");
const DEFAULT_CONFIG_PATH = path.join(__dirname, "config.json");
const LOCAL_CONFIG_PATH = path.join(__dirname, "config.local.json");
const URLS_PATH = path.join(PROJECT_ROOT, "urls.txt");
const PUBLIC_PATH = path.join(PROJECT_ROOT, "public");

let scraperIsRunning = false;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_PATH));

app.get("/api/config", (req, res) => {
  try {
    const configPath = fs.existsSync(LOCAL_CONFIG_PATH)
      ? LOCAL_CONFIG_PATH
      : DEFAULT_CONFIG_PATH;

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    res.json(config);
  } catch (error) {
    res.status(500).json({
      error: "Could not read config file.",
      details: error.message,
    });
  }
});

app.get("/api/urls", (req, res) => {
  try {
    const urls = fs.existsSync(URLS_PATH)
      ? fs.readFileSync(URLS_PATH, "utf8")
      : "";

    res.json({ urls });
  } catch (error) {
    res.status(500).json({
      error: "Could not read urls.txt.",
      details: error.message,
    });
  }
});

app.post("/api/run", (req, res) => {
  if (scraperIsRunning) {
    res.status(409).type("text/plain").send("Scraper is already running.");
    return;
  }

  try {
    const { config, urls } = req.body;

    const cleanUrls = urls
      .split("\n")
      .map((url) => url.trim())
      .filter(Boolean);

    const finalConfig = {
      ...config,
      MAX_COURSES_PER_RUN: cleanUrls.length,
    };

    fs.writeFileSync(
      LOCAL_CONFIG_PATH,
      JSON.stringify(finalConfig, null, 2) + "\n",
      "utf8"
    );

    fs.writeFileSync(URLS_PATH, cleanUrls.join("\n") + "\n", "utf8");

    scraperIsRunning = true;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.write("Starting scraper...\n\n");

    const scraper = spawn(process.execPath, ["src/index.js"], {
      cwd: PROJECT_ROOT,
    });

    scraper.stdout.on("data", (data) => {
      res.write(data.toString());
    });

    scraper.stderr.on("data", (data) => {
      res.write(data.toString());
    });

    scraper.on("close", (code) => {
      scraperIsRunning = false;

      res.write(`\n\nScraper finished with exit code ${code}.\n`);
      res.end();
    });

    scraper.on("error", (error) => {
      scraperIsRunning = false;

      res.write(`\nCould not start scraper: ${error.message}\n`);
      res.end();
    });
  } catch (error) {
    scraperIsRunning = false;

    res.status(500).type("text/plain").send(
      `Could not run scraper.\n${error.message}`
    );
  }
});

app.listen(PORT, () => {
  console.log(`Course scraper UI running at http://localhost:${PORT}`);
});
