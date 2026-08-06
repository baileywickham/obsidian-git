/**
 * Encrypted payload for the `obsidian://git-setup` one-tap mobile setup link.
 *
 * Format: base64url( 16-byte PBKDF2 salt || 12-byte AES-GCM IV || ciphertext ).
 * GCM authenticates the ciphertext, so a wrong passphrase or corrupted
 * payload fails closed in `decodeSetupPayload`.
 */
import type { ObsidianGitSettings } from "../types";

export interface MobileSetupPayload {
    remoteUrl: string;
    settings: Partial<ObsidianGitSettings>;
}

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 100_000;

export function rewriteSshToHttps(url: string): string {
    const scpStyle = url.match(/^[\w.-]+@([\w.-]+):(.+)$/);
    if (scpStyle) {
        return `https://${scpStyle[1]}/${scpStyle[2]}`;
    }
    const sshScheme = url.match(
        /^ssh:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+)$/
    );
    if (sshScheme) {
        return `https://${sshScheme[1]}/${sshScheme[2]}`;
    }
    return url;
}

export async function encodeSetupPayload(
    payload: MobileSetupPayload,
    passphrase: string
): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = await deriveKey(passphrase, salt);
    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            key,
            new TextEncoder().encode(JSON.stringify(payload))
        )
    );

    const packed = new Uint8Array(salt.length + iv.length + ciphertext.length);
    packed.set(salt);
    packed.set(iv, salt.length);
    packed.set(ciphertext, salt.length + iv.length);
    return toBase64Url(packed);
}

export async function decodeSetupPayload(
    encoded: string,
    passphrase: string
): Promise<MobileSetupPayload> {
    const packed = fromBase64Url(encoded);
    if (packed.length <= SALT_LENGTH + IV_LENGTH) {
        throw new Error("Setup link is corrupted or incomplete.");
    }
    const salt = packed.slice(0, SALT_LENGTH);
    const iv = packed.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = packed.slice(SALT_LENGTH + IV_LENGTH);

    const key = await deriveKey(passphrase, salt);
    let plaintext: ArrayBuffer;
    try {
        plaintext = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            key,
            ciphertext
        );
    } catch {
        throw new Error(
            "Could not decrypt setup link. Wrong passphrase or corrupted link."
        );
    }
    return JSON.parse(
        new TextDecoder().decode(plaintext)
    ) as MobileSetupPayload;
}

async function deriveKey(
    passphrase: string,
    salt: Uint8Array
): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(passphrase),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: PBKDF2_ITERATIONS,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function fromBase64Url(encoded: string): Uint8Array {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
