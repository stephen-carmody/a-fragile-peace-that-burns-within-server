import WebSocket, { WebSocketServer } from "ws";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";

class GameServer extends EventEmitter {
    constructor(options = {}) {
        super();
        this.port = options.port || 8080;
        this.dataDir = options.dataDir || "./data";
        this.keepAliveTimeout = options.keepAliveTimeout || 30000;

        // Core state
        this.clients = new Map();
        this.clientBySecret = new Map();
        this.wsByClientId = new Map();
        this.accounts = new Map();
        this.objects = new Map();

        console.log("Initializing game server...");
        this.init();
    }


    async init() {
        console.log("Loading persisted World...");
        await this.loadWorld();

        console.log("Starting WebSocket server...");
        this.wss = new WebSocketServer({ port: this.port });
        this.wss.on("connection", this.handleConnection.bind(this));

        console.log("Starting maintenance interval...");
        setInterval(this.maintenance.bind(this), 10000);

        console.log(`Game server running on port ${this.port}`);
    }

    async loadWorld() {
        let dirPath = path.join(this.dataDir, "world");

        try {
            let files = await fs.promises.readdir(dirPath);
            console.log(`Loading objects (${files.length} files)...`);

            for (const file of files) {
                if (!file.endsWith(".json")) continue;
                const filePath = path.join(dirPath, file);
                const content = await fs.promises.readFile(filePath, "utf8");
                const item = JSON.parse(content);
                this.objects.set(item.id, item);
                console.log(`Loaded ${file}`);
            }
        } catch (err) {
            console.log(`Loading objects (0 files)`);
        }
    }

    handleConnection(ws) {
        console.log("WebSocket connected.");
        ws.on("message", async (message) => {
            try {
                console.log("Received message:", message.toString());
                message
                    .toString()
                    .split("\n")
                    .forEach((message) => {
                        const data = JSON.parse(message.toString());
                        this.handleMessage(ws, data);
                    });
            } catch (err) {
                console.error("Error processing message:", err);
            }
        });

        ws.on("close", () => {
            console.log("WebSocket disconnected.");
            this.handleDisconnect(ws);
        });
    }

    async handleMessage(ws, message) {
        console.log("Handling message of type:", message.type);

        let client;

        if (message.type === "init") {
            let initResponse = {
                type: "init",
                keepAliveTimeout: this.keepAliveTimeout,
            };
            if (message.clientSecret) {
                client = this.clientBySecret.get(message.clientSecret);
                if (client) {
                    initResponse.rejoin = true;
                } else {
                    let dirPath = path.join(this.dataDir, "client");
                    try {
                        const matchingFile = (
                            await fs.promises.readdir(dirPath)
                        ).find((file) =>
                            file.endsWith(`-${message.clientSecret}.json`)
                        );

                        if (matchingFile) {
                            const filePath = path.join(dirPath, matchingFile);
                            const content = await fs.promises.readFile(
                                filePath,
                                "utf8"
                            );
                            client = JSON.parse(content);
                            console.log(`Loaded client from disk`);
                        }
                    } catch (err) { }
                }
            }
            if (!client) {
                console.log("Creating new client");
                client = {
                    id: this.generateId(),
                    secret: this.generateId(),
                    accountId: null,
                };
                this.persistClient(client);
                initResponse.clientSecret = client.secret;
            }

            this.clients.set(client.id, client);
            this.clientBySecret.set(client.secret, client);
            this.wsByClientId.set(client.id, ws);
            ws.secret = client.secret;

            initResponse.clientId = client.id;
            this.send(client, initResponse);

            if (!initResponse.rejoin) {
                this.send(client, { type: "message", channel: "global", content: `Welcome${initResponse.clientSecret ? '' : " back"}!` });
            }
        }

        if (!client && ws.secret) client = this.clientBySecret.get(ws.secret);

        if (!client) {
            console.error(
                "Unable to resolve Client, aborting message processing."
            );
            return;
        }

        client.lastSeen = Date.now();

        switch (message.type) {
            case "init":
                break;
            case "login":
                console.log("Handling login for client:", client.id);
                await this.handleLogin(client, message);
                break;
            case "action":
                console.log("Handling action from client:", client.id);
                await this.handleAction(client, message);
                break;
            default:
                console.log(`Unhandled message type "${message.type}"`);
                break;
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
            await this.persistAccount(account);
        }

        client.accountId = account.id;
        console.log(
            `Client ${client.id} logged in as ${account.name} (Account ID: ${account.id})`
        );
        this.persistClient(client);

        this.send(client, {
            type: "worldState",
            objects: Array.from(this.objects.values()),
        });
    }

    async handleAction(client, message) {
        console.log(`Client ${client.id} performed action:`, message.action);
        const account = this.accounts.get(client.accountId);
        if (!account) return;
        this.emit("action", { client, account, action: message.action });
    }

    handleDisconnect(ws) {
        console.log("Handling disconnect...");
        const client = this.clientBySecret.get(ws.secret);
        if (client) {
            console.log(`Client ${client.id} disconnected.`);
            this.emit("clientDisconnect", client);
        }
    }

    handleInactiveClient(client) {
        console.log(`Removing inactive client: ${client.id}`);
        const ws = this.wsByClientId.get(client.id);
        ws.close();
        this.clients.delete(client.id);
        this.clientBySecret.delete(client.secret);
        this.wsByClientId.delete(client.id);
    }

    maintenance() {
        console.log("Running maintenance task...");
        const now = Date.now();
        for (const [id, client] of this.clients) {
            if (now - client.lastSeen > this.keepAliveTimeout)
                this.handleInactiveClient(client);
        }
    }

    send(client, message) {
        console.log(`Sending Client with ID "${client.id}" -> `, message);
        const ws = this.wsByClientId.get(client.id);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    async persistClient(item) {
        console.log(`Persisting client with ID: ${item.id}`);
        const dirPath = path.join(this.dataDir, "client");
        await fs.promises.mkdir(dirPath, { recursive: true });
        const filename = path.join(dirPath, `${item.id}-${item.secret}.json`);
        fs.promises.writeFile(filename, JSON.stringify(item, null, 2));
    }

    generateId() {
        return Math.random().toString(36).substring(2, 15);
    }
}

const server = new GameServer({
    port: 8080,
    keepAliveTimeout: 30000,
});

server.generateId;

server.on("action", ({ client, account, action }) => {
    console.log(`${account.name} performed action: ${action}`);
});

