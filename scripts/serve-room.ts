import express from "express";
import path from "node:path";
const app = express();
const partners = ["BUYER", "SUPPLIER", "CARRIER"].map(
  (kind, i) =>
    process.env[`VITE_${kind}_ORIGIN`] || `http://localhost:${4174 + i}`,
);
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    `tools=(self ${partners.map((origin) => `"${origin}"`).join(" ")})`,
  );
  res.setHeader("Origin-Agent-Cluster", "?1");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${process.env.VITE_API_ORIGIN || "http://localhost:8787"}; frame-src ${partners.join(" ")}; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`,
  );
  next();
});
app.use(express.static(path.resolve("apps/room/dist")));
app.listen(Number(process.env.ROOM_WEB_PORT || 4173), () =>
  console.log("RelayRoom production UI ready"),
);
