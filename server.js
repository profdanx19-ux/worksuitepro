const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const port = Number(process.env.PORT) || 3000;
const publicDir = path.resolve(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "invoices.json");

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

async function readInvoices() {
  try {
    const parsed = JSON.parse(await fs.readFile(dataFile, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

const plans = {
  "79": 79,
  "29": 29,
  "35": 35,
};

async function saveInvoice(email, amount) {
  const invoices = await readInvoices();
  const record = {
    id: Date.now().toString(36),
    email,
    amount,
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
  const amount = plans[String(body.plan)];
  if (!amount) {
    send(res, 400, JSON.stringify({ error: "Choose a price." }));
    return;
  }
  if (!isEmail(email)) {
    send(res, 400, JSON.stringify({ error: "Enter a valid email address." }));
    return;
  }

  try {
    const record = await saveInvoice(email, amount);
    send(
      res,
      201,
      JSON.stringify({
        ok: true,
        id: record.id,
        message: "Invoice request received. We will email you within 1 business hour.",
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

server.listen(port, () => {
  console.log(`WorkSuite Pro running at http://localhost:${port}`);
});
