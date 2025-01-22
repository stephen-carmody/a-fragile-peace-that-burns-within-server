import fs from "fs";
import path from "path";

/**
 * Creates a client manager to handle client-related logic.
 * @param {object} options - Configuration options for the client manager.
 * @param {number} [options.keepAliveTimeout=30000] - Timeout for inactive clients (in milliseconds).
 * @param {number} [options.updateInterval=5000] - Interval for checking inactive clients (in milliseconds).
 * @param {object} [options.messageHandlers={}] - Custom handlers for message types.
 * @param {function} [options.onUpdate] - Handler called during each update cycle.
 * @param {function} [options.onConnect] - Handler called when a new client connects.
 * @param {function} [options.onDisconnect] - Handler called when a client disconnects or is removed due to inactivity.
 * @returns {object} An object exposing the `send`, `broadcast`, and `close` functions.
 */
export function createClientManager(options = {}) {
    const {
        keepAliveTimeout = 30000,
        updateInterval = 5000,
        messageHandlers = {},
        onUpdate,
        onConnect,
        onDisconnect,
    } = options;

    // Maps to store clients and their metadata
    const clients = new Map(); // Key: clientId, Value: { ws, lastSeen, properties, clientId }
    const wsToClientId = new Map(); // Key: WebSocket, Value: clientId
    const dataDir = "./data/client";

    // Ensure the data directory exists
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    /**
     * Default handler for the "init" message type.
     * @param {object} client - The client object.
     * @param {object} message - The message containing clientId (optional).
     */
    const handleInit = (client, message) => {
        let { clientId } = message;

        if (clientId && clients.has(clientId)) {
            console.log(`Known client connected with ID: ${clientId}`);
            clients.set(clientId, {
                ...client,
                lastSeen: Date.now(),
                clientId,
            });
            wsToClientId.set(client.ws, clientId);
        } else {
            const persistedClient = clientId
                ? loadClientFromDisk(clientId)
                : null;
            if (persistedClient) {
                console.log(
                    `Known client connected with ID: ${clientId} (restored from disk)`
                );
                client = createClient(
                    client.ws,
                    clientId,
                    persistedClient.properties
                );
            } else {
                client = createClient(client.ws, clientId);
            }
        }

        // Notify that the client has connected
        if (onConnect) {
            onConnect(client);
        }

        send(client, {
            type: "init",
            clientId: client.clientId,
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
        alive: handleAlive, // Add the new "alive" handler
    };
    const allHandlers = { ...defaultHandlers, ...messageHandlers };

    /**
     * Generates a random ID for new clients.
     * @returns {string} A random alphanumeric string.
     */
    const generateRandomId = () => Math.random().toString(36).substring(2, 15);

    /**
     * Creates a new client and adds it to the clients map.
     * @param {WebSocket} ws - The WebSocket instance.
     * @param {string} [clientId] - Optional client ID. If not provided, a new ID will be generated.
     * @param {object} [properties] - Optional properties to associate with the client.
     * @returns {object} The created client object.
     */
    const createClient = (ws, clientId, properties = {}) => {
        if (!clientId) {
            clientId = generateRandomId();
            console.log(`New client connected, generated ID: ${clientId}`);
        }
        const client = { ws, lastSeen: Date.now(), properties, clientId };
        clients.set(clientId, client);
        wsToClientId.set(ws, clientId);
        return client;
    };

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
     * @param {string} clientId - The client ID to load.
     * @returns {object|null} The client data if found, otherwise null.
     */
    const loadClientFromDisk = (clientId) => {
        const filePath = path.join(dataDir, `client-${clientId}.json`);
        if (fs.existsSync(filePath)) {
            try {
                return JSON.parse(fs.readFileSync(filePath, "utf8"));
            } catch (error) {
                console.error(
                    `Error reading client data for ${clientId}:`,
                    error
                );
            }
        }
        return null;
    };

    /**
     * Persists client information to disk.
     */
    const persistClientsToDisk = () => {
        clients.forEach((client, clientId) => {
            const filePath = path.join(dataDir, `client-${clientId}.json`);
            const clientData = {
                clientId,
                lastSeen: client.lastSeen,
                properties: client.properties || {},
            };
            fs.writeFileSync(filePath, JSON.stringify(clientData, null, 2));
            console.log(`Persisted client data to ${filePath}`);
        });
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
        if (onDisconnect) {
            onDisconnect(clients.get(clientId));
        }
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
        persistClientsToDisk();
        process.exit();
    });

    process.on("SIGTERM", () => {
        console.log("Process is terminating. Persisting client data...");
        persistClientsToDisk();
        process.exit();
    });

    /**
     * Handles a new WebSocket connection.
     * @param {WebSocket} ws - The WebSocket instance of the new client.
     */
    const handleConnection = (ws) => {
        console.log("Client connected");
        wsToClientId.set(ws, null);
    };

    /**
     * Handles a WebSocket disconnection.
     * @param {WebSocket} ws - The WebSocket instance of the disconnected client.
     */
    const handleClose = (ws) => {
        console.log("Client disconnected");
        const clientId = wsToClientId.get(ws);
        if (clientId) {
            removeClient(clientId, ws);
        }
    };

    /**
     * Handles an incoming message from a WebSocket.
     * @param {WebSocket} ws - The WebSocket instance.
     * @param {object} message - The parsed message received from the client.
     */
    const handleMessageFromSocket = (ws, message) => {
        const clientId = wsToClientId.get(ws);
        let client = clientId
            ? clients.get(clientId)
            : { ws, lastSeen: Date.now(), clientId: null };

        if (clientId) client.lastSeen = Date.now();

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

    return {
        send,
        broadcast,
        close: () => {
            clearInterval(updateIntervalId);
            persistClientsToDisk();
        },
        handleConnection,
        handleClose,
        handleMessage: handleMessageFromSocket,
    };
}
