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

// Root endpoint - ChatGPT checks this first
app.get("/", (req, res) => {
  res.json({
    name: "Company MCP Server",
    version: "1.0.0",
    description: "A company filtering MCP server that allows searching and retrieving company data.",
    endpoints: {
      manifest: "/.well-known/manifest.json",
      tools: "/tools",
      call: "/tools/call",
      health: "/health",
      debug: "/debug/files"
    },
    status: "running",
    companiesLoaded: companies.length
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy",
    companiesLoaded: companies.length,
    timestamp: new Date().toISOString()
  });
});

// Serve OpenAPI spec
app.get("/openapi.yaml", (req, res) => {
  const filePath = path.join(__dirname, "openapi.yaml");
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("OpenAPI spec not found");
  }
  
  res.setHeader('Content-Type', 'application/x-yaml');
  res.sendFile(filePath);
});

// Also serve as JSON
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
        url: "https://mcp-server-whjd.onrender.com",
        description: "Production server"
      }
    ],
    paths: {
      "/tools/call": {
        post: {
          summary: "Execute a tool",
          operationId: "callTool",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: {
                      type: "string",
                      enum: ["search", "get_company"]
                    },
                    arguments: {
                      type: "object"
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Successful response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      content: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            type: {
                              type: "string"
                            },
                            text: {
                              type: "string"
                            }
                          }
                        }
                      }
                    },
                    required: ["content"]
                  }
                }
              }
            }
          }
        }
      },
      "/get-company": {
        get: {
          summary: "Get company by name",
          operationId: "getCompanyByName",
          parameters: [
            {
              name: "name",
              in: "query",
              required: true,
              schema: {
                type: "string"
              }
            }
          ],
          responses: {
            "200": {
              description: "Company found",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      company: {
                        type: "object"
                      }
                    },
                    required: ["company"]
                  }
                }
              }
            }
          }
        }
      }
    }
  });
});

/* ------------------------------
    MCP MANIFEST
--------------------------------*/

app.get("/.well-known/manifest.json", (req, res) => {
  const filePath = path.join(__dirname, ".well-known", "manifest.json");
  console.log("Attempting to serve manifest.json from:", filePath);
  
  if (!fs.existsSync(filePath)) {
    console.error("File not found at:", filePath);
    return res.status(404).json({ error: "manifest.json not found" });
  }
  
  try {
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    res.json(content);
  } catch (err) {
    console.error("Error reading manifest.json:", err);
    res.status(500).json({ error: "Failed to read file" });
  }
});

/* ------------------------------
    MCP PROTOCOL ENDPOINTS
--------------------------------*/

// MCP: List tools
app.get("/tools", (req, res) => {
  res.json({
    tools: [
      {
        name: "search",
        description: "Search companies with filters. Supports filtering by any field using operators: eq (equals), contains (text search), gt (greater than), lt (less than). Can sort and paginate results.",
        inputSchema: {
          type: "object",
          properties: {
            filters: {
              type: "array",
              description: "Array of filter objects to apply",
              items: {
                type: "object",
                properties: {
                  field: { 
                    type: "string",
                    description: "Field name to filter on"
                  },
                  op: { 
                    type: "string", 
                    enum: ["eq", "contains", "gt", "lt"],
                    description: "Operator: eq=equals, contains=text search, gt=greater than, lt=less than"
                  },
                  value: {
                    description: "Value to filter by"
                  }
                },
                required: ["field", "op", "value"]
              }
            },
            limit: { 
              type: "number",
              description: "Maximum number of results to return (default: 50)"
            },
            offset: { 
              type: "number",
              description: "Number of results to skip for pagination (default: 0)"
            },
            sort: {
              type: "object",
              description: "Sort configuration",
              properties: {
                field: { 
                  type: "string",
                  description: "Field to sort by"
                },
                dir: { 
                  type: "string", 
                  enum: ["asc", "desc"],
                  description: "Sort direction: asc or desc"
                }
              }
            }
          }
        }
      },
      {
        name: "get_company",
        description: "Get detailed information about a specific company by name or ID",
        inputSchema: {
          type: "object",
          properties: {
            name: { 
              type: "string",
              description: "Company name (exact match, case-insensitive)"
            },
            id: { 
              type: "string",
              description: "Company ID"
            }
          }
        }
      }
    ]
  });
});

