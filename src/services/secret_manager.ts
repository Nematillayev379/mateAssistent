type SecretBackend = "env" | "vault";

interface VaultConfig {
  addr: string;
  token: string;
  path: string;
}

let vaultConfig: VaultConfig | null = null;
let vaultSecrets: Record<string, string> | null = null;

function detectBackend(): SecretBackend {
  if (process.env.SECRET_BACKEND === "vault") return "vault";
  return "env";
}

function getLogger() {
  try { return require('../utils/logger').logger; } catch { return console; }
}

async function fetchVaultSecrets(): Promise<Record<string, string>> {
  const logger = getLogger();
  const addr = process.env.VAULT_ADDR;
  const token = process.env.VAULT_TOKEN;
  const path = process.env.VAULT_PATH || "secret/data/bot";

  if (!addr || !token) {
    logger.error("VAULT_ADDR and VAULT_TOKEN must be set when SECRET_BACKEND=vault");
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
      logger.error(`Vault fetch failed: ${res.status} ${res.statusText}`);
      return {};
    }

    const body: Record<string, unknown> = await res.json() as Record<string, unknown>;
    const data = (body?.data && typeof body.data === 'object' && 'data' in (body.data as Record<string, unknown>))
      ? (body.data as Record<string, unknown>).data
      : body?.data || {};
    vaultSecrets = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof v === "string") vaultSecrets[k] = v;
    }
    logger.info(`SecretManager: loaded ${Object.keys(vaultSecrets).length} secrets from Vault`);
    return vaultSecrets;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`Vault connection error: ${msg}`);
    return {};
  }
}

export const SecretManager = {
  async init(): Promise<void> {
    const logger = getLogger();
    const backend = detectBackend();
    logger.info(`SecretManager backend: ${backend}`);
    if (backend === "vault") {
      await fetchVaultSecrets();
    }
  },

  get(key: string): string | undefined {
    const backend = detectBackend();
    if (backend === "vault" && vaultSecrets) {
      return vaultSecrets[key] ?? process.env[key];
    }
    return process.env[key];
  },

  getOrThrow(key: string): string {
    const val = this.get(key);
    if (!val) throw new Error(`Required secret not found: ${key}`);
    return val;
  },

  getInt(key: string): number | null {
    const val = this.get(key);
    return val ? parseInt(val.trim(), 10) || null : null;
  },

  getAllMatching(prefix: string): Record<string, string> {
    const result: Record<string, string> = {};
    const backend = detectBackend();

    if (backend === "vault" && vaultSecrets) {
      for (const [k, v] of Object.entries(vaultSecrets)) {
        if (k.toUpperCase().startsWith(prefix.toUpperCase())) result[k] = v;
      }
    }

    for (const [k, v] of Object.entries(process.env)) {
      if (k.toUpperCase().startsWith(prefix.toUpperCase()) && v) {
        if (!result[k]) result[k] = v;
      }
    }
    return result;
  },

  getBackend(): SecretBackend {
    return detectBackend();
  },

  isVaultReady(): boolean {
    return detectBackend() === "vault" && vaultSecrets !== null;
  },

  getKeyReport(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const prefix of ["GROQ", "GEMINI", "GOOGLE", "CEREBRAS", "OPENROUTER", "OPENAI"]) {
      const keys = this.getAllMatching(prefix);
      const count = Object.values(keys).filter(v => v.length >= 8).length;
      if (count > 0) counts[prefix] = count;
    }
    return counts;
  }
};
