// Import WebSocket library
import WebSocket, { WebSocketServer } from "ws";

// Create a WebSocket server
const wss = new WebSocketServer({ port: 8080 });

// Handle client connections
wss.on("connection", (ws) => {
    console.log("Client connected");

    // Handle incoming messages
    ws.on("message", (message) => {
        console.log(`Received: ${message}`);
        ws.send(`Echo: ${message}`);
    });

    // Handle client disconnection
    ws.on("close", () => {
        console.log("Client disconnected");
    });
});

console.log("WebSocket server is running on ws://localhost:8080");
