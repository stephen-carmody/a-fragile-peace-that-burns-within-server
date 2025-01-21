import WebSocket, { WebSocketServer } from "ws";

/**
 * Creates a WebSocket server with the specified configuration.
 * @param {object} options - Configuration options for the WebSocket server.
 * @param {number} [options.port=8080] - The port to listen on.
 * @param {string} [options.messageDelimiter=";"] - The delimiter for splitting combined messages.
 * @param {number} [options.keepAliveTimeout=20000] - Timeout for inactive clients (in milliseconds).
 * @param {number} [options.heartbeatInterval=10000] - Interval for checking inactive clients (in milliseconds).
 * @param {object} [options.handlers={}] - Custom handlers for message types.
 * @returns {object} An object exposing the `send` and `broadcast` functions.
 */
export function createSocketManager(options = {}) {
    const {
        port = 8080,
        messageDelimiter = ";",
        keepAliveTimeout = 20000,
        heartbeatInterval = 10000,
        handlers = {},
    } = options;

    // Maps to store clients and their metadata
    const clients = new Map(); // Key: clientId, Value: { ws, lastSeen, batchedMessages }
    const wsToClientId = new Map(); // Key: WebSocket, Value: clientId

    // Default handlers
    const defaultHandlers = {
        init: handleInit,
        message: handleMessage,
        broadcast: handleBroadcast,
    };
    const allHandlers = { ...defaultHandlers, ...handlers };

    // Create the WebSocket server
    const wss = new WebSocketServer({ port });
    console.log(`WebSocket server is running on ws://localhost:${port}`);

    /**
     * Generates a random ID for new clients.
     * @returns {string} A random alphanumeric string.
     */
    function generateRandomId() {
        return Math.random().toString(36).substring(2, 15);
    }

    /**
     * Adds a message to the batched messages for a specific WebSocket.
     * @param {WebSocket} ws - The WebSocket instance.
     * @param {object} message - The message to send.
     */
    function send(ws, message) {
        const clientId = wsToClientId.get(ws);
        if (clientId) {
            const client = clients.get(clientId);
            if (client) {
                if (!client.batchedMessages) {
                    client.batchedMessages = [];
                }
                client.batchedMessages.push(JSON.stringify(message));
            }
        }
    }

    /**
     * Broadcasts a message to all connected clients.
     * @param {object} message - The message to broadcast.
     */
    function broadcast(message) {
        const messageString = JSON.stringify(message);
        clients.forEach((client) => {
            if (client.ws.readyState === WebSocket.OPEN) {
                send(client.ws, message);
            }
        });
    }

    /**
     * Flushes batched messages for all clients.
     */
    function flushBatchedMessages() {
        clients.forEach((client) => {
            if (client.batchedMessages && client.batchedMessages.length > 0) {
                const batchedMessage =
                    client.batchedMessages.join(messageDelimiter);
                if (client.ws.readyState === WebSocket.OPEN) {
                    client.ws.send(batchedMessage);
                }
                client.batchedMessages = []; // Clear the batched messages
            }
        });
    }

    /**
     * Default handler for the "init" message type.
     * @param {WebSocket} ws - The WebSocket instance of the client.
     * @param {object} message - The message containing clientId (optional).
     */
    function handleInit(ws, message) {
        let { clientId } = message;

        // If the client provides an ID, check if it's a known client
        if (clientId && clients.has(clientId)) {
            console.log(`Known client reconnected: ${clientId}`);
            clients.set(clientId, {
                ws,
                lastSeen: Date.now(),
                batchedMessages: [],
            });
            wsToClientId.set(ws, clientId);
        } else {
            // Generate a new ID for the client
            clientId = generateRandomId();
            clients.set(clientId, {
                ws,
                lastSeen: Date.now(),
                batchedMessages: [],
            });
            wsToClientId.set(ws, clientId);
            console.log(`New client connected with ID: ${clientId}`);
        }
        // Send the ID back to the client
        send(ws, { type: "init", clientId });
    }

    /**
     * Default handler for the "message" message type.
     * @param {WebSocket} ws - The WebSocket instance of the client.
     * @param {object} message - The message content.
     */
    function handleMessage(ws, message) {
        console.log("Received message:", message);
        send(ws, { type: "message", content: "Message received!" });
    }

    /**
     * Default handler for the "broadcast" message type.
     * @param {WebSocket} ws - The WebSocket instance of the client.
     * @param {object} message - The message to broadcast.
     */
    function handleBroadcast(ws, message) {
        broadcast({ type: "broadcast", content: message.content });
    }

    /**
     * Checks for inactive clients and removes them if they haven't been seen for keepAliveTimeout.
     */
    function checkInactiveClients() {
        const now = Date.now();
        clients.forEach((client, clientId) => {
            if (now - client.lastSeen > keepAliveTimeout) {
                console.log(
                    `Client ${clientId} is inactive. Closing connection.`
                );
                client.ws.close();
                clients.delete(clientId);
                wsToClientId.delete(client.ws);
            }
        });
    }

    // Start the heartbeat interval to check for inactive clients and flush batched messages
    setInterval(() => {
        checkInactiveClients();
        flushBatchedMessages();
    }, heartbeatInterval);

    // Handle new client connections
    wss.on("connection", (ws) => {
        console.log("Client connected");

        // Handle incoming messages from the client
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

                // Update the client's lastSeen timestamp
                const clientId = wsToClientId.get(ws);
                if (clientId) {
                    const client = clients.get(clientId);
                    if (client) {
                        client.lastSeen = Date.now();
                    }
                }

                // Call the appropriate handler for the message type
                const { type } = message;
                if (allHandlers[type]) {
                    allHandlers[type](ws, message);
                } else {
                    console.error(`No handler for message type: "${type}"`);
                    send(ws, {
                        type: "error",
                        message: `Unsupported message type: "${type}"`,
                    });
                }
            });
        });

        // Handle client disconnection
        ws.on("close", () => {
            console.log("Client disconnected");

            // Do not remove the client from the clients map or the wsToClientId map
            // The client can reconnect using the same clientId
        });

        // Handle WebSocket errors
        ws.on("error", (error) => {
            console.error("WebSocket error:", error);
        });
    });

    // Expose only the `send` and `broadcast` functions
    return { send, broadcast };
}
