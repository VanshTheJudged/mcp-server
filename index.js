import express from "express";
import fs from "fs";
import csvParser from "csv-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json());

let companies = [];

/* ------------ ROOT + HEALTH CHECK ----------- */

app.get("/", (req, res) => {
  res.send("MCP Company Server Running");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, companies: companies.length });
});

/* ------------ HELPERS ----------- */

function applyFilters(row, filters) {
  if (!filters || !Array.isArray(filters) || filters.length === 0) {
    return true;
  }

  for (const f of filters) {
    const field = f.field;
    const op = f.op;
    const value = f.value;

    // If CSV doesn't have this column → discard that filter
    if (!Object.prototype.hasOwnProperty.call(row, field)) {
      continue;
    }

    const actual = row[field];

    // Text operations
    if (op === "eq") {
      if (String(actual) !== String(value)) return false;
    } else if (op === "contains") {
      if (
        !String(actual).toLowerCase().includes(String(value).toLowerCase())
      ) {
        return false;
      }
    }
    // Numeric operations (gt / lt)
    else if (op === "gt" || op === "lt") {
      const numActual = Number(actual);
      const numValue = Number(value);
      if (Number.isNaN(numActual) || Number.isNaN(numValue)) {
        // If not numeric, ignore this filter
        continue;
      }
      if (op === "gt" && !(numActual > numValue)) return false;
      if (op === "lt" && !(numActual < numValue)) return false;
    }
  }

  return true;
}

/* ------------ MCP ENDPOINT ----------- */