// MCP: Call a tool
app.post("/tools/call", (req, res) => {
  const { name, arguments: args } = req.body;

  // DEBUG LOGGING
  console.log("========================================");
  console.log("🔧 TOOL CALL RECEIVED");
  console.log("========================================");
  console.log("Full request body:", JSON.stringify(req.body, null, 2));
  console.log("Tool name:", name);
  console.log("Tool name type:", typeof name);
  console.log("Tool args:", JSON.stringify(args, null, 2));
  console.log("========================================");

  // Handle missing or invalid name
  if (!name) {
    console.error("❌ ERROR: Tool name is missing");
    return res.status(400).json({
      content: [
        {
          type: "text",
          text: "Error: Tool name is required. Request body: " + JSON.stringify(req.body)
        }
      ],
      isError: true
    });
  }

  if (name === "search") {
    console.log("✅ Executing 'search' tool");
    const { filters = [], limit = 50, offset = 0, sort = null } = args || {};
    
    console.log("Filters:", filters);
    console.log("Limit:", limit);
    
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
    
    console.log(`✅ Returning ${page.length} of ${matched.length} results`);
    
    return res.json({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            total: matched.length,
            showing: page.length,
            results: page
          }, null, 2)
        }
      ]
    });
  } 
  
  if (name === "get_company") {
    console.log("✅ Executing 'get_company' tool");
    const { name: companyName, id } = args || {};
    let found;

    if (id) {
      found = companies.find((c) => c.id === id || c.ID === id);
    } else if (companyName) {
      found = companies.find(
        (c) =>
          (c.company_name || "")
            .toLowerCase()
            .trim() === companyName.toLowerCase().trim()
      );
    }

    if (!found) {
      console.log("❌ Company not found");
      return res.json({
        content: [
          {
            type: "text",
            text: "Company not found"
          }
        ],
        isError: true
      });
    }

    console.log("✅ Company found:", found.company_name);
    
    return res.json({
      content: [
        {
          type: "text",
          text: JSON.stringify(fillMissingFields(found), null, 2)
        }
      ]
    });
  }
  
  // Tool not found
  console.error("❌ ERROR: Tool not found. Received name:", name);
  console.error("Available tools: search, get_company");
  
  return res.status(400).json({
    content: [
      {
        type: "text",
        text: `Tool '${name}' not found. Available tools: search, get_company. Received request: ${JSON.stringify(req.body)}`
      }
    ],
    isError: true
  });
});

/* ------------------------------
    LEGACY ENDPOINTS (Optional - for direct API access)
--------------------------------*/

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

/* ------------------------------
    DEBUG ENDPOINT
--------------------------------*/

app.get("/debug/files", (req, res) => {
  const manifestPath = path.join(__dirname, ".well-known", "manifest.json");
  
  res.json({
    __dirname,
    cwd: process.cwd(),
    manifestExists: fs.existsSync(manifestPath),
    manifestPath,
    companiesLoaded: companies.length,
    availableTools: ["search", "get_company"]
  });
});

/* ------------------------------
    CSV HELPER FUNCTIONS
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

/* ------------------------------
    SERVER START
--------------------------------*/

const PORT = process.env.PORT || 4000;
loadCSV(process.env.CSV_PATH || "./data/companies.csv")
  .then((rows) => {
    companies = rows;
    console.log("✅ Loaded", companies.length, "companies");
    app.listen(PORT, () => {
      console.log("🚀 MCP Server listening on port", PORT);
      console.log("📍 Endpoints:");
      console.log("   GET  /");
      console.log("   GET  /.well-known/manifest.json");
      console.log("   GET  /tools");
      console.log("   POST /tools/call");
      console.log("   GET  /health");
      console.log("   GET  /debug/files");
      console.log("   GET  /openapi.json");
    });
  })
  .catch((err) => {
    console.error("❌ Failed to load CSV:", err);
    process.exit(1);
  });