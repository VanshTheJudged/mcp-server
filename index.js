import express from "express";
import fs from "fs";
import csvParser from "csv-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// FIXED: Enhanced CORS configuration for ChatGPT
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'openai-conversation-id', 'openai-ephemeral-user-id'],
  credentials: true
}));

app.use(express.json());

// Add request logging to debug issues
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

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
      openapi: "GET /openapi.json",
      health: "GET /health"
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
    OPENAPI SPEC - FIXED
--------------------------------*/

app.get("/openapi.json", (req, res) => {
  // IMPORTANT: Update this URL to match your actual Render URL
  const serverUrl = process.env.SERVER_URL || "https://mcp-server-whjd.onrender.com";
  
  res.json({
    openapi: "3.1.0",
    info: {
      title: "Company Search API",
      description: "Search and retrieve company data by industry, revenue, employees, and more",
      version: "1.0.0"
    },
    servers: [
      {
        url: serverUrl
      }
    ],
    paths: {
      "/search-companies": {
        post: {
          operationId: "searchCompanies",
          summary: "Search companies with filters",
          description: "Search companies by industry, country, revenue, employees, etc. Returns matching companies based on your filter criteria.",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    filters: {
                      type: "array",
                      description: "Array of filter conditions to apply",
                      items: {
                        type: "object",
                        properties: {
                          field: { 
                            type: "string",
                            description: "Field name to filter on (e.g., 'industry', 'country', 'annual_revenue_usd')"
                          },
                          op: { 
                            type: "string", 
                            enum: ["eq", "contains", "gt", "lt"],
                            description: "Operation: eq=equals, contains=text contains, gt=greater than, lt=less than"
                          },
                          value: { 
                            type: "string",
                            description: "Value to filter by (use string format for all values)"
                          }
                        },
                        required: ["field", "op", "value"]
                      }
                    },
                    limit: { 
                      type: "integer", 
                      default: 10, 
                      minimum: 1, 
                      maximum: 100,
                      description: "Maximum number of results to return"
                    },
                    offset: { 
                      type: "integer", 
                      default: 0, 
                      minimum: 0,
                      description: "Number of results to skip (for pagination)"
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Search results with matching companies",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      total: { 
                        type: "integer",
                        description: "Total number of matching companies"
                      },
                      showing: { 
                        type: "integer",
                        description: "Number of companies in this response"
                      },
                      results: {
                        type: "array",
                        description: "Array of matching companies",
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
            },
            "400": {
              description: "Bad request - invalid filter format"
            }
          }
        }
      },
      "/company": {
        get: {
          operationId: "getCompany",
          summary: "Get a specific company by name",
          description: "Retrieve detailed information about a specific company by its exact name",
          parameters: [
            { 
              name: "name", 
              in: "query", 
              required: true, 
              schema: { type: "string" },
              description: "Exact company name to search for"
            }
          ],
          responses: {
            "200": { 
              description: "Company details",
              content: {
                "application/json": {
                  schema: {
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
              }
            },
            "404": { description: "Company not found" },
            "400": { description: "Company name parameter is required" }
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
  try {
    const { filters = [], limit = 10, offset = 0 } = req.body || {};

    let matched = companies.filter((row) => applyFilters(row, filters));
    matched = matched.map((r) => fillMissingFields(r));
    const page = matched.slice(offset, offset + limit);

    res.json({
      total: matched.length,
      showing: page.length,
      results: page
    });
  } catch (error) {
    console.error("Error in /search-companies:", error);
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

app.get("/company", (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: "Company name is required" });

    const found = companies.find(c => 
      (c.company_name || "").toLowerCase().trim() === name.toLowerCase().trim()
    );
    
    if (!found) return res.status(404).json({ error: "Company not found" });

    res.json(fillMissingFields(found));
  } catch (error) {
    console.error("Error in /company:", error);
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

/* ------------------------------
    MCP PROTOCOL ENDPOINTS
--------------------------------*/

app.get("/.well-known/manifest.json", (req, res) => {
  const filePath = path.join(__dirname, ".well-known", "manifest.json");
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "manifest.json not found" });
  }

  try {
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    res.json(content);
  } catch (err) {
    console.error("Error reading manifest.json:", err);
    res.status(500).json({ error: "Failed to read manifest.json" });
  }
});

app.get("/tools", (req, res) => {
  res.json({
    tools: [
      { 
        name: "search", 
        description: "Search companies with filters", 
        inputSchema: { 
          type: "object", 
          properties: { 
            filters: { type: "array" }, 
            limit: { type: "number" }, 
            offset: { type: "number" } 
          } 
        } 
      },
      { 
        name: "get_company", 
        description: "Get company by name", 
        inputSchema: { 
          type: "object", 
          properties: { 
            name: { type: "string" } 
          },
          required: ["name"]
        } 
      }
    ]
  });
});

app.post("/tools/call", (req, res) => {
  try {
    const { name, arguments: args } = req.body;

    if (name === "search") {
      const { filters = [], limit = 50, offset = 0 } = args || {};
      let matched = companies.filter((row) => applyFilters(row, filters));
      matched = matched.map((r) => fillMissingFields(r));
      const page = matched.slice(offset, offset + limit);
      return res.json({ 
        content: [{ 
          type: "text", 
          text: JSON.stringify({ 
            total: matched.length, 
            showing: page.length, 
            results: page 
          }, null, 2) 
        }] 
      });
    }

    if (name === "get_company") {
      const { name: companyName } = args || {};
      const found = companies.find(c => 
        (c.company_name || "").toLowerCase().trim() === companyName.toLowerCase().trim()
      );
      if (!found) {
        return res.json({ 
          content: [{ type: "text", text: "Company not found" }], 
          isError: true 
        });
      }
      return res.json({ 
        content: [{ 
          type: "text", 
          text: JSON.stringify(fillMissingFields(found), null, 2) 
        }] 
      });
    }

    res.status(400).json({ 
      content: [{ type: "text", text: `Tool '${name}' not found` }], 
      isError: true 
    });
  } catch (error) {
    console.error("Error in /tools/call:", error);
    res.status(500).json({ 
      content: [{ type: "text", text: `Error: ${error.message}` }], 
      isError: true 
    });
  }
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

function loadCSV(csvPath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    
    // Check if file exists
    if (!fs.existsSync(csvPath)) {
      return reject(new Error(`CSV file not found at: ${csvPath}`));
    }
    
    fs.createReadStream(csvPath)
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
        if (isNaN(actual) || Number(actual) <= Number(value)) 
          return false; 
        break;
      case "lt": 
        if (isNaN(actual) || Number(actual) >= Number(value)) 
          return false; 
        break;
    }
  }
  return true;
}

function fillMissingFields(row) {
  const filled = {};
  for (const key of Object.keys(row)) {
    filled[key] = row[key] === "" || row[key] === undefined || row[key] === null 
      ? "no_data" 
      : row[key];
  }
  return filled;
}

/* ------------------------------
    SERVER START
--------------------------------*/

const PORT = process.env.PORT || 4000;
const CSV_PATH = process.env.CSV_PATH || "./data/companies.csv";

console.log("🔍 Looking for CSV at:", CSV_PATH);

loadCSV(CSV_PATH)
  .then((rows) => {
    companies = rows;
    console.log("✅ Loaded", companies.length, "companies");
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log("🚀 Server listening on port", PORT);
      console.log("🌍 Server URL:", process.env.SERVER_URL || `http://localhost:${PORT}`);
      console.log("\n📍 Available Endpoints:");
      console.log("   GET  /              - API info");
      console.log("   GET  /health        - Health check");
      console.log("   GET  /openapi.json  - OpenAPI spec");
      console.log("   POST /search-companies - Search with filters");
      console.log("   GET  /company       - Get specific company");
      console.log("\n🔧 MCP Endpoints:");
      console.log("   GET  /.well-known/manifest.json");
      console.log("   GET  /tools");
      console.log("   POST /tools/call");
      console.log("   GET  /mcp");
    });
  })
  .catch((err) => {
    console.error("❌ Failed to load CSV:", err.message);
    console.error("Full error:", err);
    process.exit(1);
  });