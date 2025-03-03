import WebSocket, { WebSocketServer } from "ws";
import { EventEmitter } from "events";
import fs from "fs";
import readline from "readline";
import path from "path";

const events = new EventEmitter();
const config = { port: 8080, dataDir: "./data", keepAliveTimeout: 30000 };

config.dataObjectsPath = path.join(config.dataDir, "objects.txt");

const state = {
    loaded: false,
    ws_client: new Map(),
    secret_client: new Map(),
    id_object: new Map(),
    id_children: new Map(),
    id_snapshot: new Map(),
    id_sendbuffer: new Map(),
    id_dirty: new Map(),
    obj_root: null,
    obj_clients: null,
    obj_world: null,
    obj_playerspawn: null,
};

let wss;

async function loadState() {
    const fileStream = fs.createReadStream(config.dataObjectsPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    const parentStack = [];

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
        if (obj.playerspawn) state.obj_playerspawn = obj;
    }

    state.loaded = true;
    console.log(`${state.id_object.size} objects loaded`);
}

async function saveState() {
    if (!state.loaded) return;

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

    writeObject(state.obj_root.id);

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
        if (state.obj_root) throw new Error("Root object already exists");
        parent_id = null;
        state.obj_root = obj;
    } else if (type === "clients") {
        if (state.obj_clients) throw new Error("Clients object already exists");
        state.obj_clients = obj;
    } else if (type === "client") {
        parent_id = state.obj_clients.id;
        if (!obj.secret) obj.secret = generateId();
        state.secret_client.set(obj.secret, obj);
        obj.ghost = true;
    } else if (type === "world") {
        if (state.obj_world) throw new Error("World object already exists");
        parent_id = state.obj_root.id;
        state.obj_world = obj;
    } else if (obj.type === "player") {
        obj.ghost = true;
    } else {
        if (!parent_id) parent_id = state.obj_world.id;
    }

    if (parent_id) {
        obj.parent_id = parent_id;
        if (!state.id_children.has(parent_id)) state.id_children.set(parent_id, []);
        state.id_children.get(parent_id).push(id);
    }

    state.id_object.set(id, obj);
    dirty(obj);

    return obj;
}

function updateObject(obj) {
    state.id_dirty.delete(obj.id);

    // No snapshot for client or objects with ghost property
    if (obj.ghost || obj.type === "client") {
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
    saveState();
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
        if (!obj.ghost) {
            const snapshot = state.id_snapshot.get(id);
            if (snapshot) dirty_snapshots.push(snapshot);
        }
    }

    if (!wss) return;

    wss.clients.forEach((ws) => {
        const client = state.ws_client.get(ws);
        if (!client) return console.log("Skipping websocket with no Client");
        if (now - (client.lastSeen || 0) > config.keepAliveTimeout)
            handleInactiveClient(client);
        const sendbuffer = state.id_sendbuffer.get(client.id);
        dirty_snapshots.push(...sendbuffer);
        if (dirty_snapshots.length) {
            console.log(`Sent Client ${client.id} ->`, dirty_snapshots);
            ws.send(dirty_snapshots.join("\n"));
        }
        sendbuffer.length = 0;
    });
}

function handleInactiveClient(ws, client) {
    console.log(`Removing inactive client: ${client.id}`);
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    state.id_snapshot.delete(client.id);
    state.id_sendbuffer.delete(client.id);

    // Mark client and player as ghost to fail rejoin check and make invisible to other clients
    client.ghost = true;
    const player = state.id_object.get(client.player_id);
    if (player) player.ghost = true;

    broadcast({ type: "disconnected", id: client.id });
}

async function handleMessage(ws, msg) {
    try {
        console.log(msg);
        msg.split("\n").forEach(async (m) => {
            const message = JSON.parse(m);
            let client = state.ws_client.get(ws);
            if (client) client.lastSeen = Date.now();
            events.emit(message.type, { ws, client, message });
        });
    } catch (err) {
        console.error("Error processing message:", err);
    }
}

function send(client, message) {
    state.id_sendbuffer.get(client.id).push(JSON.stringify(message));
}

function broadcast(message) {
    message = JSON.stringify(message);
    wss.clients.forEach((ws) => {
        const client = state.ws_client.get(ws);
        state.id_sendbuffer.get(client.id).push(message);
    });
}

function dirty(obj) {
    state.id_dirty.set(obj.id, obj);
}

events.on("init", ({ ws, client, message }) => {
    const initResponse = {
        type: "init",
        keepAliveTimeout: config.keepAliveTimeout,
    };

    if (!client) {
        client = state.secret_client.get(message.clientSecret);

        if (client) {
            console.log(
                `handleInit: Matched secret "${client.secret}" -> Client.id=${client.id}`
            );
        } else {
            console.log("handleInit: Creating new client");
            client = createObject({ type: "client" });
            initResponse.clientSecret = client.secret;
        }

        let player = state.id_object.get(client.player_id);

        if (player) {
            delete player.ghost;
            dirty(player);
        } else {
            player = createObject({
                type: "player",
                parent_id: state.obj_playerspawn.id,
                quality: 0.5,
                damage: 0,
                weight: 90,
                client_id: client.id,
            });
            player.name = `Guest-${player.id}`;
            delete player.ghost;
            client.player_id = player.id;
        }

        state.ws_client.set(ws, client);

        if (!client.ghost) {
            initResponse.isRejoin = true;
            console.log(`handleInit: Rejoined Client.id=${client.id}`);
        } else {
            delete client.ghost;
            state.id_sendbuffer.set(client.id, []);
        }

        client.lastSeen = Date.now();
    }

    initResponse.clientId = client.id;
    initResponse.player_id = client.player_id;

    send(client, initResponse);

    if (!initResponse.isRejoin) {
        send(client, {
            type: "chat",
            channel: "global",
            content: `Welcome${"clientSecret" in initResponse ? "" : " back"} ${client.id}!`,
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

    sendObjectSendBuffer(state.obj_world.id);
});

async function initialise() {
    console.log("Initialising game server...");
    await loadState();
    maintenance();
    wss = new WebSocketServer({ port: config.port });
    wss.on("connection", (ws) => {
        ws.on("message", (data) => handleMessage(ws, data.toString()));
        ws.on("close", () => state.ws_client.delete(ws));
    });
    setInterval(maintenance, 2000);
    console.log(`Game server running on port ${config.port}`);
}

initialise();
