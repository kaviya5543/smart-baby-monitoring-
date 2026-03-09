import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public")); // serve baby.html, mother.html, etc.

io.on("connection", (socket) => {
    console.log("A user connected");

    socket.on("join-room", (code) => {
        socket.join(code);
        console.log("Joined room:", code);
    });

    socket.on("offer", (data) => {
        socket.to(data.code).emit("offer", data.offer);
    });

    socket.on("answer", (data) => {
        socket.to(data.code).emit("answer", data.answer);
    });

    socket.on("ice-candidate", (data) => {
        socket.to(data.code).emit("ice-candidate", data.candidate);
    });

    socket.on("disconnect", () => {
        console.log("User disconnected");
    });
});

server.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});