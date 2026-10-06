import envConfig from "@/config/env";
import { CorsOptions } from "cors";

export const corsOptions: CorsOptions = {
  // Specify allowed origins
  origin: envConfig.ALLOWED_ORIGINS.split(","),

  // Allow specific HTTP methods
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],

  // Allow credentials (cookies, authorization headers, etc)
  credentials: true,
};
