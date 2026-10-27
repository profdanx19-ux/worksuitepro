const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { sendInvoiceEmail } = require("./mail");

const port = Number(process.env.PORT) || 3000;
const publicDir = path.resolve(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "invoices.json");
const catalogFile = path.join(__dirname, "content", "tools.json");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 16 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function loadEnv() {
  let raw;
  try {
    raw = await fs.readFile(path.join(__dirname, ".env"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function readInvoices() {
  let raw;
  try {
    raw = await fs.readFile(dataFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const text = raw.trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Invoice file was unreadable. Starting a new one.", error.message);
    await fs.rename(dataFile, `${dataFile}.broken-${Date.now()}`).catch(() => {});
    return [];
  }
}

async function readCatalog() {
  const parsed = JSON.parse(await fs.readFile(catalogFile, "utf8"));
  if (!parsed || !Array.isArray(parsed.tools)) {
    throw new Error("Tool catalog is missing a tools list.");
  }
  return parsed;
}

function findSaleTool(catalog, toolId) {
  return catalog.tools.find(
    (tool) => tool.id === toolId && tool.forSale === true && Number.isFinite(tool.price)
  );
}

async function saveInvoice(entry) {
  const invoices = await readInvoices();
  const record = {
    id: Date.now().toString(36),
    ...entry,
    createdAt: new Date().toISOString(),
  };
  invoices.push(record);
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(invoices, null, 2));
  return record;
}

async function handleInvoice(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    send(res, 400, JSON.stringify({ error: "Could not read the request." }));
    return;
  }

  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const note = String(body.note || "").trim();
  const toolId = String(body.toolId || "").trim();

  if (!name || name.length > 80) {
    send(res, 400, JSON.stringify({ error: "Enter your name." }));
    return;
  }
  if (!isEmail(email)) {
    send(res, 400, JSON.stringify({ error: "Enter a valid email address." }));
    return;
  }
  if (note.length > 500) {
    send(res, 400, JSON.stringify({ error: "Keep the note under 500 characters." }));
    return;
  }

  let tool;
  try {
    tool = findSaleTool(await readCatalog(), toolId);
  } catch (error) {
    console.error(error);
    send(res, 500, JSON.stringify({ error: "Could not read the tool list." }));
    return;
  }
  if (!tool) {
    send(res, 400, JSON.stringify({ error: "Choose a tool." }));
    return;
  }

  try {
    const record = await saveInvoice({
      name,
      email,
      note,
      toolId: tool.id,
      toolName: tool.name,
      amount: tool.price,
    });
    try {
      const mailed = await sendInvoiceEmail(record);
      if (!mailed.sent) {
        console.warn("Invoice saved locally. Set SMTP values in .env to email support@worksute-kit.online.");
      }
    } catch (error) {
      console.error("Invoice was saved, but the email could not be sent.", error);
    }
    send(
      res,
      201,
      JSON.stringify({
        ok: true,
        id: record.id,
        message: `Invoice request received for ${tool.name} ($${tool.price}). We will email you within 24 business hours.`,
      })
    );
  } catch (error) {
    console.error(error);
    send(res, 500, JSON.stringify({ error: "Could not save the invoice request." }));
  }
}

async function handleStatic(req, res, pathname) {
  const rel = (pathname === "/" ? "index.html" : pathname).replace(/^[/\\]+/, "");
  const filePath = path.resolve(publicDir, rel);
  const relative = path.relative(publicDir, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const type = types[path.extname(filePath)] || "application/octet-stream";
    send(res, 200, file, type);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    console.error(error);
    send(res, 500, "Server error", "text/plain; charset=utf-8");
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/catalog") {
    readCatalog()
      .then((catalog) => send(res, 200, JSON.stringify(catalog)))
      .catch((error) => {
        console.error(error);
        send(res, 500, JSON.stringify({ error: "Could not read the tool list." }));
      });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/invoice") {
    handleInvoice(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    handleStatic(req, res, decodeURIComponent(url.pathname));
    return;
  }

  send(res, 405, JSON.stringify({ error: "Method not allowed." }));
});

loadEnv()
  .then(() => {
    server.listen(port, () => {
      console.log(`WorkSuite Pro running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
