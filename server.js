// Import WebSocket library
import WebSocket, { WebSocketServer } from "ws";

// Store connected clients with their IDs
const clients = new Map();

// Create a WebSocket server
const wss = new WebSocketServer({ port: 8080 });

// Handle client connections
wss.on("connection", (ws) => {
    console.log("Client connected");

    // Handle incoming messages
    ws.on("message", (message) => {
        const data = JSON.parse(message);

        // If the client provides an ID, check if it's a known client
        if (data.type === "init" && data.clientId) {
            const clientId = data.clientId;

            if (clients.has(clientId)) {
                console.log(`Known client reconnected: ${clientId}`);
                clients.set(clientId, ws); // Update the WebSocket instance for this client
            } else {
                console.log(`Unknown client ID provided: ${clientId}`);
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Unknown client ID",
                    })
                );
                ws.close(); // Close the connection for unknown IDs
            }
        } else if (data.type === "init") {
            // Generate a new ID for the client
            const clientId = generateRandomId();
            clients.set(clientId, ws);
            console.log(`New client connected with ID: ${clientId}`);

            // Send the ID back to the client
            ws.send(JSON.stringify({ type: "init", clientId }));
        } else {
            // Handle other messages
            console.log(`Received message from client: ${data.message}`);
            ws.send(`Echo: ${data.message}`);
        }
    });

    // Handle client disconnection
    ws.on("close", () => {
        console.log("Client disconnected");
    });
});

// Generate a random ID for clients
function generateRandomId() {
    return Math.random().toString(36).substring(2, 15);
}

console.log("WebSocket server is running on ws://localhost:8080");
