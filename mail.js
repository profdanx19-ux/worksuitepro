const net = require("net");
const tls = require("tls");

function mailConfig() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.INVOICE_FROM || user;
  const to = process.env.INVOICE_TO || "support@worksute-kit.online";
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  if (!host || !user || !pass || !from || !to) {
    return null;
  }
  return { host, port, user, pass, from, to, secure };
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";

    function finish(error, value) {
      socket.off("data", onData);
      socket.off("error", onError);
      if (error) reject(error);
      else resolve(value);
    }

    function onError(error) {
      finish(error);
    }

    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r\n/).filter((line) => line.length > 0);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last)) return;
      const code = Number(last.slice(0, 3));
      if (code >= 400) finish(new Error(buffer.trim()));
      else finish(null, buffer);
    }

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

function sendCommand(socket, command) {
  const pending = readResponse(socket);
  socket.write(`${command}\r\n`);
  return pending;
}

function connect(host, port, secure) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host }, () => resolve(socket))
      : net.connect({ host, port }, () => resolve(socket));
    socket.once("error", reject);
  });
}

function upgrade(socket, host) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: host }, () => resolve(secure));
    secure.once("error", reject);
  });
}

function safeHeader(value) {
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

function messageBody(record, from, to) {
  const lines = [
    `From: ${safeHeader(from)}`,
    `To: ${safeHeader(to)}`,
    `Subject: Invoice request: ${safeHeader(record.toolName)} ($${record.amount})`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `Name: ${record.name}`,
    `Email: ${record.email}`,
    `Tool: ${record.toolName}`,
    `Price: $${record.amount}`,
    `Note: ${record.note || "(none)"}`,
    `Received: ${record.createdAt}`,
  ];
  return lines
    .join("\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

async function deliver(config, record) {
  let socket = await connect(config.host, config.port, config.secure);
  await readResponse(socket);
  await sendCommand(socket, "EHLO worksuitepro.local");

  if (!config.secure) {
    await sendCommand(socket, "STARTTLS");
    socket = await upgrade(socket, config.host);
    await sendCommand(socket, "EHLO worksuitepro.local");
  }

  await sendCommand(socket, "AUTH LOGIN");
  await sendCommand(socket, Buffer.from(config.user).toString("base64"));
  await sendCommand(socket, Buffer.from(config.pass).toString("base64"));
  await sendCommand(socket, `MAIL FROM:<${config.from}>`);
  await sendCommand(socket, `RCPT TO:<${config.to}>`);
  await sendCommand(socket, "DATA");
  const accepted = readResponse(socket);
  socket.write(`${messageBody(record, config.from, config.to)}\r\n.\r\n`);
  await accepted;
  await sendCommand(socket, "QUIT");
  socket.end();
}

async function sendInvoiceEmail(record) {
  const config = mailConfig();
  if (!config) {
    return { sent: false, reason: "not-configured" };
  }
  await deliver(config, record);
  return { sent: true };
}

module.exports = { mailConfig, sendInvoiceEmail };
