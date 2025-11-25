import express from "express";
import fs from "fs";
import csvParser from "csv-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// CORS configuration for ChatGPT
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

/* ------------------------------
    ROOT & INFO ENDPOINTS
--------------------------------*/

app.get("/", (req, res) => {
  res.json({
    name: "Company Search MCP Server",
    version: "1.0.0",
    description: "MCP server for searching company data via ChatGPT",
    endpoints: {
      mcp: "POST /mcp (MCP protocol endpoint)",
      health: "GET /health",
      manifest: "GET /.well-known/manifest.json"
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
    MCP PROTOCOL ENDPOINT - FIXED
--------------------------------*/

// This is the main endpoint ChatGPT connects to
app.post("/mcp", async (req, res) => {
  try {
    const { method, params, id } = req.body;
    
    console.log(`MCP Request: ${method}`);
    
    // Handle MCP protocol methods
    switch (method) {
      case "initialize":
        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: "Company Search Server",
              version: "1.0.0"
            }
          }
        });

      case "tools/list":
        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              {
                name: "search_companies",
                description: "Search for companies using filters like industry, country, revenue, or employee count. Returns a list of matching companies.",
                inputSchema: {
                  type: "object",
                  properties: {
                    filters: {
                      type: "array",
                      description: "Array of filter conditions",
                      items: {
                        type: "object",
                        properties: {
                          field: {
                            type: "string",
                            description: "Field to filter on (e.g., 'industry', 'country', 'annual_revenue_usd', 'employee_count')"
                          },
                          op: {
                            type: "string",
                            enum: ["eq", "contains", "gt", "lt"],
                            description: "Operation: eq=equals, contains=text contains, gt=greater than, lt=less than"
                          },
                          value: {
                            type: "string",
                            description: "Value to filter by"
                          }
                        },
                        required: ["field", "op", "value"]
                      }
                    },
                    limit: {
                      type: "number",
                      description: "Maximum number of results (default 10, max 50)",
                      default: 10
                    },
                    offset: {
                      type: "number",
                      description: "Number of results to skip for pagination",
                      default: 0
                    }
                  }
                }
              },
              {
                name: "get_company",
                description: "Get detailed information about a specific company by exact name",
                inputSchema: {
                  type: "object",
                  properties: {
                    name: {
                      type: "string",
                      description: "Exact company name to retrieve"
                    }
                  },
                  required: ["name"]
                }
              }
            ]
          }
        });

      case "tools/call":
        const { name, arguments: args } = params;
        
        if (name === "search_companies") {
          const { filters = [], limit = 10, offset = 0 } = args || {};
          let matched = companies.filter((row) => applyFilters(row, filters));
          matched = matched.map((r) => fillMissingFields(r));
          
          // Limit to max 50
          const actualLimit = Math.min(limit, 50);
          const page = matched.slice(offset, offset + actualLimit);
          
          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    total: matched.length,
                    showing: page.length,
                    offset: offset,
                    results: page
                  }, null, 2)
                }
              ]
            }
          });
        }
        
        if (name === "get_company") {
          const { name: companyName } = args || {};
          if (!companyName) {
            return res.json({
              jsonrpc: "2.0",
              id,
              error: {
                code: -32602,
                message: "Company name is required"
              }
            });
          }
          
          const found = companies.find(c => 
            (c.company_name || "").toLowerCase().trim() === companyName.toLowerCase().trim()
          );
          
          if (!found) {
            return res.json({
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  {
                    type: "text",
                    text: `Company "${companyName}" not found in database.`
                  }
                ],
                isError: true
              }
            });
          }
          
          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(fillMissingFields(found), null, 2)
                }
              ]
            }
          });
        }
        
        // Unknown tool
        return res.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Tool '${name}' not found`
          }
        });

      case "notifications/initialized":
        // Client notification that initialization is complete
        return res.status(200).json({});

      default:
        return res.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method '${method}' not found`
          }
        });
    }
  } catch (error) {
    console.error("MCP Error:", error);
    return res.status(500).json({
      jsonrpc: "2.0",
      id: req.body.id,
      error: {
        code: -32603,
        message: "Internal server error",
        data: error.message
      }
    });
  }
});

/* ------------------------------
    MANIFEST FOR MCP DISCOVERY
--------------------------------*/

app.get("/.well-known/manifest.json", (req, res) => {
  res.json({
    schema_version: "v1",
    name: "Company Search",
    description: "Search and retrieve company data",
    mcp_server_url: process.env.SERVER_URL || "https://mcp-server-whjd.onrender.com/mcp"
  });
});

/* ------------------------------
    HELPER FUNCTIONS
--------------------------------*/

let companies = [];

function loadCSV(csvPath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    
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
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

console.log("🔍 Configuration:");
console.log("   CSV_PATH:", CSV_PATH);
console.log("   SERVER_URL:", SERVER_URL);

loadCSV(CSV_PATH)
  .then((rows) => {
    companies = rows;
    console.log("✅ Loaded", companies.length, "companies");
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log("\n🚀 MCP Server running!");
      console.log("   Port:", PORT);
      console.log("   MCP Endpoint:", `${SERVER_URL}/mcp`);
      console.log("\n📍 Use this URL in ChatGPT:");
      console.log("   " + `${SERVER_URL}/mcp`);
      console.log("\n💡 Setup in ChatGPT:");
      console.log("   1. Go to Settings → Connectors → Create");
      console.log("   2. Enter Connector URL:", `${SERVER_URL}/mcp`);
      console.log("   3. Name: Company Search");
      console.log("   4. Description: Search companies by industry, revenue, location");
    });
  })
  .catch((err) => {
    console.error("❌ Failed to load CSV:", err.message);
    console.error("Full error:", err);
    process.exit(1);
  });