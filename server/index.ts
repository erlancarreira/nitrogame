import { createServer, IncomingMessage, ServerResponse } from "http";
import { Server } from "socket.io";
import { setupSocketIO } from "./socket-logic";
import * as fs from "fs";
import * as path from "path";

const PORT = Number(process.env.PORT) || 3001;
const LOGS_DIR = path.join(process.cwd(), "logs");

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR);
}

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === "/logs" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body); // Validate JSON
        const filename = `debug-${new Date().toISOString().replace(/:/g, "-")}.json`;
        const filepath = path.join(LOGS_DIR, filename);
        fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
        console.log(`[server] Saved logs to ${filepath}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, filename }));
      } catch (e) {
        console.error("[server] Failed to save logs", e);
        res.writeHead(500);
        res.end(JSON.stringify({ error: "Failed to save logs" }));
      }
    });
    return;
  }

  // Default handler (if any)
  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

setupSocketIO(io);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] Nitro Rush game server listening on port ${PORT}`);
  console.log(`[server] Logging endpoint active at http://localhost:${PORT}/logs`);
});
