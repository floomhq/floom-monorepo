import { createCipheriv, createDecipheriv, createHash, randomBytes, } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const CHILD_SCRIPT = `
import { readFileSync } from 'node:fs';
const payload = JSON.parse(readFileSync(0, 'utf8'));
const { KeyManagementServiceClient } = await import('@google-cloud/kms');
const client = new KeyManagementServiceClient(
  payload.projectId ? { projectId: payload.projectId } : undefined
);
if (payload.op === 'encrypt') {
  const [response] = await client.encrypt({
    name: payload.keyName,
    plaintext: Buffer.from(payload.value, 'base64'),
  });
  process.stdout.write(Buffer.from(response.ciphertext ?? []).toString('base64'));
} else if (payload.op === 'decrypt') {
  const [response] = await client.decrypt({
    name: payload.keyName,
    ciphertext: Buffer.from(payload.value, 'base64'),
  });
  process.stdout.write(Buffer.from(response.plaintext ?? []).toString('base64'));
} else {
  throw new Error('unknown KMS op: ' + payload.op);
}
`;
class GcpKmsDekWrapper {
    keyName;
    projectId;
    constructor(keyName, projectId) {
        this.keyName = keyName;
        this.projectId = projectId;
    }
    encryptDek(dek) {
        return this.call('encrypt', dek);
    }
    decryptDek(encryptedDek) {
        return this.call('decrypt', encryptedDek);
    }
    call(op, value) {
        const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', CHILD_SCRIPT], {
            input: JSON.stringify({
                op,
                keyName: this.keyName,
                projectId: this.projectId,
                value: value.toString('base64'),
            }),
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
        });
        return Buffer.from(stdout.trim(), 'base64');
    }
}
class XorDekWrapper {
    mask = createHash('sha256')
        .update('floom-gcp-kms-conformance')
        .digest();
    encryptDek(dek) {
        return this.xor(dek);
    }
    decryptDek(encryptedDek) {
        return this.xor(encryptedDek);
    }
    xor(input) {
        const out = Buffer.alloc(input.length);
        for (let i = 0; i < input.length; i++) {
            out[i] = input[i] ^ this.mask[i % this.mask.length];
        }
        return out;
    }
}
export function createMockGcpKmsDekWrapper() {
    return new XorDekWrapper();
}
export function createGcpKmsSecretsAdapter(opts) {
    const storage = requireSecretStorage(opts.storage);
    const kms = opts.kmsClient ??
        (process.env.FLOOM_GCP_KMS_MOCK === '1'
            ? createMockGcpKmsDekWrapper()
            : new GcpKmsDekWrapper(opts.keyName, opts.projectId));
    const adapter = {
        get(ctx, key) {
            const row = storage.getUserSecretRow(ctx.workspace_id, ctx.user_id, key);
            return row ? decryptSecretRow(kms, row) : null;
        },
        set(ctx, key, plaintext) {
            storage.upsertUserSecretRow({
                workspace_id: ctx.workspace_id,
                user_id: ctx.user_id,
                key,
                ...encryptSecret(kms, plaintext),
            });
        },
        delete(ctx, key) {
            return storage.deleteUserSecretRow(ctx.workspace_id, ctx.user_id, key);
        },
        list(ctx) {
            return storage.listUserSecretMetadata(ctx.workspace_id, ctx.user_id);
        },
        loadUserVaultForRun(ctx, keys) {
            const rows = storage.listUserSecretRows(ctx.workspace_id, ctx.user_id, keys);
            return decryptRows(kms, rows);
        },
        loadCreatorOverrideForRun(app_id, _workspace_id, keys) {
            const rows = storage.listCreatorOverrideSecretRowsForRun(app_id, keys);
            return decryptRows(kms, rows);
        },
        __setCreatorOverrideForTests(app_id, workspace_id, key, plaintext) {
            storage.setSecretPolicy(app_id, key, 'creator_override');
            storage.upsertCreatorSecretRow({
                app_id,
                workspace_id,
                key,
                ...encryptSecret(kms, plaintext),
            });
        },
    };
    return adapter;
}
function requireSecretStorage(storage) {
    const methods = [
        'getUserSecretRow',
        'listUserSecretRows',
        'listUserSecretMetadata',
        'upsertUserSecretRow',
        'deleteUserSecretRow',
        'setSecretPolicy',
        'upsertCreatorSecretRow',
        'listCreatorOverrideSecretRowsForRun',
    ];
    const missing = methods.filter((method) => typeof storage[method] !== 'function');
    if (missing.length > 0) {
        throw new Error(`GCP KMS SecretsAdapter requires encrypted secret storage methods: ${missing.join(', ')}`);
    }
    return storage;
}
function encryptSecret(kms, plaintext) {
    const dek = randomBytes(32);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek, nonce);
    const ciphertext = Buffer.concat([
        cipher.update(Buffer.from(plaintext, 'utf8')),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const encryptedDek = kms.encryptDek(dek);
    return {
        ciphertext: ciphertext.toString('hex'),
        nonce: nonce.toString('hex'),
        auth_tag: authTag.toString('hex'),
        encrypted_dek: encryptedDek.toString('base64'),
    };
}
function decryptSecretRow(kms, row) {
    if (!row.encrypted_dek) {
        throw new Error(`secret row ${row.key} is missing encrypted_dek`);
    }
    const dek = kms.decryptDek(Buffer.from(row.encrypted_dek, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', dek, Buffer.from(row.nonce, 'hex'));
    decipher.setAuthTag(Buffer.from(row.auth_tag, 'hex'));
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(row.ciphertext, 'hex')),
        decipher.final(),
    ]);
    return plaintext.toString('utf8');
}
function decryptRows(kms, rows) {
    const out = {};
    for (const row of rows) {
        try {
            out[row.key] = decryptSecretRow(kms, row);
        }
        catch {
            continue;
        }
    }
    return out;
}
export default {
    kind: 'secrets',
    name: 'gcp-kms',
    protocolVersion: '^0.2',
    create(opts) {
        const keyName = opts.keyName ||
            process.env.FLOOM_GCP_KMS_KEY_NAME ||
            process.env.FLOOM_SECRETS_GCP_KMS_KEY_NAME ||
            (process.env.FLOOM_GCP_KMS_MOCK === '1'
                ? 'projects/test/locations/global/keyRings/test/cryptoKeys/test'
                : '');
        if (!keyName) {
            throw new Error('GCP KMS SecretsAdapter requires keyName or FLOOM_GCP_KMS_KEY_NAME');
        }
        if (!opts.storage) {
            throw new Error('GCP KMS SecretsAdapter requires a storage adapter');
        }
        return createGcpKmsSecretsAdapter({
            keyName,
            projectId: opts.projectId || process.env.GOOGLE_CLOUD_PROJECT,
            storage: opts.storage,
        });
    },
};
