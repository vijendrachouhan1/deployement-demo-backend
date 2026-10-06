import apiConfig from "@/config/api";
import { rateLimit } from "express-rate-limit";

const rateLimiter = rateLimit({
  windowMs: apiConfig.RATE_LIMIT_WINDOW_MS,
  limit: apiConfig.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: apiConfig.RATE_LIMIT_DEFAULT_MESSAGE,
  // Exempt the admin job dashboard: it polls too frequently for this limit.
  skip: (req) => req.path.startsWith("/admin/agendash"),
});

export default rateLimiter;
