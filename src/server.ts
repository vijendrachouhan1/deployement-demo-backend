import http from "http";
import mongoose from "mongoose";
import { createApp } from "@/app";
import envConfig from "@/config/env";
import { connectDB } from "@/db/index";
import { agendaService } from "@/agenda/agenda.service";
import { SocketService } from "@/providers/socket";
import "@/providers/audit-logs";

async function bootstrap() {
  try {
    await connectDB();

    // Guard so a dashboard failure can't block API boot.
    const agenda =
      mongoose.connection.readyState === 1
        ? agendaService.init({ enableNotifications: false })
        : undefined;

    const app = createApp(agenda);

    app.set("port", envConfig.PORT);

    // Using separate http module for creating server to have
    // advanced control over behavior of server
    const server = http.createServer(app);

    const socketService = new SocketService(server);

    // Store socket service in app for global access
    app.set("socketService", socketService);

    server.listen(envConfig.PORT, () =>
      console.info(`API running on localhost:${envConfig.PORT}`),
    );
  } catch (err) {
    console.error(err, "Error in Server File");
    process.exit(1);
  }
}

bootstrap();
