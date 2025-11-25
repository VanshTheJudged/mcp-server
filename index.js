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
    ROOT & INFO ENDPOINTS
--------------------------------*/

app.get("/", (req, res) => {
  res.json({
    name: "Company Search API",
    version: "1.0.0",
    description: "API for searching and filtering company data",
    endpoints: {
      searchCompanies: "POST /search-companies",
      getCompany: "GET /company",
      openapi: "/openapi.json"
    },
    status: "running",
    companiesLoaded: companies.length
  });
});

app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy",
    companiesLoaded: companies.length,
    timestamp: new Date().toISOString()
  });
});

/* ------------------------------
    OPENAPI SPEC
--------------------------------*/

app.get("/openapi.json", (req, res) => {
  res.json({
    openapi: "3.1.0",
    info: {
      title: "Company Search API",
      description: "API for searching and filtering company data",
      version: "1.0.0"
    },
    servers: [
      {
        url: "https://mcp-server-whjd.onrender.com"
      }
    ],
    paths: {
      "/search-companies": {
        post: {
          operationId: "searchCompanies",
          summary: "Search companies with filters",
          description: "Search companies by industry, country, revenue, employees, etc.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    filters: {
                      type: "array",
                      description: "Array of filter conditions",
                      items: {
                        type: "object",
                        properties: {
                          field: { type: "string" },
                          op: { type: "string", enum: ["eq", "contains", "gt", "lt"] },
                          value: { oneOf: [{ type: "string" }, { type: "number" }] }
                        },
                        required: ["field", "op", "value"]
                      }
                    },
                    limit: { type: "integer", default: 10, minimum: 1, maximum: 100 },
                    offset: { type: "integer", default: 0, minimum: 0 }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Search results",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      total: { type: "integer" },
                      showing: { type: "integer" },
                      results: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            company_name: { type: "string" },
                            industry: { type: "string" },
                            annual_revenue_usd: { type: "string" },
                            employee_count: { type: "string" },
                            founder: { type: "string" },
                            country: { type: "string" },
                            year_founded: { type: "string" },
                            website: { type: "string" }
                          }
                        }
                      }
                    },
                    required: ["total", "showing", "results"]
                  }
                }
              }
            }
          }
        }
      },
      "/company": {
        get: {
          operationId: "getCompany",
          summary: "Get a specific company by name",
          parameters: [
            { name: "name", in: "query", required: true, schema: { type: "string" } }
          ],
          responses: {
            "200": { description: "Company details" },
            "404": { description: "Company not found" }
          }
        }
      }
    }
  });
});

/* ------------------------------
    CHATGPT ACTIONS ENDPOINTS
--------------------------------*/

app.post("/search-companies", (req, res) => {
  const { filters = [], limit = 10, offset = 0 } = req.body;

  let matched = companies.filter((row) => applyFilters(row, filters));
  matched = matched.map((r) => fillMissingFields(r));
  const page = matched.slice(offset, offset + limit);

  res.json({
    total: matched.length,
    showing: page.length,
    results: page
  });
});

app.get("/company", (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "Company name is required" });

  const found = companies.find(c => (c.company_name || "").toLowerCase().trim() === name.toLowerCase().trim());
  if (!found) return res.status(404).json({ error: "Company not found" });

  res.json(fillMissingFields(found));
});

/* ------------------------------
    MCP PROTOCOL ENDPOINTS
--------------------------------*/

app.get("/.well-known/manifest.json", (req, res) => {
  const filePath = path.join(__dirname, ".well-known", "manifest.json");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "manifest.json not found" });

  try {
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: "Failed to read file" });
  }
});

app.get("/tools", (req, res) => {
  res.json({
    tools: [
      { name: "search", description: "Search companies", inputSchema: { type: "object", properties: { filters: { type: "array" }, limit: { type: "number" }, offset: { type: "number" } } } },
      { name: "get_company", description: "Get company by name", inputSchema: { type: "object", properties: { name: { type: "string" } } } }
    ]
  });
});

app.post("/tools/call", (req, res) => {
  const { name, arguments: args } = req.body;

  if (name === "search") {
    const { filters = [], limit = 50, offset = 0 } = args || {};
    let matched = companies.filter((row) => applyFilters(row, filters));
    matched = matched.map((r) => fillMissingFields(r));
    const page = matched.slice(offset, offset + limit);
    return res.json({ content: [{ type: "text", text: JSON.stringify({ total: matched.length, showing: page.length, results: page }, null, 2) }] });
  }

  if (name === "get_company") {
    const { name: companyName } = args || {};
    const found = companies.find(c => (c.company_name || "").toLowerCase().trim() === companyName.toLowerCase().trim());
    if (!found) return res.json({ content: [{ type: "text", text: "Company not found" }], isError: true });
    return res.json({ content: [{ type: "text", text: JSON.stringify(fillMissingFields(found), null, 2) }] });
  }

  res.status(400).json({ content: [{ type: "text", text: `Tool '${name}' not found` }], isError: true });
});

app.get("/mcp", (req, res) => {
  res.json({
    content: [
      {
        type: "text",
        text: "Hello World"
      }
    ]
  });
});

/* ------------------------------
    HELPER FUNCTIONS
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
      case "eq": if (actual != value) return false; break;
      case "contains": if (!actual || !actual.toLowerCase().includes(String(value).toLowerCase())) return false; break;
      case "gt": if (isNaN(actual) || Number(actual) <= Number(value)) return false; break;
      case "lt": if (isNaN(actual) || Number(actual) >= Number(value)) return false; break;
    }
  }
  return true;
}

function fillMissingFields(row) {
  const filled = {};
  for (const key of Object.keys(row)) {
    filled[key] = row[key] === "" || row[key] === undefined || row[key] === null ? "no_data" : row[key];
  }
  return filled;
}

/* ------------------------------
    SERVER START
--------------------------------*/

const PORT = process.env.PORT || 4000;
loadCSV(process.env.CSV_PATH || "./data/companies.csv")
  .then((rows) => {
    companies = rows;
    console.log("✅ Loaded", companies.length, "companies");
    app.listen(PORT, () => {
      console.log("🚀 Server listening on port", PORT);
      console.log("📍 ChatGPT Endpoints:");
      console.log("   POST /search-companies");
      console.log("   GET  /company");
      console.log("   GET  /openapi.json");
      console.log("   POST /mcp (Hello World)");
    });
  })
  .catch((err) => {
    console.error("❌ Failed to load CSV:", err);
    process.exit(1);
  });
