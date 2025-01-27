import { createClientManager } from "./clientManager.js";

// Create the client manager
const clientManager = createClientManager({
    keepAliveTimeout: 30000, // 30 seconds
    updateInterval: 5000, // 5 seconds
    broadcastConnect: false, // Dont broadcast connect
    broadcastDisconnect: false, // Dont broadcast disconnect
    onUpdate: (clients) => {
        console.log("Update cycle running. Active clients:", clients.size);
    },
    onConnect: (client) => {
        console.log(client);
    },
    onDisconnect: (client) => {
        // Custom logic can be added here, if needed
    },
});

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("Shutting down gracefully...");
    clientManager.close();
    process.exit();
});
