import WebSocket, { WebSocketServer } from "ws";
import { EventEmitter } from "events";
import fs from "fs/promises";
import path from "path";

class GameServer extends EventEmitter {
    constructor(options = {}) {
        super();
        this.port = options.port || 8080;
        this.dataDir = options.dataDir || "./data";
        this.keepAliveTimeout = options.keepAliveTimeout || 30000;

        // Core state
        this.clients = new Map();
        this.accounts = new Map();
        this.objects = new Map();

        console.log("Initializing game server...");
        this.init();
    }

    async init() {
        console.log("Ensuring data directories exist...");
        await fs.mkdir(this.dataDir, { recursive: true });

        console.log("Loading all persisted data...");
        await this.loadAllData();

        console.log("Starting WebSocket server...");
        this.wss = new WebSocketServer({ port: this.port });
        this.wss.on("connection", this.handleConnection.bind(this));

        console.log("Starting maintenance interval...");
        setInterval(this.maintenance.bind(this), 10000);

        console.log(`Game server running on port ${this.port}`);
    }

    async loadAllData() {
        try {
            const subdirectories = await fs.readdir(this.dataDir, {
                withFileTypes: true,
            });

            // Mapping of item types to global Maps
            const typeMap = {
                client: this.clients,
                account: this.accounts,
                object: this.objects,
            };

            for (const subdir of subdirectories) {
                if (!subdir.isDirectory()) continue;
                const dirPath = path.join(this.dataDir, subdir.name);
                const files = await fs.readdir(dirPath);
                console.log(
                    `Loading data from ${subdir.name} (${files.length} files)...`
                );

                for (const file of files) {
                    if (!file.endsWith(".json")) continue;
                    const filePath = path.join(dirPath, file);
                    const content = await fs.readFile(filePath, "utf8");
                    const item = JSON.parse(content);

                    if (!item.type) {
                        console.warn(
                            `Skipping ${file} due to missing type property.`
                        );
                        continue;
                    }

                    // Dynamically store item in the correct Map
                    const targetMap = typeMap[item.type];
                    if (targetMap) {
                        targetMap.set(item.id, item);
                        console.log(
                            `Loaded ${item.type} (${item.id}) from ${file}`
                        );
                    } else {
                        console.warn(
                            `Unknown item type '${item.type}' in file ${file}`
                        );
                    }
                }
            }
        } catch (err) {
            console.error("Error loading data:", err);
        }
    }

    handleConnection(ws) {
        console.log("New client connected.");
        ws.on("message", async (message) => {
            try {
                console.log("Received message:", message.toString());
                const data = JSON.parse(message.toString());
                await this.handleMessage(ws, data);
            } catch (err) {
                console.error("Error processing message:", err);
                this.send(ws, {
                    type: "error",
                    message: "Invalid message format",
                });
            }
        });

        ws.on("close", () => {
            console.log("Client disconnected.");
            this.handleDisconnect(ws);
        });
    }

    async handleMessage(ws, message) {
        console.log("Handling message of type:", message.type);
        const client = this.resolveClient(ws, message);
        if (!client) return;

        client.lastSeen = Date.now();

        switch (message.type) {
            case "init":
                console.log("Client initialized:", client.id);
                this.send(ws, {
                    type: "init",
                    clientId: client.id,
                    clientSecret: client.secret,
                    keepAliveTimeout: this.keepAliveTimeout,
                });
                break;
            case "login":
                console.log("Handling login for client:", client.id);
                await this.handleLogin(client, message);
                break;
            case "action":
                console.log("Handling action from client:", client.id);
                await this.handleAction(client, message);
                break;
        }
        await this.persist(client);
    }

    resolveClient(ws, message) {
        console.log(`Resolving Client...`);
        let account = [...this.clients.values()].find(
            (a) => a.id === message.clientId
        );

        if (!account) {
            console.log("No account found. Creating guest account...");
            account = {
                id: this.generateId(),
                type: "account",
                name: `Guest-${this.generateId()}`,
                clientIds: [client.id],
            };
            this.accounts.set(account.id, account);
            await this.persist(account);
        }
    }

    async handleLogin(client, message) {
        console.log(`Client ${client.id} attempting login...`);
        let account = [...this.accounts.values()].find(
            (a) => a.id === message.accountId
        );

        if (!account) {
            console.log("No account found. Creating guest account...");
            account = {
                id: this.generateId(),
                type: "account",
                name: `Guest-${this.generateId()}`,
                clientIds: [client.id],
            };
            this.accounts.set(account.id, account);
            await this.persist(account);
        }

        client.accountId = account.id;
        console.log(
            `Client ${client.id} logged in as ${account.name} (Account ID: ${account.id})`
        );
        await this.persist(client);

        this.send(client.ws, {
            type: "worldState",
            objects: Array.from(this.objects.values()),
        });
    }

    async handleAction(client, message) {
        console.log(`Client ${client.id} performed action:`, message.action);
        const account = this.accounts.get(client.accountId);
        if (!account) return;
        this.emit("action", { client, account, action: message.action });
        await this.persist(account);
    }

    handleDisconnect(ws) {
        console.log("Handling disconnect...");
        const client = [...this.clients.values()].find((c) => c.ws === ws);
        if (client) {
            console.log(`Client ${client.id} disconnected.`);
            this.emit("clientDisconnect", client);
            this.persist(client);
        }
    }

    maintenance() {
        console.log("Running maintenance task...");
        const now = Date.now();
        for (const [id, client] of this.clients) {
            if (now - client.lastSeen > this.keepAliveTimeout) {
                console.log(`Removing inactive client: ${id}`);
                client.ws.close();
                this.clients.delete(id);
                this.persist(client);
            }
        }
    }

    send(ws, message) {
        console.log("Sending message:", message);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    async persist(item) {
        console.log(`Persisting ${item.type} with ID: ${item.id}`);
        const dirPath = path.join(this.dataDir, item.type);
        await fs.mkdir(dirPath, { recursive: true });
        const filename = path.join(dirPath, `${item.id}.json`);
        await fs.writeFile(filename, JSON.stringify(item, null, 2));
    }
}

const server = new GameServer({
    port: 8080,
    keepAliveTimeout: 30000,
});

server.on("action", ({ client, account, action }) => {
    console.log(`${account.name} performed action: ${action}`);
});
