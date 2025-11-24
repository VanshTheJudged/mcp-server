import express from "express";
import fs from "fs";
import csvParser from "csv-parser";
import cors from "cors";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors());

/* ------------------------------
    SERVE PLUGIN + OPENAPI
--------------------------------*/
// app.get("/.well-known/ai-plugin.json", (req, res) => {
//   res.sendFile(path.join(__dirname, ".well-known", "ai-plugin.json"));
// });

// app.get("/openapi.json", (req, res) => {
//   res.sendFile(path.join(__dirname, "openapi.json"));
// });

/*--------------------------------
           DEBUG CODE
--------------------------------*/  

/* ------------------------------
    SERVE PLUGIN + OPENAPI + DEBUG
--------------------------------*/

app.get("/.well-known/manifest.json", (req, res) => {
  res.sendFile(path.join(process.cwd(), ".well-known", "manifest.json"));
});


app.get("/.well-known/ai-plugin.json", (req, res) => {
  const filePath = path.join(__dirname, ".well-known", "ai-plugin.json");
  console.log("Attempting to serve ai-plugin.json from:", filePath);
  
  if (!fs.existsSync(filePath)) {
    console.error("File not found at:", filePath);
    return res.status(404).json({ error: "ai-plugin.json not found" });
  }
  
  try {
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    res.json(content);
  } catch (err) {
    console.error("Error reading ai-plugin.json:", err);
    res.status(500).json({ error: "Failed to read file" });
  }
});

app.get("/openapi.json", (req, res) => {
  const filePath = path.join(__dirname, "openapi.json");
  console.log("Attempting to serve openapi.json from:", filePath);
  
  if (!fs.existsSync(filePath)) {
    console.error("File not found at:", filePath);
    return res.status(404).json({ error: "openapi.json not found" });
  }
  
  try {
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    res.json(content);
  } catch (err) {
    console.error("Error reading openapi.json:", err);
    res.status(500).json({ error: "Failed to read file" });
  }
});

app.get("/debug/files", (req, res) => {
  const aiPluginPath = path.join(__dirname, ".well-known", "ai-plugin.json");
  const openapiPath = path.join(__dirname, "openapi.json");
  
  res.json({
    __dirname,
    cwd: process.cwd(),
    aiPluginExists: fs.existsSync(aiPluginPath),
    openapiExists: fs.existsSync(openapiPath),
    aiPluginPath,
    openapiPath
  });
});

/* ------------------------------
    CSV + FILTERS + ENDPOINTS
--------------------------------*/

let companies = [];

function loadCSV(path) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(path)
      .pipe(csvParser())
      .on("data", (data) => rows.push(data))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

function maybeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

function applyFilters(row, filters) {
  for (const f of filters) {
    if (!(f.field in row)) continue;

    const actual = row[f.field];
    const value = f.value;

    switch (f.op) {
      case "eq":
        if (actual != value) return false;
        break;
      case "contains":
        if (!actual || !actual.toLowerCase().includes(String(value).toLowerCase()))
          return false;
        break;
      case "gt":
        if (isNaN(actual) || Number(actual) <= Number(value)) return false;
        break;
      case "lt":
        if (isNaN(actual) || Number(actual) >= Number(value)) return false;
        break;
    }
  }
  return true;
}

function fillMissingFields(row) {
  const filled = {};
  for (const key of Object.keys(row)) {
    filled[key] =
      row[key] === "" || row[key] === undefined || row[key] === null
        ? "no_data"
        : row[key];
  }
  return filled;
}

app.post("/search", (req, res) => {
  const { filters = [], limit = 50, offset = 0, sort = null } = req.body;

  let matched = companies.filter((row) => applyFilters(row, filters));

  matched = matched.map((r) => fillMissingFields(r));

  if (sort && sort.field) {
    matched.sort((a, b) => {
      const A = maybeNumber(a[sort.field]);
      const B = maybeNumber(b[sort.field]);

      if (A < B) return sort.dir === "desc" ? 1 : -1;
      if (A > B) return sort.dir === "desc" ? -1 : 1;
      return 0;
    });
  }

  const page = matched.slice(offset, offset + limit);

  res.json({
    total: matched.length,
    results: page,
  });
});

app.get("/get-company", (req, res) => {
  const { name, id } = req.query;

  let found;

  if (id) {
    found = companies.find((c) => c.id === id || c.ID === id);
  } else if (name) {
    found = companies.find(
      (c) =>
        (c.company_name || "")
          .toLowerCase()
          .trim() === name.toLowerCase().trim()
    );
  }

  if (!found) return res.status(404).json({ error: "not found" });

  res.json({ company: fillMissingFields(found) });
});

app.get("/tools/list", (req, res) => {
  res.json({
    tools: [
      {
        name: "search",
        description: "Search companies with filters",
        can_initiate: true,
        inputs: { filters: "array" },
      },
      {
        name: "get_company",
        description: "Get company by name or id",
        can_initiate: true,
        inputs: { name: "string", id: "string" },
      },
    ],
  });
});

/* ------------------------------
    SERVER START
--------------------------------*/

const PORT = process.env.PORT || 4000;
loadCSV(process.env.CSV_PATH || "./data/companies.csv")
  .then((rows) => {
    companies = rows;
    console.log("Loaded", companies.length, "rows");
    app.listen(PORT, () => console.log("Listening on port", PORT));
  })
  .catch((err) => {
    console.error("Failed to load CSV:", err);
    process.exit(1);
  });
