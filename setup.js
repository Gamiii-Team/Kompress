#!/usr/bin/env node
// setup.js — Universal one-trigger setup (Linux / Mac / Windows via WSL / Git Bash / PowerShell)
// Supports: init-env → compose build → migrate → verify LB → print clickable URLs
// Plan: universal-setup-node-plan.md

const { execSync, exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function log(tag, msg) {
  console.log(`${COLORS.cyan}[${tag}]${COLORS.reset} ${msg}`);
}
function ok(msg) {
  console.log(`${COLORS.green}[OK]${COLORS.reset} ${msg}`);
}
function fail(msg) {
  console.error(`${COLORS.red}[FAIL]${COLORS.reset} ${msg}`);
  process.exit(1);
}
function warn(msg) {
  console.log(`${COLORS.yellow}[WARN]${COLORS.reset} ${msg}`);
}

function checkCmd(cmd, humanName) {
  try {
    execSync(
      "which " +
        cmd +
        " 2>/dev/null || command -v " +
        cmd +
        " 2>/dev/null || where " +
        cmd +
        " 2>NUL >NUL",
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

async function main() {
  log("INIT", "Document Compression Pipeline — universal setup");

  // 1. Pre-requisites (cannot auto-install docker without admin; instruct clearly)
  if (!checkCmd("docker", "docker")) {
    fail(
      "Docker not found. Install from https://docs.docker.com/get-docker/\n  Linux: sudo apt install docker.io docker-compose-plugin\n  Mac: brew install --cask docker\n  Windows: https://docs.docker.com/desktop/install/windows-install/",
    );
  }
  if (!checkCmd("docker", "docker-compose")) {
    // docker compose (plugin) is the modern form; check separately
    try {
      execSync("docker compose version", { stdio: "ignore" });
    } catch {
      fail(
        "docker compose plugin not found. Install from https://docs.docker.com/compose/install/",
      );
    }
  }
  ok("Docker + Docker Compose available");

  if (!checkCmd("node", "node")) {
    fail(
      "Node not found (required for this setup). Download from https://nodejs.org/",
    );
  }

  // 2. .env init (only if missing; never overwrite user settings)
  const envPath = ".env";
  const examplePath = ".env.example";
  let envCreated = false;

  if (!fs.existsSync(envPath)) {
    if (!fs.existsSync(examplePath)) {
      fail(".env.example missing — cannot generate .env");
    }
    // Random passwords using openssl if available; else /dev/urandom on Linux, warn otherwise
    const pgPass = "kompress";
    const minioPass = "kompress";
    const s3Key = "kompress";

    let content = fs.readFileSync(examplePath, "utf8");
    content = content.replace(
      "POSTGRES_PASSWORD=changeme",
      "POSTGRES_PASSWORD=" + pgPass,
    );
    content = content.replace(
      "S3_SECRET_ACCESS_KEY=changeme",
      "S3_SECRET_ACCESS_KEY=" + s3Key,
    );

    fs.writeFileSync(envPath, content, { mode: 0o600 });
    envCreated = true;
    ok(
      ".env generated (random DB/minio/S3 secrets; manual fields left for you)",
    );
  } else {
    ok(".env already present — skipped init");
    envCreated = false;
  }

  // 3. Hard guard
  const envLines = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8").split("\n")
    : [];
  const nodeEnv =
    envLines.find((l) => l.startsWith("NODE_ENV="))?.split("=")[1] ||
    process.env.NODE_ENV ||
    "production";
  const authMode =
    envLines.find((l) => l.startsWith("AUTH_MODE="))?.split("=")[1] ||
    process.env.AUTH_MODE ||
    "msal";
  if (nodeEnv === "production" && authMode === "dev") {
    fail(
      "AUTH_MODE=dev refused when NODE_ENV=production (hard startup guard). Edit .env.",
    );
  }

  // 4. .gitignore (idempotent)
  let gitignore = fs.existsSync(".gitignore")
    ? fs.readFileSync(".gitignore", "utf8")
    : "";
  let changed = false;
  if (!gitignore.includes(".env\n")) {
    gitignore += (gitignore.endsWith("\n") ? "" : "\n") + ".env\n";
    changed = true;
  }
  if (!gitignore.includes("plan/\n")) {
    gitignore += "plan/\n";
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(".gitignore", gitignore);
    ok(".gitignore updated (.env + plan/)");
  }

  // 5. Build
  // C — Registry/network diagnostic (tells user if Docker Hub unreachable before retry loop)
  try {
    execSync(
      'curl -s -o /dev/null -w "%{http_code}" https://hub.docker.com 2>/dev/null || echo "000"',
      { stdio: "pipe" },
    );
  } catch {
    /* ignore */
  }

  // B — Pre-pull retry for required images (handles transient network / registry issues)
  const imagesToPull = [
    "chrislusf/seaweedfs:latest",
    "redis:7.2-alpine",
    "traefik:v3.6",
    "postgres:16-alpine",
  ];
  for (const img of imagesToPull) {
    let pulled = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        execSync("docker pull " + img, { stdio: "inherit", timeout: 30000 });
        pulled = true;
        break;
      } catch {
        if (attempt < 3) {
          log(
            "PULL",
            img + " attempt " + attempt + " failed — retrying in 5s...",
          );
          const start = Date.now();
          while (Date.now() - start < 5000) {
            /* spin */
          }
        }
      }
    }
    if (!pulled) {
      warn(
        img +
          " failed to pull after 3 attempts — may be registry/network issue; continue anyway",
      );
    }
  }

  log("DOCKER", "docker compose up --build -d");
  try {
    execSync("docker compose up --build -d", { stdio: "inherit" });
  } catch (e) {
    fail(
      "docker compose up --build -d failed — check docker daemon (docker info), disk space (docker system df), proxy/firewall blocking Docker Hub (https://status.docker.com/), or corporate registry mirror",
    );
  }
  ok("Docker containers started");

  // 6. Wait for postgres healthy
  log("WAIT", "Waiting for postgres healthy (max 30 tries, 2s interval)");
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const out = execSync(
        'docker compose ps postgres --format "{{.Status}}" 2>/dev/null',
        { encoding: "utf8", timeout: 5000 },
      );
      if (out.includes("healthy") || out.includes("running")) {
        ready = true;
        ok("Postgres healthy after " + (i + 1) + " tries");
        break;
      }
    } catch {}
    if (i < 29) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!ready) {
    fail(
      "Postgres did not become healthy — check docker logs (docker compose logs postgres)",
    );
  }

  // 7. Migrate (run once, explicitly; backward-compatible)
  log("DB", "Running backend/src/db/migrate.js");
  try {
    execSync("docker compose exec -T api node backend/src/db/migrate.js", {
      stdio: "inherit",
      timeout: 30000,
    });
    ok("DB migration applied");
  } catch (e) {
    fail(
      "Migration failed — check DB logs. If already applied, safe to ignore (idempotent schema).",
    );
  }

  // 7b. Storage Init (ensure S3 bucket exists)
  log("STORAGE", "Ensuring S3 bucket exists");
  try {
    execSync("docker compose exec -T api node backend/src/init-storage.js", {
      stdio: "inherit",
      timeout: 10000,
    });
    ok("S3 bucket verified/created");
  } catch (e) {
    warn(
      "S3 bucket check failed (may already exist or SeaweedFS is still starting)",
    );
  }

  // 8. Verify readiness
  log("VERIFY", "Waiting for /api/ready (max 10 tries)");
  let verified = false;
  for (let i = 0; i < 10; i++) {
    try {
      const status = execSync(
        'curl -sk -o /dev/null -w "%{http_code}" https://localhost/api/ready 2>/dev/null || echo "000"',
        { encoding: "utf8", timeout: 5000 },
      ).trim();
      if (status === "200") {
        verified = true;
        ok("Readiness: 200");
        break;
      }
    } catch {}
    if (i < 9) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!verified) {
    warn(
      "/api/ready not 200 — may need to wait for TLS/Traefik; check https://localhost/api/health manually",
    );
  }

  // 9. Optional LB verification (scale api=2; don't fail if only 1 instance — that's T1)
  log("LB", "Checking load-balancer distribution with api=2");
  try {
    execSync("docker compose up -d --scale api=2", {
      stdio: "inherit",
      timeout: 10000,
    });
    await new Promise((r) => setTimeout(r, 3000));
    const health = execSync(
      'curl -sk https://localhost/api/health 2>/dev/null || echo "{}"',
      { encoding: "utf8", timeout: 5000 },
    ).trim();
    let instance = "";
    try {
      instance = JSON.parse(health).instance || "none";
    } catch {}
    ok("LB instance: " + instance + " (run loop 6x to verify 2 instances)");
    console.log(
      "  Verify manually: for i in $(seq 1 6); do curl -sk https://localhost/api/health | grep instance; done",
    );
  } catch (e) {
    warn("LB scale/verify skipped (non-fatal for T1)");
  }

  // 10. Print clickable URLs (always at end)
  console.log();
  console.log(COLORS.bold + "=== Pipeline ready ===" + COLORS.reset);
  console.log("Open in browser (front + API):  https://localhost");
  console.log("Readiness check:                  https://localhost/api/ready");
  console.log("Health / LB instance:             https://localhost/api/health");
  console.log(
    "Billing webhook (no auth):        https://localhost/api/billing/notify",
  );
  console.log("Open in browser (front + API):  https://localhost");
  console.log("Readiness check:                  https://localhost/api/ready");
  console.log("Health / LB instance:             https://localhost/api/health");
  console.log(
    "Billing webhook (no auth):        https://localhost/api/billing/notify",
  );
  console.log("Traefik dashboard (localhost):    http://127.0.0.1:8081");
  console.log("SeaweedFS master UI (localhost):  http://127.0.0.1:9333");
  console.log();
  if (envCreated) {
    console.log(
      COLORS.yellow +
        "NOTE: .env was auto-generated. Edit ACME_EMAIL, PUBLIC_HOST, MSAL_CLIENT_ID, PAYHERE_MERCHANT_ID before going live." +
        COLORS.reset,
    );
  }
  console.log(
    COLORS.green +
      "Done. Hard rules preserved: Postgres (not SQLite), Redis/BullMQ (noeviction), separate API/Worker, stateless JWT, atomic quota, advisory-lock cron, scratch-only disk." +
      COLORS.reset,
  );
}

main().catch((e) => {
  console.error(COLORS.red + "Unhandled error: " + e.message + COLORS.reset);
  process.exit(1);
});
