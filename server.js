//import WebSocket, { WebSocketServer } from "ws";
//import { EventEmitter } from "events";
//import fs from "fs";
//import readline from "readline";
//import path from "path";
//
//class GameServer extends EventEmitter {
//    constructor(options = {}) {
//        super();
//        this.port = options.port || 8080;
//        this.dataDir = options.dataDir || "./data";
//        this.keepAliveTimeout = options.keepAliveTimeout || 30000;
//
//        // Core state
//        this.usedIds = new Map();
//        this.clients = new Map();
//        this.clientBySecret = new Map();
//        this.wsByClient = new Map();
//        this.bufferByClient = new Map();
//
//        (async () => {
//            console.log("Initialising game server...");
//
//            let dirPath = path.join(this.dataDir, "client");
//            try {
//                let files = await fs.promises.readdir(dirPath);
//                for (const file of files) {
//                    if (!file.endsWith(".json")) continue;
//                    const filePath = path.join(dirPath, file);
//                    const content = await fs.promises.readFile(filePath, "utf8");
//                    const item = JSON.parse(content);
//                    this.usedIds.set(item.id);
//                }
//            } catch (err) {
//                if (err.code !== "ENOENT") console.log(err);
//            }
//
//            this.wss = new WebSocketServer({ port: this.port });
//            this.wss.on("connection", this.handleConnection.bind(this));
//
//            setInterval(() => {
//                const now = Date.now();
//                for (const [id, client] of this.clients) {
//                    if (now - client.lastSeen > this.keepAliveTimeout) {
//                        return this.handleInactiveClient(client);
//                    }
//                    const ws = this.wsByClient.get(client);
//                    const buffer = this.bufferByClient.get(client);
//                    if (ws.readyState === WebSocket.OPEN && buffer.length) {
//                        this.bufferByClient.set(client, []);
//                        const messages = buffer.join("\n");
//                        console.log(`Sending Client ${client.id} -> `, messages);
//                        ws.send(messages);
//                    }
//                }
//            }, 2000);
//
//            console.log(`Game server running on port ${this.port}`);
//        })();
//    }
//
//    async handleConnection(ws) {
//        console.log("WebSocket connected.");
//        ws.on("message", async (data) => {
//            try {
//                const msg = data.toString();
//                console.log("Received message:", msg);
//                msg.split("\n").forEach(
//                    async (msg) => await this.handleMessage(ws, JSON.parse(msg))
//                );
//            } catch (err) {
//                console.error("Error processing message:", err);
//            }
//        });
//
//        ws.on("close", () => {
//            console.log("WebSocket disconnected.");
//            this.handleDisconnect(ws);
//        });
//    }
//
//    async handleMessage(ws, message) {
//        let client;
//
//        if (message.type === "init") client = await this.handleInit(ws, message);
//        if (!client && ws.secret) client = this.clientBySecret.get(ws.secret);
//        if (!client) {
//            console.error("Unable to resolve Client, aborting message processing.");
//            return;
//        }
//
//        client.lastSeen = Date.now();
//
//        this.emit(message.type, message);
//    }
//
//    async handleInit(ws, message) {
//        let client;
//
//        let initResponse = {
//            type: "init",
//            keepAliveTimeout: this.keepAliveTimeout,
//        };
//
//        if (message.clientSecret) {
//            client = this.clientBySecret.get(message.clientSecret);
//            if (client) {
//                initResponse.rejoin = true;
//            } else {
//                let dirPath = path.join(this.dataDir, "client");
//                try {
//                    const matchingFile = (await fs.promises.readdir(dirPath)).find(
//                        (file) => file.endsWith(`-${message.clientSecret}.json`)
//                    );
//
//                    if (matchingFile) {
//                        const filePath = path.join(dirPath, matchingFile);
//                        const content = await fs.promises.readFile(filePath, "utf8");
//                        client = JSON.parse(content);
//                        console.log(`Loaded client from disk`);
//                    }
//                } catch (err) {
//                    if (err.code !== "ENOENT") console.log(err);
//                }
//            }
//        }
//
//        if (!client) {
//            console.log("Creating new client");
//            client = {
//                id: await this.generateId(),
//                secret: await this.generateId(),
//            };
//            this.persistClient(client);
//            initResponse.clientSecret = client.secret;
//        }
//
//        if (!this.bufferByClient.has(client)) this.bufferByClient.set(client, []);
//
//        this.clients.set(client.id, client);
//        this.clientBySecret.set(client.secret, client);
//        this.wsByClient.set(client, ws);
//        ws.secret = client.secret;
//
//        initResponse.clientId = client.id;
//        this.send(client, initResponse);
//
//        this.emit("connected", {
//            client,
//            isNew: initResponse.clientSecret ? true : false,
//            isRejoin: initResponse.rejoin ? true : false,
//        });
//
//        return client;
//    }
//
//    handleDisconnect(ws) {
//        console.log("Handling disconnect...");
//        const client = this.clientBySecret.get(ws.secret);
//        if (client) {
//            console.log(`Client ${client.id} disconnected.`);
//            this.emit("clientDisconnect", client);
//        }
//    }
//
//    handleInactiveClient(client) {
//        console.log(`Removing inactive client: ${client.id}`);
//        const ws = this.wsByClient.get(client);
//        if (ws && ws.readyState === WebSocket.OPEN) ws.close();
//        this.clients.delete(client.id);
//        this.clientBySecret.delete(client.secret);
//        this.wsByClient.delete(client);
//        this.bufferByClient.delete(client);
//    }
//
//    send(client, message) {
//        this.bufferByClient.get(client).push(JSON.stringify(message));
//    }
//
//    async persistClient(item) {
//        console.log(`Persisting client with ID: ${item.id}`);
//        const dirPath = path.join(this.dataDir, "client");
//        await fs.promises.mkdir(dirPath, { recursive: true });
//        const filename = path.join(dirPath, `${item.id}-${item.secret}.json`);
//        fs.promises.writeFile(filename, JSON.stringify(item, null, 2));
//    }
//
//    async generateId() {
//        let id;
//        while (!id || this.usedIds.has(id))
//            id = Math.random().toString(36).substring(2, 6);
//        this.usedIds.set(id, null);
//        return id;
//    }
//}
//
//const objects = new Map();
//let rootObject;
//
//const server = new GameServer({ port: 8080, keepAliveTimeout: 30000 });
//
//console.log("Loading persisted World...");
//
//// Function to parse a line into an object
//function parseLine(line, parentStack) {
//    console.log(line);
//    const indentLevel = (line.match(/\│/g) || []).length;
//    const match = line.match(/(\w+)-(\w+) \(([^)]+)\) \{([^}]+)\}/);
//
//    if (!match) return null;
//
//    const [, type, id, name, propertiesStr] = match;
//    const properties = Object.fromEntries(
//        propertiesStr.split(", ").map((prop) => {
//            const [key, value] = prop.split(": ");
//            return [key, parseFloat(value) || value];
//        })
//    );
//
//    const object = { id, type, name, ...properties, parent: null, contents: [] };
//
//    if (indentLevel > 0) {
//        const parent = parentStack[indentLevel - 1];
//        if (parent) {
//            object.parent = parent.id;
//            parent.contents.push(id);
//        }
//    } else {
//        rootObject = object;
//    }
//
//    parentStack[indentLevel] = object;
//    objects.set(id, object);
//    updateObjectStreamJSON(object);
//    server.usedIds.set(id, null);
//}
//
//// Function to parse a file line by line
//async function parseFile(filePath) {
//    const fileStream = fs.createReadStream(filePath);
//    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
//
//    const parentStack = [];
//
//    for await (const line of rl) {
//        parseLine(line.trim(), parentStack);
//    }
//}
//
//await parseFile(path.join(server.dataDir, "objects.txt"));
//
//console.log(`Loaded ${objects.size} objects`);
//
//function persistObject(object, dirPath) {
//    dirPath = path.join(dirPath, `${object.type}-${object.id}`);
//    fs.mkdirSync(dirPath, { recursive: true });
//    const properties = Object.assign({}, object);
//    delete properties.type;
//    delete properties.id;
//    delete properties.parent;
//    delete properties.contents;
//    const filePath = path.join(dirPath, "properties.json");
//    fs.writeFileSync(filePath, JSON.stringify(properties, null, 2));
//    for (const id of object.contents) persistObject(objects.get(id), dirPath);
//}
//
//function updateObjectStreamJSON(object) {
//    object.streamJSON = {
//        o: `${object.type}-${object.id}`,
//        p: {},
//    };
//    Object.assign(object.streamJSON.p, object);
//    delete object.streamJSON.p.type;
//    delete object.streamJSON.p.id;
//    delete object.streamJSON.p.parent;
//    delete object.streamJSON.p.contents;
//    delete object.streamJSON.p.streamJSON;
//
//    if (object.parent) object.streamJSON.o += `-${object.parent}`;
//}
//
//function exitHandler(options, exitCode) {
//    if (options.cleanup) {
//        const objectsDir = path.join(server.dataDir, "objects");
//        const tmpDir = path.join(server.dataDir, "tmp");
//        persistObject(rootObject, tmpDir);
//        fs.rmSync(objectsDir, { recursive: true, force: true });
//        fs.renameSync(tmpDir, objectsDir);
//        console.log(`Persisted ${objects.size} objects to disk`);
//    }
//    if (exitCode || exitCode === 0) console.log(exitCode);
//    if (options.exit) process.exit();
//}
//
//// do something when app is closing
//process.on("exit", exitHandler.bind(null, { cleanup: true }));
//
//// catches ctrl+c event
//process.on("SIGINT", exitHandler.bind(null, { exit: true }));
//
//// catches "kill pid" (for example: nodemon restart)
//process.on("SIGUSR1", exitHandler.bind(null, { exit: true }));
//process.on("SIGUSR2", exitHandler.bind(null, { exit: true }));
//
//// catches uncaught exceptions
//process.on("uncaughtException", exitHandler.bind(null, { exit: true }));
//
//server.on("connected", ({ client, isNew, isRejoin }) => {
//    if (!isRejoin) {
//        server.send(client, {
//            type: "message",
//            channel: "global",
//            content: `Welcome${isNew ? "" : " back"} ${client.id}!`,
//        });
//    }
//    for (const [id, object] of objects) server.send(client, object.streamJSON);
//});

