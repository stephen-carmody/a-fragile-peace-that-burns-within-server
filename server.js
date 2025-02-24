import WebSocket, { WebSocketServer } from "ws";
import { EventEmitter } from "events";
import fs from "fs";
import readline from "readline";
import path from "path";

const events = new EventEmitter();
const config = { port: 8080, dataDir: "./data", keepAliveTimeout: 30000 };

config.dataObjectsPath = path.join(config.dataDir, "objects.txt");

const state = {
    id_object: new Map(),
    id_children: new Map(),
    id_sendbuffer: new Map(),
    id_dirty: new Map(),
    root: null,
    clients: null,
    world: null,
    id_snapshot: new Map(),
    player_spawn: null,
    secret_client: new Map(),
    secret_client_connected: new Map(),
    id_ws: new Map(),
    save_on_exit: false,
};

async function initialise() {
    console.log("Initialising game server...");
    await loadData();
    maintenance();
    const wss = new WebSocketServer({ port: config.port });
    wss.on("connection", handleConnection);
    setInterval(maintenance, 2000);
    console.log(`Game server running on port ${config.port}`);
}

async function loadData() {
    const filePath = path.join(config.dataDir, "objects.txt");
    const fileStream = fs.createReadStream(config.dataObjectsPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    const parentStack = [];

    // Clear object state
    state.id_object.clear();
    state.id_children.clear();
    state.id_dirty.clear();
    state.root = null;

    // Disable save on exit to avoid corrupting data on failed read
    state.save_on_exit = false;

    for await (let line of rl) {
        line = line.trim();
        const indentLevel = (line.match(/(│|├)/g) || []).length;
        const match = line.match(
            /(\w+)-(\w+) \(([^)]*)\) \[([^,]+),([^,]+),([^\]]+)\] ([^\}]+\})/
        );

        if (!match) throw new Error(`failed to parse line:\n${line}`);

        console.log(line);

        const [, type, id, name, quality, damage, weight, rest] = match;
        const parent = parentStack[indentLevel - 1];
        const obj = createObject({
            id,
            type,
            name,
            parent_id: parent?.id,
            quality: parseFloat(quality),
            damage: parseFloat(damage),
            weight: parseFloat(weight),
            ...JSON.parse(rest),
        });
        parentStack[indentLevel] = obj;
        if (obj.type === "client") state.secret_client.set(obj.secret, obj);
        if (obj.type === "player") obj.ghost = true;
        if (obj.player_spawn) state.player_spawn = obj;
    }

    // Enable save on exit now we have finished loading successfully
    state.save_on_exit = true;

    console.log(`${state.id_object.size} objects loaded`);
}

async function saveData() {
    let buffer = "";

    function writeObject(id, indentLevel = 0) {
        const obj = state.id_object.get(id);
        if (!obj) return;

        let indent = "│".repeat(indentLevel);
        if (indent.length > 0) indent = `${indent.substring(0, indent.length - 1)}├ `;
        const common_properties = [obj.quality, obj.damage, obj.weight];
        const rest = Object.assign({}, obj);
        for (const property of [
            "id",
            "type",
            "name",
            "parent_id",
            "quality",
            "damage",
            "weight",
            "ghost",
        ])
            delete rest[property];

        buffer += `${indent}${obj.type}-${obj.id} (${obj.name}) [${common_properties}] ${JSON.stringify(rest)}
`;

        const children = state.id_children.get(id) || [];
        for (const childId of children) {
            writeObject(childId, indentLevel + 1);
        }
    }

    if (state.root) writeObject(state.root.id);

    const tmpPath = path.join(config.dataDir, "objects.tmp");
    fs.writeFileSync(tmpPath, buffer);
    fs.rmSync(config.dataObjectsPath, { force: true });
    fs.renameSync(tmpPath, config.dataObjectsPath);

    console.log(`${buffer.split("\n").length} objects saved`);
}

function generateId() {
    let id;
    while (!id || state.id_object.has(id))
        id = Math.random().toString(36).substring(2, 6);
    return id;
}

function createObject({
    id = generateId(),
    type = "undefined",
    name = "",
    parent_id = null,
    quality = 1,
    damage = 0,
    weight = 0,
    ...rest
}) {
    if (state.id_object.has(id)) {
        throw new Error(`Object id "${id}" not unique`);
    }

    const obj = {
        id,
        type,
        name,
        quality,
        damage,
        weight,
        ...rest,
    };

    if (type === "root") {
        if (state.root) throw new Error("Root object already exists");
        parent_id = null;
        state.root = obj;
    } else if (type === "clients") {
        if (state.clients) throw new Error("Clients object already exists");
        state.clients = obj;
    } else if (type === "client") {
        parent_id = state.clients.id;
    } else if (type === "world") {
        if (state.world) throw new Error("World object already exists");
        parent_id = state.root.id;
        state.world = obj;
        state.id_dirty.set(id, obj);
    } else {
        if (!parent_id) parent_id = state.world;
        state.id_dirty.set(id, obj);
    }

    if (parent_id) {
        obj.parent_id = parent_id;
        state.id_children.set(parent_id, [
            ...(state.id_children.get(parent_id) || []),
            id,
        ]);
    }

    state.id_object.set(id, obj);

    return obj;
}

