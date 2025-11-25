import express from "express";
import fs from "fs";
import csvParser from "csv-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

let companies = [];

/* ------------ ROOT + HEALTH CHECK ----------- */

app.get("/", (req, res) => {
  res.send("MCP Company Server Running");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

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
            serverInfo: { name: "Company Search", version: "1.0" }
          }
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
                mimeType: "text/html+skybridge"
              }
            ]
          }
        });

      /* ---------- RESOURCES READ ---------- */
      case "resources/read": {
        const { uri } = params;

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
                  uri: "ui://company-profile",
                  mimeType: "text/html+skybridge",
                  text: html
                }
              ]
            }
          });
        }

        return res.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Unknown resource" }
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
                    name: { type: "string" }
                  },
                  required: ["name"]
                },
                outputSchema: {
                  type: "object",
                  properties: {
                    company: { type: "object" }
                  },
                  required: ["company"]
                },
                _meta: {
                  "openai/outputTemplate": "ui://company-profile"
                }
              }
            ]
          }
        });

      /* ---------- TOOLS CALL ---------- */
      case "tools/call": {
        const { name, arguments: args } = params;

        if (name === "get_company") {
          const target = args?.name?.toLowerCase().trim();

          const found = companies.find(
            x => (x.company_name || "").toLowerCase().trim() === target
          );

          if (!found) {
            return res.json({
              jsonrpc: "2.0",
              id,
              result: {
                content: [{ type: "text", text: "Company not found" }],
                isError: true
              }
            });
          }

          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                { type: "text", text: `Loaded company profile for **${found.company_name}**.` }
              ],
              structuredContent: {
                company: found
              },
              _meta: {
                "openai/outputTemplate": "ui://company-profile",
                "openai/toolInvocation/invoking": "Loading profile...",
                "openai/toolInvocation/invoked": "Profile loaded."
              }
            }
          });
        }
      }

      default:
        return res.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Unknown method" }
        });
    }
  } catch (err) {
    console.error(err);

    return res.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: "Internal error",
        data: err.message
      }
    });
  }
});

/* ------------ CSV LOAD + START SERVER ----------- */

function loadCSV(file) {
  return new Promise((resolve, reject) => {
    const arr = [];
    fs.createReadStream(file)
      .pipe(csvParser())
      .on("data", row => arr.push(row))
      .on("end", () => resolve(arr))
      .on("error", reject);
  });
}

const CSV_FILE = "./data/companies.csv";
const PORT = process.env.PORT || 4000;

loadCSV(CSV_FILE).then((rows) => {
  companies = rows;

  app.listen(PORT, () => {
    console.log("Server ready on port", PORT);
    console.log("MCP:", `http://localhost:${PORT}/mcp`);
  });
});
