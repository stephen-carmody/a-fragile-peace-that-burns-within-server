import { createSocketManager } from "./socketManager.js";

// Message handlers
const handlers = {
    message: (ws, message) => {
        console.log("Custom message handler:", message);
    },
};

// Create an instance of SocketManager
const { send, broadcast } = createSocketManager({
    port: 8080,
    messageDelimiter: ";",
    keepAliveTimeout: 20000,
    heartbeatInterval: 2000,
    handlers,
});
