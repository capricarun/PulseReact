const jwt = require('jsonwebtoken');

function readToken(req) {
  const header = req.headers.authorization;
  return header && header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Blocks the request unless a valid JWT is present.
function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Populates req.user when a valid token is present, but never blocks the request.
function optionalAuth(req, res, next) {
  const token = readToken(req);
  req.user = null;
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      req.user = null;
    }
  }
  next();
}

function signToken(user) {
  return jwt.sign({ id: user.id, name: user.name, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: '24h',
  });
}

module.exports = { requireAuth, optionalAuth, signToken };
