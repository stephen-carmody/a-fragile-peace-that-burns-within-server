// main.js
import { createClientManager } from "./clientManager.js";
import { resolveAccount, updateAccountName } from "./accountManager.js";
import { createObjectManager } from "./objectManager.js";

// Create the object manager with an onChange callback
const objectManager = createObjectManager({
    onChange: (object) => {
        // Broadcast the updated object to all clients
        clientManager.broadcast({
            type: "objectUpdate",
            object,
        });
    },
});

// Load all objects at startup
objectManager.loadObjects();

// Create the client manager
const clientManager = createClientManager({
    keepAliveTimeout: 30000,
    updateInterval: 5000,
    broadcastConnect: false,
    broadcastDisconnect: false,
    onUpdate: (clients) => {
        console.log("Update cycle running. Active clients:", clients.size);
    },
    onConnect: (client) => {
        // Resolve or create an account for the client
        const account = resolveAccount(client);

        // Resolve or create a PlayerCharacter for the account
        const playerCharacter = objectManager.resolvePlayerCharacter(account);

        // Send the initial state of the world to the client
        clientManager.send(client, {
            type: "worldState",
            state: Array.from(objectManager.objects.values()),
        });

        // Determine the welcome message based on the account's isNew property
        const welcomeMessage = account.isNew
            ? `Welcome ${account.name}.`
            : `Welcome back, ${account.name}.`;

        // Send the welcome message
        clientManager.send(client, {
            type: "welcome",
            message: welcomeMessage,
        });

        // Mark the account as no longer new
        account.isNew = false;
    },
    onDisconnect: (client) => {
        // Custom logic can be added here, if needed
    },
    messageHandlers: {
        updateAccountName: (client, message) => {
            const account = resolveAccount(client);
            if (account) {
                updateAccountName(account.accountId, message.newName);
                clientManager.send(client, {
                    type: "message",
                    content: `Account name updated to ${message.newName}.`,
                });
            }
        },
    },
});

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("Shutting down gracefully...");
    clientManager.close();
    process.exit();
});
