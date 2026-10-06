import express, { Application } from "express";
import compression from "compression";
import cors from "cors";
import status from "http-status";
import { createExpressMiddleware } from "agendash";
import type { Agenda } from "agenda";
import { Middleware } from "@/middleware/auth";
import { api } from "@/modules/api";
import { ErrorResponse } from "@/helpers/api-response";
import { globalErrorHandler } from "@/middleware/error-handler";
import { WebhookRouter } from "@/webhooks";
import rateLimiter from "@/middleware/rate-limiter";
import helmet from "helmet";
import { corsOptions } from "@/config/cors";
import apiConfig from "@/config/api";
import cookieParser from "cookie-parser";
import { requestClientPlatform } from "@/middleware/client-platform";
import { auditContextMiddleware } from "@/middleware/audit-context";

export const createApp = (agenda?: Agenda): Application => {
  try {
    const app = express();

    /**
     * ---------------------------------
     *            Middlewares
     * ---------------------------------
     */

    app.set("trust proxy", 1); // trust first proxy for rate limiting
    app.use(helmet());

    app.use(cors(corsOptions));

    app.use(auditContextMiddleware);

    app.use(
      express.urlencoded({
        extended: true,
        limit: apiConfig.API_MAX_URL_ENCODED_SIZE,
      }),
    );

    app.use(rateLimiter);
    app.use(requestClientPlatform);

    app.use("/webhook", new WebhookRouter().router);

    app.use(cookieParser());

    app.use(express.json({ limit: apiConfig.API_MAX_PAYLOAD_SIZE })); // Parsers for POST data

    /* Express 5 leaves req.body as undefined when a request carries no body;
       default it to an object so handlers can read req.body without guarding. */
    app.use((req, _res, next) => {
      if (req.body === undefined) req.body = {};
      next();
    });

    app.use(compression()); // for gzipping the request

    app.use("/api", api); // route prefix

    // System job dashboard (Agendash), reached via the Next.js proxy which forwards the auth cookie.
    if (agenda) {
      const middleware = new Middleware();
      app.use(
        "/admin/agendash",
        middleware.jwtDecoder,
        middleware.systemMiddleware,
        createExpressMiddleware(agenda),
      );
    }

    // Error handling routes
    app.use((_, res) => {
      return ErrorResponse(res, status.NOT_FOUND, {
        message: "Route Not Found",
      });
    });

    app.use(globalErrorHandler); // Global Error handler for logging requests

    return app;
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};
