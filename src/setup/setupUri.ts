/**
 * Encrypted payload for the `obsidian://git-setup` one-tap mobile setup link.
 *
 * The link is self-contained: a random AES-GCM key travels in the link
 * (`k=` parameter) alongside the payload (`d=` parameter, base64url of
 * 12-byte IV || ciphertext). The payload carries an `expiresAt` timestamp
 * sealed under GCM authentication, so a stale or corrupted link fails
 * closed — no passphrase to type on the receiving device.
 */
import type { ObsidianGitSettings } from "../types";

export interface MobileSetupPayload {
    remoteUrl: string;
    settings: Partial<ObsidianGitSettings>;
    /** Epoch milliseconds after which the link must be refused. */
    expiresAt: number;
    /**
     * Commit author for the receiving repo's local config — mobile git
     * (isomorphic-git) never sees the desktop's global gitconfig.
     */
    author?: { name: string; email: string };
}

const IV_LENGTH = 12;
const KEY_LENGTH = 32;

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

/**
 * The subset of settings worth shipping to a phone, plus forced
 * invisible-sync defaults. Kept small so the resulting link fits in a
 * comfortably scannable QR code (~2KB is the practical ceiling).
 */
export function buildMobileSettings(
    settings: ObsidianGitSettings
): Partial<ObsidianGitSettings> {
    return {
        commitMessage: settings.commitMessage,
        autoCommitMessage: settings.autoCommitMessage,
        commitDateFormat: settings.commitDateFormat,
        syncMethod: settings.syncMethod,
        disablePopupsForNoChanges: settings.disablePopupsForNoChanges,
        showErrorNotices: settings.showErrorNotices,
        githubOauthClientId: settings.githubOauthClientId,
        // Desktop-specific paths never apply on the phone.
        basePath: "",
        gitDir: "",
        // Invisible-sync defaults for mobile.
        syncOnAppLifecycle: true,
        autoPullOnBoot: true,
        autoBackupAfterFileChange: true,
        autoSaveInterval: 1,
        pullBeforePush: true,
        disablePopups: true,
        showedMobileNotice: true,
    };
}

/** A fresh random link key, base64url-encoded for the `k=` parameter. */
export function generateSetupKey(): string {
    return toBase64Url(crypto.getRandomValues(new Uint8Array(KEY_LENGTH)));
}

export function isSetupPayloadExpired(
    payload: MobileSetupPayload,
    now: number
): boolean {
    return now > payload.expiresAt;
}

export async function encodeSetupPayload(
    payload: MobileSetupPayload,
    key: string
): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            await importKey(key),
            new TextEncoder().encode(JSON.stringify(payload))
        )
    );

    const packed = new Uint8Array(iv.length + ciphertext.length);
    packed.set(iv);
    packed.set(ciphertext, iv.length);
    return toBase64Url(packed);
}

export async function decodeSetupPayload(
    encoded: string,
    key: string
): Promise<MobileSetupPayload> {
    const packed = fromBase64Url(encoded);
    if (packed.length <= IV_LENGTH) {
        throw new Error("Setup link is corrupted or incomplete.");
    }
    const iv = packed.slice(0, IV_LENGTH);
    const ciphertext = packed.slice(IV_LENGTH);

    let plaintext: ArrayBuffer;
    try {
        plaintext = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            await importKey(key),
            ciphertext
        );
    } catch {
        throw new Error(
            "Could not decrypt setup link. It may be corrupted or from a different device."
        );
    }
    return JSON.parse(
        new TextDecoder().decode(plaintext)
    ) as MobileSetupPayload;
}

async function importKey(key: string): Promise<CryptoKey> {
    const raw = fromBase64Url(key);
    if (raw.length !== KEY_LENGTH) {
        throw new Error("Setup link key is malformed.");
    }
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
        "encrypt",
        "decrypt",
    ]);
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
