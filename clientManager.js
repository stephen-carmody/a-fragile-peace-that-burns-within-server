import fs from "fs";
import path from "path";
import { createSocketManager } from "./socketManager.js";

export function createClientManager(options = {}) {
    const {
        keepAliveTimeout = 30000,
        updateInterval = 5000,
        messageHandlers = {},
        onUpdate,
        onConnect: customOnConnect,
        onDisconnect: customOnDisconnect,
    } = options;

    // Maps to store clients and their metadata
    const clients = new Map(); // Key: clientId, Value: { ws, lastSeen, properties, clientId, clientSecret }
    const wsToClientId = new Map(); // Key: WebSocket, Value: clientId
    const secretToClientId = new Map();
    const dataDir = "./data/client";

    // Ensure the data directory exists
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    /**
     * Default handler for client connections.
     * Logs the connection, broadcasts a "connected" message, and sends a welcome message.
     * @param {object} client - The client object.
     */
    const defaultOnConnect = (client) => {
        // Broadcast a "connected" message to all clients
        broadcast({
            type: "connected",
            clientId: client.clientId,
            properties: client.properties,
        });

        // Send a welcome message to the newly connected client
        send(client, {
            type: "message",
            content: "Welcome to the server!",
        });
    };

    /**
     * Default handler for client disconnections.
     * Logs the disconnection and broadcasts a "disconnected" message.
     * @param {object} client - The client object.
     */
    const defaultOnDisconnect = (client) => {
        console.log(`Client ${client.clientId} disconnected.`);

        // Broadcast a "disconnected" message to all clients
        broadcast({
            type: "disconnected",
            clientId: client.clientId,
            properties: client.properties,
        });
    };

    // Combine default and custom handlers
    const onConnect = (client) => {
        defaultOnConnect(client);
        if (customOnConnect) {
            customOnConnect(client);
        }
    };

    const onDisconnect = (client) => {
        defaultOnDisconnect(client);
        if (customOnDisconnect) {
            customOnDisconnect(client);
        }
    };

    /**
     * Resolves a WebSocket to a client object, handling all cases:
     * 1. Already connected client (found in wsToClientId).
     * 2. Reconnecting client with a valid clientSecret.
     * 3. Load client from disk if clientSecret is provided.
     * 4. New client if no matching client is found.
     * @param {WebSocket} ws - The WebSocket instance.
     * @param {object} message - The message containing clientSecret (optional).
     * @returns {object} The client object.
     */
    const resolveClient = (ws, message) => {
        // Case 1: Already connected client
        if (wsToClientId.has(ws)) {
            const clientId = wsToClientId.get(ws);
            const client = clients.get(clientId);
            if (client) return client;
        }

        const clientSecret = message?.clientSecret;

        // Case 2: Reconnecting client with a valid clientSecret
        if (clientSecret && secretToClientId.has(clientSecret)) {
            const clientId = secretToClientId.get(clientSecret);
            const client = clients.get(clientId);

            if (client) {
                console.log(
                    `Reestablished new WebSocket for client with ID: ${clientId}`
                );
                client.ws = ws; // Update the WebSocket
                client.lastSeen = Date.now();
                wsToClientId.set(ws, clientId);
                return client;
            }
        }

        // Case 3: Load client from disk if clientSecret is provided
        if (clientSecret) {
            const loadedClient = loadClientFromDisk(clientSecret);
            if (loadedClient) {
                console.log(
                    `Loaded client from disk with ID: ${loadedClient.clientId}`
                );
                const client = { ...loadedClient, ws, lastSeen: Date.now() };
                clients.set(client.clientId, client);
                wsToClientId.set(ws, client.clientId);
                secretToClientId.set(client.clientSecret, client.clientId);

                // Notify that the client has reconnected (loaded from disk)
                onConnect(client);
                return client;
            }
        }

        // Case 4: New client
        const client = {
            ws,
            lastSeen: Date.now(),
            clientId: generateRandomId(),
            clientSecret: generateRandomId(),
            properties: {},
        };
        console.log(`New client connected, generated ID: ${client.clientId}`);
        clients.set(client.clientId, client);
        wsToClientId.set(ws, client.clientId);
        secretToClientId.set(client.clientSecret, client.clientId);

        // Persist the new client to disk
        persistClientToDisk(client);

        // Notify that the client has connected
        onConnect(client);

        return client;
    };

    /**
     * Default handler for the "init" message type.
     * @param {object} client - The client object.
     * @param {object} message - The message containing clientSecret (optional).
     */
    const handleInit = (client, message) => {
        // Send the init response
        send(client, {
            type: "init",
            clientId: client.clientId,
            clientSecret: client.clientSecret,
            keepAliveTimeout,
            updateInterval,
        });
    };

    /**
     * Default handler for the "message" message type.
     * @param {object} client - The client object.
     * @param {object} message - The message content.
     */
    const handleMessage = (client, message) => {
        console.log("Received message from client:", client.clientId, message);
        send(client, { type: "message", content: "Message received!" });
    };

    /**
     * Default handler for the "broadcast" message type.
     * @param {object} client - The client object.
     * @param {object} message - The message to broadcast.
     */
    const handleBroadcast = (client, message) => {
        broadcast({ type: "broadcast", content: message.content });
    };

    /**
     * Default handler for the "alive" message type.
     * This handler does nothing but can be used to update the client's lastSeen timestamp.
     * @param {object} client - The client object.
     * @param {object} message - The message content.
     */
    const handleAlive = (client, message) => {
        // Do nothing, but the client's lastSeen timestamp will be updated automatically
    };

    // Default handlers
    const defaultHandlers = {
        init: handleInit,
        message: handleMessage,
        broadcast: handleBroadcast,
        alive: handleAlive,
    };
    const allHandlers = { ...defaultHandlers, ...messageHandlers };

    /**
     * Generates a random ID for new clients.
     * @returns {string} A random alphanumeric string.
     */
    const generateRandomId = () => Math.random().toString(36).substring(2, 15);

    /**
     * Sends a message to a specific client.
     * @param {object} client - The client object.
     * @param {object} message - The message to send.
     */
    const send = (client, message) => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify(message));
        }
    };

    /**
     * Broadcasts a message to all connected clients.
     * @param {object} message - The message to broadcast.
     */
    const broadcast = (message) => {
        const messageString = JSON.stringify(message);
        clients.forEach((client) => {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(messageString);
            }
        });
    };

    /**
     * Loads client data from disk if it exists.
     * @param {string} clientSecret - The client to load.
     * @returns {object|null} The client data if found, otherwise null.
     */
    const loadClientFromDisk = (clientSecret) => {
        const filePath = path.join(dataDir, `client-${clientSecret}.json`);
        if (fs.existsSync(filePath)) {
            try {
                return JSON.parse(fs.readFileSync(filePath, "utf8"));
            } catch (error) {
                console.error(
                    `Error reading client data for ${clientSecret}:`,
                    error
                );
            }
        }
        return null;
    };

    /**
     * Persists a single client's information to disk.
     * @param {object} client - The client object.
     */
    const persistClientToDisk = (client) => {
        const filePath = path.join(
            dataDir,
            `client-${client.clientSecret}.json`
        );
        const clientData = {
            clientId: client.clientId,
            clientSecret: client.clientSecret,
            lastSeen: client.lastSeen,
            properties: client.properties || {},
        };
        fs.writeFileSync(filePath, JSON.stringify(clientData, null, 2));
    };

    /**
     * Checks for inactive clients and removes them if they haven't been seen for keepAliveTimeout.
     */
    const checkInactiveClients = () => {
        const now = Date.now();
        clients.forEach((client, clientId) => {
            if (now - client.lastSeen > keepAliveTimeout) {
                console.log(
                    `Client ${clientId} is inactive. Closing connection.`
                );
                removeClient(clientId, client.ws);
            }
        });
    };

    /**
     * Removes a client from the clients map and calls the onDisconnect handler.
     * @param {string} clientId - The ID of the client to remove.
     * @param {WebSocket} ws - The WebSocket instance of the client.
     */
    const removeClient = (clientId, ws) => {
        onDisconnect(clients.get(clientId));
        ws.close();
        clients.delete(clientId);
        wsToClientId.delete(ws);
    };

    /**
     * Performs the update cycle, including checking for inactive clients and calling the onUpdate handler.
     */
    const update = () => {
        checkInactiveClients();
        if (onUpdate) {
            onUpdate(clients);
        }
    };

    // Start the update interval
    const updateIntervalId = setInterval(update, updateInterval);

    // Handle process exit to persist client data
    process.on("SIGINT", () => {
        console.log("Process is terminating. Persisting client data...");
        clients.forEach((client) => persistClientToDisk(client));
        process.exit();
    });

    process.on("SIGTERM", () => {
        console.log("Process is terminating. Persisting client data...");
        clients.forEach((client) => persistClientToDisk(client));
        process.exit();
    });

    /**
     * Handles an incoming message from a WebSocket.
     * @param {WebSocket} ws - The WebSocket instance.
     * @param {object} message - The parsed message received from the client.
     */
    const handleMessageFromSocket = (ws, message) => {
        const client = resolveClient(ws, message);

        // Update the client's lastSeen timestamp
        client.lastSeen = Date.now();

        const { type } = message;
        if (allHandlers[type]) {
            allHandlers[type](client, message);
        } else {
            console.error(`No handler for message type: "${type}"`);
            send(client, {
                type: "error",
                message: `Unsupported message type: "${type}"`,
            });
        }
    };

    // Create the socket manager and pass client-related callbacks
    const socketManager = createSocketManager({
        onMessage: handleMessageFromSocket,
    });

    return {
        send,
        broadcast,
        close: () => {
            clearInterval(updateIntervalId);
            clients.forEach((client) => persistClientToDisk(client));
        },
    };
}
