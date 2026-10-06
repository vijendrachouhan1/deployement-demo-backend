import { Server as SocketIOServer, Socket } from "socket.io";

/**
 * Define all events your Socket.IO server can emit.
 * Extend this as your app grows.
 */
export interface ServerToClientEvents {
  "update-notifications-count": () => void;
}

/**
 * Define all events the server listens to from the client.
 * Extend this for custom client events.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ClientToServerEvents {
  //   "join-room": (roomId: string) => void;
  //   "leave-room"?: (roomId: string) => void;
}

export type TypedSocketIO = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents
>;

export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
