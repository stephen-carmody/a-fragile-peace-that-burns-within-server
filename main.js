import { createSocketManager } from "./socketManager.js";
import { createClientManager } from "./clientManager.js";

// Create the client manager
const clientManager = createClientManager({
    keepAliveTimeout: 30000, // 30 seconds
    updateInterval: 5000, // 5 seconds
    onUpdate: (clients) => {
        console.log("Update cycle running. Active clients:", clients.size);
        clients.forEach((client, clientId) => {
            console.log(
                `Client ${clientId} last seen at ${new Date(client.lastSeen).toISOString()}`
            );
        });
    },
    onConnect: (client) => {
        // Log the client connection
        console.log(`Client connected with ID: ${client.clientId}`);

        // Broadcast a "connected" message to all clients
        clientManager.broadcast({
            type: "connected",
            clientId: client.clientId,
            properties: client.properties,
        });

        // Send a welcome message to the newly connected client
        clientManager.send(client, {
            type: "message", // Changed from "welcome" to "message"
            content: "Welcome to the server!",
        });
    },
    onDisconnect: (client) => {
        console.log(`Client ${client.clientId} disconnected.`);
        clientManager.broadcast({
            type: "disconnected",
            clientId: client.clientId,
            properties: client.properties,
        });
    },
});

// Create the socket manager and pass client-related callbacks
const socketManager = createSocketManager({
    onConnection: clientManager.handleConnection,
    onClose: clientManager.handleClose,
    onMessage: clientManager.handleMessage,
});

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("Shutting down gracefully...");
    clientManager.close();
    process.exit();
});
