import { createSocketManager } from "./socketManager.js";
import { createClientManager } from "./clientManager.js";

// Create the client manager
const clientManager = createClientManager({
    keepAliveTimeout: 30000, // 30 seconds
    updateInterval: 5000, // 5 seconds
    messageHandlers: {
        customMessage: (client, message) => {
            console.log(
                "Custom message received from client:",
                client.clientId,
                message
            );
            clientManager.send(client, {
                type: "customMessage",
                content: "Ack",
            });
        },
    },
    onUpdate: (clients) => {
        console.log("Update cycle running. Active clients:", clients.size);
        clients.forEach((client, clientId) => {
            console.log(
                `Client ${clientId} last seen at ${new Date(client.lastSeen).toISOString()}`
            );
        });
    },
    onConnect: (client, isRestored) => {
        if (isRestored) {
            console.log(
                `Client ${client.clientId} restored from disk. Properties:`,
                client.properties
            );
            clientManager.broadcast({
                type: "reconnected",
                clientId: client.clientId,
                properties: client.properties,
            });
        } else {
            console.log(`New client connected with ID: ${client.clientId}`);
            clientManager.broadcast({
                type: "connected",
                clientId: client.clientId,
                properties: client.properties,
            });
        }
        clientManager.send(client, {
            type: "welcome",
            message: "Welcome to the server!",
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
