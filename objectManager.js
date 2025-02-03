import fs from "fs";
import path from "path";

const dataDir = "./data/objects";

// Ensure the data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

export function createObjectManager({ onChange } = {}) {
    const objects = new Map(); // Key: objectId, Value: { objectId, name, parent, type, properties }
    const world = createWorld();

    /**
     * Creates the root World object.
     * @returns {object} The World object.
     */
    function createWorld() {
        const world = {
            objectId: "world",
            name: "World",
            parent: null,
            type: "World",
            properties: {},
        };
        objects.set(world.objectId, world);
        return world;
    }

    /**
     * Generates a random ID for new objects.
     * @returns {string} A random alphanumeric string.
     */
    function generateRandomId() {
        return Math.random().toString(36).substring(2, 15);
    }

    /**
     * Creates a new PlayerCharacter object.
     * @param {string} name - The name of the PlayerCharacter.
     * @param {string} accountId - The accountId associated with the PlayerCharacter.
     * @returns {object} The new PlayerCharacter object.
     */
    function createPlayerCharacter(name, accountId) {
        const playerCharacter = {
            objectId: generateRandomId(),
            name,
            parent: world.objectId,
            type: "PlayerCharacter",
            properties: {
                accountId,
            },
        };
        objects.set(playerCharacter.objectId, playerCharacter);
        persistObjectToDisk(playerCharacter);
        if (onChange) {
            onChange(playerCharacter); // Notify listeners of the new object
        }
        return playerCharacter;
    }

    /**
     * Resolves a PlayerCharacter for an account.
     * @param {object} account - The account object to resolve the PlayerCharacter for.
     * @returns {object} The resolved PlayerCharacter object.
     */
    function resolvePlayerCharacter(account) {
        for (const object of objects.values()) {
            if (
                object.type === "PlayerCharacter" &&
                object.properties.accountId === account.accountId
            ) {
                return object;
            }
        }
        // If no PlayerCharacter exists, create one
        return createPlayerCharacter(account.name, account.accountId);
    }

    /**
     * Persists an object to disk.
     * @param {object} object - The object to persist.
     */
    function persistObjectToDisk(object) {
        const filePath = path.join(
            dataDir,
            `${object.objectId}-${object.name}.json`
        );
        fs.writeFileSync(filePath, JSON.stringify(object, null, 2));
    }

    /**
     * Loads all objects from disk.
     */
    function loadObjects() {
        const files = fs.readdirSync(dataDir);
        files.forEach((file) => {
            if (file.endsWith(".json")) {
                const filePath = path.join(dataDir, file);
                const object = JSON.parse(fs.readFileSync(filePath, "utf8"));
                objects.set(object.objectId, object);
            }
        });
    }

    return {
        world,
        objects,
        resolvePlayerCharacter,
        loadObjects,
    };
}
