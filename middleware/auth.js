const rateLimit = require("express-rate-limit");

const isTestEnv = process.env.NODE_ENV === "test";

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again later." },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
});

const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please try again in an hour." },
});

const maybeLoginLimiter = isTestEnv ? (req, res, next) => next() : loginLimiter;

// Authentication middlewares
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ message: "Please log in." });
  }
  if (req.session.user.mustReset) {
    return res.status(403).json({ message: "Password reset required.", code: "MUST_RESET" });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ message: "Please log in." });
    }
    if (req.session.user.mustReset) {
      return res.status(403).json({ message: "Password reset required.", code: "MUST_RESET" });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ message: "Not authorized." });
    }
    next();
  };
}

module.exports = {
  generalLimiter,
  loginLimiter,
  sensitiveLimiter,
  maybeLoginLimiter,
  requireAuth,
  requireRole,
  isTestEnv,
};
