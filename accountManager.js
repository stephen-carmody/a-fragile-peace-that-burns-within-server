import fs from "fs";
import path from "path";

const dataDir = "./data/account";

// Ensure the data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Maps to store accounts and their metadata
const accounts = new Map(); // Key: accountId, Value: { accountId, name, type, clientIds, isNew }

/**
 * Generates a random ID for new accounts.
 * @returns {string} A random alphanumeric string.
 */
const generateRandomId = () => Math.random().toString(36).substring(2, 15);

/**
 * Creates a new guest account.
 * @returns {object} The new account object.
 */
export const createGuestAccount = () => {
    const accountId = generateRandomId();
    const account = {
        accountId,
        name: `Guest-${accountId}`,
        type: "guest",
        clientIds: [],
        isNew: true, // Volatile property to indicate if the account is new
    };
    accounts.set(accountId, account);
    persistAccountToDisk(account);
    return account;
};

/**
 * Resolves an account for a client.
 * If the client has an accountId, it either matches an already loaded account or loads it from disk.
 * If no accountId is found, a new guest account is created.
 * @param {object} client - The client object.
 * @returns {object} The resolved account object.
 */
export const resolveAccount = (client) => {
    if (client.accountId) {
        // Check if the account is already loaded
        const account = accounts.get(client.accountId);
        if (account) {
            return account;
        }

        // Load the account from disk
        const loadedAccount = loadAccountFromDisk(client.accountId);
        if (loadedAccount) {
            accounts.set(loadedAccount.accountId, loadedAccount);
            return loadedAccount;
        }
    }

    // Create a new guest account if no accountId is found
    const newAccount = createGuestAccount();
    client.accountId = newAccount.accountId; // Assign the new accountId to the client
    return newAccount;
};

/**
 * Updates the name of an account.
 * @param {string} accountId - The account ID.
 * @param {string} newName - The new account name.
 */
export const updateAccountName = (accountId, newName) => {
    const account = accounts.get(accountId);
    if (account) {
        account.name = newName;
        persistAccountToDisk(account);
    }
};

/**
 * Persists an account to disk.
 * @param {object} account - The account object.
 */
const persistAccountToDisk = (account) => {
    const filePath = path.join(dataDir, `account-${account.accountId}.json`);
    const accountData = {
        accountId: account.accountId,
        name: account.name,
        type: account.type,
        clientIds: account.clientIds,
    };
    fs.writeFileSync(filePath, JSON.stringify(accountData, null, 2));
};

/**
 * Loads an account from disk.
 * @param {string} accountId - The account ID.
 * @returns {object|null} The account object, or null if not found.
 */
const loadAccountFromDisk = (accountId) => {
    const filePath = path.join(dataDir, `account-${accountId}.json`);
    if (fs.existsSync(filePath)) {
        const accountData = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return {
            ...accountData,
            isNew: false, // Set isNew to false for loaded accounts
        };
    }
    return null;
};