import WebSocket, { WebSocketServer } from "ws";
import { EventEmitter } from "events";
import fs from "fs";
import readline from "readline";
import path from "path";

const events = new EventEmitter();
const config = { port: 8080, dataDir: "./data", keepAliveTimeout: 30000 };

const state = {
    id_object: new Map(),
    id_parentId: new Map(),
    id_contentIds: new Map(),
    id_buffer: new Map(),
    id_dirty: new Map(),
    root: null,
    secret_object: new Map(),
    secret_object_connected: new Map(),
    id_ws: new Map(),
};

async function initialise() {
    console.log("Initializing game server...");
    await loadData();
    await saveData();
    const wss = new WebSocketServer({ port: config.port });
    wss.on("connection", handleConnection);
    //startMaintenance();
    console.log(`Game server running on port ${config.port}`);
}

function handleConnection(ws) {
    console.log("WebSocket connected.");
    ws.on("message", (data) => handleMessage(ws, data.toString()));
}

async function handleMessage(ws, msg) {
    try {
        msg.split("\n").forEach(async (m) => {
            const message = JSON.parse(m);
            let client = resolveClient(ws, message);
            if (!client) return;
            client.lastSeen = Date.now();
            events.emit(message.type, message);
        });
    } catch (err) {
        console.error("Error processing message:", err);
    }
}

