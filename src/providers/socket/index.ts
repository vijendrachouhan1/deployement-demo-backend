import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { corsOptions } from "@/config/cors";
import {
  ServerToClientEvents,
  TypedSocketIO,
  TypedSocket,
} from "@/providers/socket/utils/socket.types";

export class SocketService {
  private static io: TypedSocketIO | null = null;

  constructor(server?: HttpServer) {
    if (server && !SocketService.io) {
      SocketService.io = new SocketIOServer(server, {
        cors: {
          origin: corsOptions.origin,
          methods: ["GET", "POST"],
          credentials: true,
        },
      });

      this.setupSocketConnection();
    }
  }

  /**
   * Register connection events
   */
  private setupSocketConnection() {
    const io = SocketService.io;
    if (!io) return;

    io.on("connection", (socket: TypedSocket) => {
      const userId =
        socket.handshake.auth.userId || socket.handshake.query.userId;

      if (userId && typeof userId === "string") {
        socket.join(`user:${userId}`);
      } else {
        socket.disconnect(true);
      }
      socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
      });
    });
  }

  /**
   * Generic typed emitter for server -> client events
   */
  emit<K extends keyof ServerToClientEvents>(
    event: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    const io = SocketService.io;
    if (!io) throw new Error("Socket.IO server not initialized");

    io.emit(event, ...args);
  }

  /**
   * Emit to a specific room
   */
  emitToRoom<K extends keyof ServerToClientEvents>(
    roomId: string,
    event: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    const io = SocketService.io;
    if (!io) throw new Error("Socket.IO server not initialized");

    io.to(roomId).emit(event, ...args);
  }

  emitToUser<K extends keyof ServerToClientEvents>(
    userId: string,
    event: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ) {
    const io = SocketService.io;
    if (!io) throw new Error("Socket.IO server not initialized");

    io.to(`user:${userId}`).emit(event, ...args);
  }

  /**
   * Get current Socket.IO instance
   */
  static getIO(): TypedSocketIO {
    if (!SocketService.io) {
      throw new Error("Socket.IO server not initialized");
    }
    return SocketService.io;
  }
  static getClientSocket(clientId: string): TypedSocket | null {
    const io = SocketService.io;
    if (!io) throw new Error("Socket.IO server not initialized");

    const clientSocket = io.of("/").sockets.get(clientId);
    return clientSocket || null;
  }
}

export const socketService = new SocketService();
