const rateLimit = require('express-rate-limit');

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

// Who is this request "from" for rate-limiting purposes?
//  * A signed-in user (valid access token) is counted PER USER, so a whole hostel / lab sharing one public IP no
//    longer uses up one common 120-requests-a-minute allowance ("Too many requests" for everybody at once).
//  * Everybody else falls back to the client IP. Tokens are verified, so forging one cannot dodge the limit.
function rateLimitKey(req) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, bearer] = header.split(' ');
    const token = (scheme === 'Bearer' && bearer) || (req.cookies && req.cookies.cp_access) || '';
    if (token) {
      const { verifyAccessToken } = require('../auth');
      const claims = verifyAccessToken(String(token));
      if (claims && claims.sub) return `u:${claims.sub}`;
    }
  } catch (_) { /* invalid / expired token: count it against the IP */ }
  return `ip:${req.ip}`;
}

function createApiRateLimiter() {
  const perUser = Number(process.env.API_RATE_LIMIT_PER_MINUTE || 10000);
  const perIp = Number(process.env.API_RATE_LIMIT_PER_IP_PER_MINUTE || 5000);
  return rateLimit({
    windowMs: 60 * 1000,
    max: (req) => (String(req.rateLimitKey || '').startsWith('u:') ? perUser : perIp),
    keyGenerator: (req) => { req.rateLimitKey = rateLimitKey(req); return req.rateLimitKey; },
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path === '/health/live' || req.path === '/health/ready' || req.path === '/ai-ml-status' || req.path === '/portal-auth/login' || /^\/portal-auth\/recovery\//.test(req.path) || (req.method === 'GET' && (/^\/storage\/kv(?:\/list)?$/.test(req.path) || /^\/sync\//.test(req.path))),
    handler: (req, res) => {
      const retryAfter = Number(res.getHeader('Retry-After')) || 10;
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'This service is temporarily busy. Please retry in a moment.' },
        retryAfterSeconds: retryAfter,
        requestId: req.requestId || null,
      });
    },
  });
}

// Cookie-authenticated state-changing requests need an origin check. Bearer-token API
// clients remain compatible because they can omit Origin; browsers using the HttpOnly
// auth cookies send Origin for state-changing requests.
function createCsrfOriginGuard() {
  const mutating = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  return (req, res, next) => {
    if (!mutating.has(req.method)) return next();
    const hasAuthCookie = Boolean(req.cookies?.cp_access || req.cookies?.cp_refresh);
    const origin = normalizeOrigin(req.get('origin'));
    if (!hasAuthCookie || !origin) return next();

    const configured = String(process.env.CORS_ORIGIN || '')
      .split(',').map(normalizeOrigin).filter(Boolean);
    const hostOrigin = normalizeOrigin(`${req.protocol}://${req.get('host')}`);
    if (configured.includes(origin) || origin === hostOrigin) return next();

    return res.status(403).json({
      success: false,
      error: { code: 'CSRF_ORIGIN_REJECTED', message: 'Request origin is not allowed.' },
      requestId: req.requestId || null,
    });
  };
}

module.exports = { createApiRateLimiter, createCsrfOriginGuard, rateLimitKey };