function updateObject(obj) {
    if (!obj) return;

    // No snapshot for objects with ghost property (i.e. unconnected player objects)
    if (obj.ghost) {
        state.id_snapshot.delete(obj.id);
        return;
    }

    // Update the client snapshot of the object
    const rest = Object.assign({}, obj);
    for (const property of [
        "id",
        "type",
        "name",
        "parent_id",
        "quality",
        "damage",
        "weight",
    ])
        delete rest[property];

    let snapshot = `{"o":"${obj.parent_id};${obj.id};${obj.type};${obj.name};${obj.quality};${obj.damage};${obj.weight}`;

    for (const [key, value] of Object.entries(rest)) {
        snapshot += `;${key}=${value}`;
    }
    snapshot += '"}';

    state.id_snapshot.set(obj.id, snapshot);
}

function exitHandler(options, exitCode) {
    if (state.save_on_exit) saveData();
    if (exitCode || exitCode === 0) console.log(exitCode);
    if (options.exit) process.exit();
}

// do something when app is closing
process.on("exit", exitHandler.bind(null, {}));

// catches ctrl+c event
process.on("SIGINT", exitHandler.bind(null, { exit: true }));

// catches "kill pid" (for example: nodemon restart)
process.on("SIGUSR1", exitHandler.bind(null, { exit: true }));
process.on("SIGUSR2", exitHandler.bind(null, { exit: true }));

// catches uncaught exceptions
process.on("uncaughtException", exitHandler.bind(null, { exit: true }));

function maintenance() {
    const now = Date.now();
    const dirty_snapshots = [];

    for (const [id, obj] of state.id_dirty) {
        updateObject(obj);
        const snapshot = state.id_snapshot.get(id);
        if (snapshot) dirty_snapshots.push(snapshot);
        state.id_dirty.delete(id);
    }

    for (const [, client] of state.secret_client_connected.entries()) {
        if (client.lastSeen && now - client.lastSeen > config.keepAliveTimeout)
            handleInactiveClient(client);
        const sendbuffer = state.id_sendbuffer.get(client.id);
        dirty_snapshots.push(...sendbuffer);
        if (dirty_snapshots.length) {
            console.log(`Sent Client ${client.id} ->`, dirty_snapshots);
            const ws = state.id_ws.get(client.id);
            ws.send(dirty_snapshots.join("\n"));
        }
        sendbuffer.length = 0;
    }
}

function attachClientPC(client) {
    let player;

    if (client.player_id) player = state.id_object.get(client.player_id);

    if (!player) {
        player = createObject({
            type: "player",
            parent_id: state.player_spawn.id,
            quality: 0.5,
            damage: 0,
            weight: 90,
            client_id: client.id,
        });
        player.name = `Guest-${player.id}`;
        client.player_id = player.id;
    }

    delete player.ghost;
    state.id_dirty.set(player.id, player);
}

function handleInactiveClient(client) {
    console.log(`Removing inactive client: ${client.id}`);
    const ws = state.id_ws.get(client.id);
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    state.id_snapshot.delete(client.id);
    state.id_sendbuffer.delete(client.id);
    state.secret_client_connected.delete(client.secret);
    state.id_ws.delete(client.id);
    broadcast({ type: "disconnected", id: client.id });
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

function resolveClient(ws, message) {
    if (message.type === "init") return handleInit(ws, message);
    return ws.secret ? state.secret_client_connected.get(ws.secret) : null;
}

async function handleInit(ws, message) {
    let client;

    let initResponse = {
        type: "init",
        keepAliveTimeout: config.keepAliveTimeout,
    };

    if (message.clientSecret) {
        client = state.secret_client_connected.get(message.clientSecret);
        if (client) {
            initResponse.isRejoin = true;
            console.log(`handleInit: Rejoined Client.id=${client.id}`);
        } else {
            client = state.secret_client.get(message.clientSecret);
            console.log(
                `handleInit: Matched secret "${client.secret}" -> Client.id=${client.id}`
            );
            attachClientPC(client);
        }
    }

    if (!client) {
        console.log("handleInit: Creating new client");
        client = createObject({ type: "client", secret: generateId() });
        initResponse.clientSecret = client.secret;
        attachClientPC(client);
    }

    client.lastSeen = Date.now();

    state.secret_client.set(client.secret, client);
    state.secret_client_connected.set(client.secret, client);
    state.id_ws.set(client.id, ws);

    ws.secret = client.secret;

    initResponse.clientId = client.id;

    initResponse.player_id = client.player_id;

    if (!state.id_sendbuffer.has(client.id)) state.id_sendbuffer.set(client.id, []);

    send(client, initResponse);

    events.emit("connected", {
        client,
        isNew: initResponse.clientSecret ? true : false,
        isRejoin: initResponse.isRejoin ? true : false,
    });

    return client;
}

function send(client, message) {
    state.id_sendbuffer.get(client.id).push(JSON.stringify(message));
}

function broadcast(message) {
    const stringified = JSON.stringify(message);
    for (const [, client] of state.secret_client_connected.entries()) {
        state.id_sendbuffer.get(client.id).push(stringified);
    }
}

events.on("connected", ({ client, isNew, isRejoin }) => {
    if (!isRejoin) {
        send(client, {
            type: "chat",
            channel: "global",
            content: `Welcome${isNew ? "" : " back"} ${client.id}!`,
        });
    }

    const client_sendbuffer = state.id_sendbuffer.get(client.id);

    function sendObjectSendBuffer(obj_id) {
        const snapshot = state.id_snapshot.get(obj_id);
        if (snapshot) client_sendbuffer.push(snapshot);
        for (const child_id of state.id_children.get(obj_id) || []) {
            sendObjectSendBuffer(child_id);
        }
    }

    sendObjectSendBuffer(state.world.id);
});

await initialise();
