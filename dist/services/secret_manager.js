"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecretManager = void 0;
let vaultConfig = null;
let vaultSecrets = null;
function detectBackend() {
    if (process.env.SECRET_BACKEND === "vault")
        return "vault";
    return "env";
}
async function fetchVaultSecrets() {
    const addr = process.env.VAULT_ADDR;
    const token = process.env.VAULT_TOKEN;
    const path = process.env.VAULT_PATH || "secret/data/bot";
    if (!addr || !token) {
        console.error("VAULT_ADDR and VAULT_TOKEN must be set when SECRET_BACKEND=vault");
        return {};
    }
    vaultConfig = { addr: addr.replace(/\/+$/, ""), token, path };
    try {
        const url = `${vaultConfig.addr}/v1/${vaultConfig.path}`;
        const res = await fetch(url, {
            headers: { "X-Vault-Token": vaultConfig.token },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
            console.error(`Vault fetch failed: ${res.status} ${res.statusText}`);
            return {};
        }
        const body = await res.json();
        const data = body?.data?.data || body?.data || {};
        vaultSecrets = {};
        for (const [k, v] of Object.entries(data)) {
            if (typeof v === "string")
                vaultSecrets[k] = v;
        }
        console.info(`SecretManager: loaded ${Object.keys(vaultSecrets).length} secrets from Vault`);
        return vaultSecrets;
    }
    catch (e) {
        console.error(`Vault connection error: ${e.message}`);
        return {};
    }
}
exports.SecretManager = {
    async init() {
        const backend = detectBackend();
        console.info(`SecretManager backend: ${backend}`);
        if (backend === "vault") {
            await fetchVaultSecrets();
        }
    },
    get(key) {
        const backend = detectBackend();
        if (backend === "vault" && vaultSecrets) {
            return vaultSecrets[key] ?? process.env[key];
        }
        return process.env[key];
    },
    getOrThrow(key) {
        const val = this.get(key);
        if (!val)
            throw new Error(`Required secret not found: ${key}`);
        return val;
    },
    getInt(key) {
        const val = this.get(key);
        return val ? parseInt(val.trim(), 10) || null : null;
    },
    getAllMatching(prefix) {
        const result = {};
        const backend = detectBackend();
        if (backend === "vault" && vaultSecrets) {
            for (const [k, v] of Object.entries(vaultSecrets)) {
                if (k.toUpperCase().startsWith(prefix.toUpperCase()))
                    result[k] = v;
            }
        }
        for (const [k, v] of Object.entries(process.env)) {
            if (k.toUpperCase().startsWith(prefix.toUpperCase()) && v) {
                if (!result[k])
                    result[k] = v;
            }
        }
        return result;
    },
    getBackend() {
        return detectBackend();
    },
    isVaultReady() {
        return detectBackend() === "vault" && vaultSecrets !== null;
    },
    getKeyReport() {
        const counts = {};
        for (const prefix of ["GROQ", "GEMINI", "GOOGLE", "CEREBRAS", "OPENROUTER", "OPENAI"]) {
            const keys = this.getAllMatching(prefix);
            const count = Object.values(keys).filter(v => v.length >= 8).length;
            if (count > 0)
                counts[prefix] = count;
        }
        return counts;
    }
};