app.post("/mcp", async (req, res) => {
  const { method, params, id } = req.body;

  try {
    switch (method) {
      /* ---------- INITIALIZATION ---------- */
      case "initialize":
        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: "Company Search", version: "1.0" },
          },
        });

      /* ---------- RESOURCES LIST ---------- */
      case "resources/list":
        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            resources: [
              {
                uri: "ui://company-profile",
                name: "Company Profile UI",
                mimeType: "text/html+skybridge",
              },
              {
                uri: "ui://company-table",
                name: "Company Table UI",
                mimeType: "text/html+skybridge",
              },
            ],
          },
        });

      /* ---------- RESOURCES READ ---------- */
      case "resources/read": {
        const { uri } = params || {};

        if (uri === "ui://company-profile") {
          const html = fs.readFileSync(
            path.join(__dirname, "CompanyProfile.html"),
            "utf8"
          );
          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: "text/html+skybridge",
                  text: html,
                },
              ],
            },
          });
        }

        if (uri === "ui://company-table") {
          const html = fs.readFileSync(
            path.join(__dirname, "CompanyTable.html"),
            "utf8"
          );
          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: "text/html+skybridge",
                  text: html,
                },
              ],
            },
          });
        }

        return res.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Unknown resource: ${uri}` },
        });
      }

      /* ---------- TOOLS LIST ---------- */
      case "tools/list":
        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              {
                name: "get_company",
                description: "Get company by exact name.",
                inputSchema: {
                  type: "object",
                  properties: {
                    name: {
                      type: "string",
                      description: "Exact company_name value from the CSV.",
                    },
                  },
                  required: ["name"],
                },
                outputSchema: {
                  type: "object",
                  properties: {
                    company: { type: "object" },
                  },
                  required: ["company"],
                },
                _meta: {
                  "openai/outputTemplate": "ui://company-profile",
                },
              },
              {
                name: "search_companies",
                description:
                  "Search companies using dynamic filters on CSV columns (e.g., revenue, employees, industry, country). Filters with unknown fields are ignored.",
                inputSchema: {
                  type: "object",
                  properties: {
                    filters: {
                      type: "array",
                      description:
                        "Array of filter conditions. Unknown fields are discarded.",
                      items: {
                        type: "object",
                        properties: {
                          field: {
                            type: "string",
                            description:
                              "CSV column name (e.g. 'annual_revenue_usd', 'employee_count', 'industry', 'company_name').",
                          },
                          op: {
                            type: "string",
                            description:
                              "Operation: eq, contains, gt, lt. gt/lt are numeric.",
                            enum: ["eq", "contains", "gt", "lt"],
                          },
                          value: {
                            type: "string",
                            description: "Value to compare against.",
                          },
                        },
                        required: ["field", "op", "value"],
                      },
                    },
                    limit: {
                      type: "integer",
                      description: "Max number of results to return (max 50).",
                      default: 10,
                    },
                    offset: {
                      type: "integer",
                      description:
                        "Number of results to skip (for pagination).",
                      default: 0,
                    },
                  },
                },
                outputSchema: {
                  type: "object",
                  properties: {
                    results: { type: "array", items: { type: "object" } },
                    total: { type: "integer" },
                    limit: { type: "integer" },
                    offset: { type: "integer" },
                  },
                  required: ["results", "total"],
                },
                _meta: {
                  "openai/outputTemplate": "ui://company-table",
                },
              },
            ],
          },
        });

      /* ---------- TOOLS CALL ---------- */
      case "tools/call": {
        const { name, arguments: args } = params || {};

        /* --- get_company (keep working behaviour) --- */
        if (name === "get_company") {
          const target = args?.name?.toLowerCase().trim();
          if (!target) {
            return res.json({
              jsonrpc: "2.0",
              id,
              error: {
                code: -32602,
                message: "Missing required argument: name",
              },
            });
          }

          const found = companies.find(
            (x) => (x.company_name || "").toLowerCase().trim() === target
          );

          if (!found) {
            return res.json({
              jsonrpc: "2.0",
              id,
              result: {
                content: [{ type: "text", text: "Company not found." }],
                isError: true,
              },
            });
          }

          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `Loaded company profile for **${found.company_name}**.`,
                },
              ],
              structuredContent: {
                company: found,
              },
              _meta: {
                "openai/outputTemplate": "ui://company-profile",
                "openai/toolInvocation/invoking": "Loading profile...",
                "openai/toolInvocation/invoked": "Profile loaded.",
              },
            },
          });
        }

        /* --- search_companies (new tool) --- */
        if (name === "search_companies") {
          const filters = Array.isArray(args?.filters) ? args.filters : [];
          const rawLimit =
            typeof args?.limit === "number" ? args.limit : 10;
          const rawOffset =
            typeof args?.offset === "number" ? args.offset : 0;

          const limit = Math.min(Math.max(rawLimit, 1), 50);
          const offset = Math.max(rawOffset, 0);

          const filtered = companies.filter((row) =>
            applyFilters(row, filters)
          );

          const total = filtered.length;
          const page = filtered.slice(offset, offset + limit);

          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text:
                    total === 0
                      ? "No companies matched those filters."
                      : `Found **${total}** companies. Showing **${page.length}** (offset ${offset}).`,
                },
              ],
              structuredContent: {
                results: page,
                total,
                limit,
                offset,
              },
              _meta: {
                "openai/outputTemplate": "ui://company-table",
                "openai/toolInvocation/invoking": "Searching companies...",
                "openai/toolInvocation/invoked": "Loaded search results.",
              },
            },
          });
        }

        // Unknown tool
        return res.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${name}` },
        });
      }

      default:
        return res.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown method: ${method}` },
        });
    }
  } catch (err) {
    console.error("MCP error:", err);
    return res.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: "Internal error",
        data: err.message,
      },
    });
  }
});

/* ------------ CSV LOAD + START SERVER ----------- */

function loadCSV(file) {
  return new Promise((resolve, reject) => {
    const arr = [];
    fs.createReadStream(file)
      .pipe(csvParser())
      .on("data", (row) => arr.push(row))
      .on("end", () => resolve(arr))
      .on("error", reject);
  });
}

const CSV_FILE = "./data/companies.csv";
const PORT = process.env.PORT || 4000;

loadCSV(CSV_FILE)
  .then((rows) => {
    companies = rows;
    console.log("Loaded companies:", companies.length);

    app.listen(PORT, () => {
      console.log("Server ready on port", PORT);
      console.log("MCP:", `http://localhost:${PORT}/mcp`);
    });
  })
  .catch((err) => {
    console.error("Failed to load CSV:", err);
    process.exit(1);
  });