async function loadData() {
    const filePath = path.join(config.dataDir, "objects.txt");
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    const parentStack = [];

    for await (let line of rl) {
        line = line.trim();
        const indentLevel = (line.match(/(│|├)/g) || []).length;
        const match = line.match(/(\w+)-(\w+) \(([^)]*)\) \{([^}]+)\}/);

        if (!match) continue;

        console.log(line);

        const [, type, id, name, propertiesStr] = match;
        const properties = Object.fromEntries(
            propertiesStr.split(", ").map((prop) => {
                const [key, value] = prop.split(": ");
                return [key, parseFloat(value) || value];
            })
        );

        const obj = { id, type, name, ...properties };

        if (indentLevel > 0) {
            const parent = parentStack[indentLevel - 1];
            if (parent) {
                state.id_parentId.set(id, parent.id);
                state.id_contentIds.get(parent.id).push(id);
            }
        } else {
            state.root = obj;
        }

        parentStack[indentLevel] = obj;
        state.id_object.set(id, obj);
        state.id_contentIds.set(id, []);
        state.id_dirty.set(id, obj);
    }

    console.log(`${state.id_object.size} objects loaded`);
}

async function saveData() {
    const filePath = path.join(config.dataDir, "objects.txt");
    const fileStream = fs.createWriteStream(filePath);
    let saved = 0;

    function writeObject(id, indentLevel = 0) {
        const obj = state.id_object.get(id);
        if (!obj) return;

        let indent = "│ ".repeat(indentLevel);
        if (indent.length > 0) indent = `${indent.substring(0, indent.length - 2)}├ `;
        const properties = Object.entries(obj)
            .filter(([key]) => !["id", "type", "name"].includes(key))
            .map(([key, value]) => `${key}: ${value}`)
            .join(", ");

        fileStream.write(`${indent}${obj.type}-${obj.id} (${obj.name}) {${properties}}
`);
        saved++;

        const children = state.id_contentIds.get(id) || [];
        for (const childId of children) {
            writeObject(childId, indentLevel + 1);
        }
    }

    if (state.root) {
        writeObject(state.root.id);
    }

    fileStream.end();
    console.log(`${saved} objects saved`);
}

