import { createClientManager } from "./clientManager.js";
import { resolveAccount, updateAccountName } from "./accountManager.js";

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
