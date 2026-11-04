// Auth Middleware — stateless JWT verify (Microsoft Entra / generic OIDC)
// Section 3 / 9 of SECURITY.md. No sticky sessions.
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

// Hard startup guard — must never allow dev auth in production
if (process.env.NODE_ENV === "production" && process.env.AUTH_MODE === "dev") {
  console.error("FATAL: AUTH_MODE=dev is not allowed when NODE_ENV=production");
  process.exit(1);
}

// JWKS client (cached)
let client = null;
if (process.env.AUTH_MODE === "msal" && process.env.MSAL_TENANT_ID) {
  const jwksUri = `https://login.microsoftonline.com/${process.env.MSAL_TENANT_ID}/discovery/v2.0/keys`;
  client = jwksClient({
    jwksUri,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 86400000,
  });
}

function getKey(header, callback) {
  if (!client) return callback(new Error("No JWKS client configured"));
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

function verifyToken(token) {
  return new Promise((resolve, reject) => {
    if (process.env.AUTH_MODE === "dev") {
      // Dev mode: accept a known test token for local development
      try {
        const payload = jwt.verify(token, "dev-secret", {
          algorithms: ["HS256"],
        });
        return resolve({
          userKey: payload.sub || payload.oid || "dev-user",
          email: payload.email || "dev@localhost",
          claims: payload,
        });
      } catch (e) {
        return reject(new Error("Invalid dev token"));
      }
    }

    const audience =
      process.env.API_AUDIENCE ||
      process.env.MSAL_CLIENT_ID ||
      "api://document-compression";
    const allowedTenants = process.env.ALLOWED_TENANTS
      ? process.env.ALLOWED_TENANTS.split(",").map((s) => s.trim())
      : null;

    jwt.verify(
      token,
      getKey,
      {
        algorithms: ["RS256"],
        audience,
        issuer: [
          `https://login.microsoftonline.com/common/v2.0`,
          process.env.MSAL_TENANT_ID
            ? `https://login.microsoftonline.com/${process.env.MSAL_TENANT_ID}/v2.0`
            : null,
        ].filter(Boolean),
        clockTolerance: 30,
      },
      (err, decoded) => {
        if (err) return reject(err);
        // Verify tenant if allowlist exists
        if (
          allowedTenants &&
          decoded.tid &&
          !allowedTenants.includes(decoded.tid)
        ) {
          return reject(new Error("Tenant not allowed"));
        }
        const userKey = `${decoded.tid}.${decoded.oid}`;
        resolve({
          userKey,
          email: decoded.preferred_username || decoded.email,
          claims: decoded,
        });
      },
    );
  });
}

function authMiddleware(req, res, next) {
  // Skip for webhook (billing notify) and health/ready (shallow checks)
  const skipPaths = [
    "/api/health",
    "/api/ready",
    "/api/billing/notify",
    "/api/dev/login",
  ];
  if (skipPaths.some((p) => req.path.startsWith(p))) return next();

  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token)
    return res.status(401).json({
      error: {
        code: "unauthorized",
        message: "Missing or invalid Authorization header",
      },
    });

  verifyToken(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch((err) => {
      res.status(401).json({
        error: {
          code: "unauthorized",
          message: err.message || "Token verification failed",
        },
      });
    });
}

module.exports = { authMiddleware, verifyToken };