function resolveClient(ws, message) {
    if (message.type === "init") return handleInit(ws, message);
    return ws.secret ? state.secret_object.get(ws.secret) : null;
}

async function handleInit(ws, message) {
    let client;

    let initResponse = {
        type: "init",
        keepAliveTimeout: config.keepAliveTimeout,
    };

    if (message.clientSecret) {
        client = state.secret_object_connected.get(message.clientSecret);
        if (client) {
            initResponse.rejoin = true;
        } else {
            client = state.secret_object.get(message.clientSecret);
        }
    }

    if (!client) {
        console.log("Creating new client");
        client = {
            id: await this.generateId(),
            secret: await this.generateId(),
        };
        initResponse.clientSecret = client.secret;
    }

    if (!state.id_buffer.has(client)) state.id_buffer.set(client.id, []);

    state.secret_object.set(client.secret, client);
    state.secret_object_connected.set(client.secret, client);
    state.id_ws.set(client.id, ws);

    ws.secret = client.secret;

    initResponse.clientId = client.id;

    send(client, initResponse);

    events.emit("connected", {
        client,
        isNew: initResponse.clientSecret ? true : false,
        isRejoin: initResponse.rejoin ? true : false,
    });

    return client;
}

function send(client, message) {
    state.id_buffer.get(client.id).push(JSON.stringify(message));
}

events.on("connected", ({ client, isNew, isRejoin }) => {
    if (!isRejoin) {
        send(client, {
            type: "message",
            channel: "global",
            content: `Welcome${isNew ? "" : " back"} ${client.id}!`,
        });
    }
    for (const [id, msg] of state.id_dirty) send(client, msg);
});

initialise();
