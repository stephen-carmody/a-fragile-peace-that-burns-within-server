import WebSocket, { WebSocketServer } from "ws";

/**
 * Creates a WebSocket server to manage connections and messages.
 * @param {object} options - Configuration options for the WebSocket server.
 * @param {number} [options.port=8080] - The port to listen on.
 * @param {string} [options.messageDelimiter=";"] - The delimiter for splitting combined messages.
 * @param {function} [options.onMessage] - Callback for handling incoming messages.
 * @returns {object} An object exposing the `send` and `broadcast` functions.
 */
export function createSocketManager(options = {}) {
    const { port = 8080, messageDelimiter = ";", onMessage } = options;

    // Create the WebSocket server
    const wss = new WebSocketServer({ port });
    console.log(`WebSocket server is running on ws://localhost:${port}`);

    /**
     * Sends a message to a specific WebSocket.
     * @param {WebSocket} ws - The WebSocket instance.
     * @param {object} message - The message to send.
     */
    function send(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    /**
     * Broadcasts a message to all connected clients.
     * @param {object} message - The message to broadcast.
     */
    function broadcast(message) {
        const messageString = JSON.stringify(message);
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageString);
            }
        });
    }

    // Handle new connections
    wss.on("connection", (ws) => {
        // Handle incoming messages
        ws.on("message", (message) => {
            // Split combined messages using the delimiter
            const messages = message.toString().split(messageDelimiter);

            // Process each message
            messages.forEach((message) => {
                try {
                    // Parse the message and validate its structure
                    message = JSON.parse(message);
                    if (!message.type) {
                        throw new Error("Message type is missing");
                    }
                } catch (error) {
                    console.error("Invalid message format:", message, error);
                    send(ws, {
                        type: "error",
                        message: "Invalid message format",
                    });
                    return;
                }

                // Notify of the incoming message
                if (onMessage) {
                    onMessage(ws, message);
                }
            });
        });

        // Handle WebSocket errors
        ws.on("error", (error) => {
            console.error("WebSocket error:", error);
        });
    });

    // Expose the `send` and `broadcast` functions
    return { send, broadcast };
}
