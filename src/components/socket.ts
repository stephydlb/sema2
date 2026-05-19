import { io } from "socket.io-client";

// In development, we use the window.location.origin to point to our dev server.
// In production, the client and server are hosted on the same origin.
const URL = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

export const socket = io(URL, {
  autoConnect: true,
  reconnection: true,
});
