import express from "express";
import path from "path";
import { createServer as createHttpServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Socket.io signaling logic
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("join-room", ({ roomName, userName }) => {
      socket.join(roomName);
      console.log(`User ${socket.id} (${userName}) joined room: ${roomName}`);
      
      // Notify others in the room
      socket.to(roomName).emit("user-joined", { userId: socket.id, userName });
    });

    socket.on("signal", ({ to, from, signal, userName }) => {
      io.to(to).emit("signal", { from, signal, userName });
    });

    socket.on("disconnect-from-room", (roomName) => {
      socket.leave(roomName);
      socket.to(roomName).emit("user-left", socket.id);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
