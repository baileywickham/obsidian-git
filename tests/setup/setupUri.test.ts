import { describe, expect, it } from "vitest";
import {
    decodeSetupPayload,
    buildMobileSettings,
    encodeSetupPayload,
    generateSetupKey,
    isSetupPayloadExpired,
    rewriteSshToHttps,
    type MobileSetupPayload,
} from "../../src/setup/setupUri";

const PAYLOAD: MobileSetupPayload = {
    remoteUrl: "https://github.com/baileywickham/obsidian.git",
    settings: { disablePopups: true, autoPullOnBoot: true },
    expiresAt: 1_800_000_000_000,
};

describe("rewriteSshToHttps", () => {
    it("rewrites scp-style ssh remotes to https", () => {
        expect(rewriteSshToHttps("git@github.com:bailey/vault.git")).toBe(
            "https://github.com/bailey/vault.git"
        );
    });

    it("rewrites ssh:// remotes to https", () => {
        expect(rewriteSshToHttps("ssh://git@github.com/bailey/vault.git")).toBe(
            "https://github.com/bailey/vault.git"
        );
    });

    it("leaves https remotes untouched", () => {
        expect(rewriteSshToHttps("https://github.com/bailey/vault.git")).toBe(
            "https://github.com/bailey/vault.git"
        );
    });
});

describe("setup payload codec", () => {
    it("round-trips a payload through encode and decode with a link key", async () => {
        const key = generateSetupKey();

        const encoded = await encodeSetupPayload(PAYLOAD, key);
        const decoded = await decodeSetupPayload(encoded, key);

        expect(decoded).toEqual(PAYLOAD);
    });

    it("produces URL-safe output for payload and key", () => {
        const key = generateSetupKey();

        expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("rejects the wrong key", async () => {
        const encoded = await encodeSetupPayload(PAYLOAD, generateSetupKey());

        await expect(
            decodeSetupPayload(encoded, generateSetupKey())
        ).rejects.toThrow();
    });

    it("rejects a truncated payload", async () => {
        const key = generateSetupKey();
        const encoded = await encodeSetupPayload(PAYLOAD, key);

        await expect(
            decodeSetupPayload(encoded.slice(0, 20), key)
        ).rejects.toThrow();
    });
});

describe("isSetupPayloadExpired", () => {
    it("accepts a payload before its expiry", () => {
        expect(isSetupPayloadExpired(PAYLOAD, PAYLOAD.expiresAt - 1000)).toBe(
            false
        );
    });

    it("rejects a payload after its expiry", () => {
        expect(isSetupPayloadExpired(PAYLOAD, PAYLOAD.expiresAt + 1000)).toBe(
            true
        );
    });
});

describe("buildMobileSettings", () => {
    const FULL = {
        commitMessage: "vault backup: {{date}}",
        autoCommitMessage: "vault backup: {{date}}",
        commitDateFormat: "YYYY-MM-DD HH:mm:ss",
        syncMethod: "merge",
        githubOauthClientId: "Ov23xyz",
        basePath: "/Users/bailey/somewhere",
        gitDir: "/custom/gitdir",
        autoPullOnBoot: false,
        autoSaveInterval: 0,
        lineAuthor: { show: true },
        hunks: { showSigns: true },
    } as never;

    it("forces invisible-sync defaults and clears desktop paths", () => {
        const mobile = buildMobileSettings(FULL);

        expect(mobile.basePath).toBe("");
        expect(mobile.gitDir).toBe("");
        expect(mobile.syncOnAppLifecycle).toBe(true);
        expect(mobile.autoPullOnBoot).toBe(true);
        expect(mobile.autoBackupAfterFileChange).toBe(true);
        expect(mobile.autoSaveInterval).toBe(1);
        expect(mobile.pullBeforePush).toBe(true);
        expect(mobile.disablePopups).toBe(true);
    });

    it("carries over commit and auth settings but drops UI-only ones", () => {
        const mobile = buildMobileSettings(FULL) as Record<string, unknown>;

        expect(mobile.commitMessage).toBe("vault backup: {{date}}");
        expect(mobile.githubOauthClientId).toBe("Ov23xyz");
        expect(mobile.lineAuthor).toBeUndefined();
        expect(mobile.hunks).toBeUndefined();
    });

    it("stays small enough for a scannable QR code", async () => {
        const key = generateSetupKey();
        const encoded = await encodeSetupPayload(
            {
                remoteUrl: "https://github.com/baileywickham/obsidian.git",
                settings: buildMobileSettings(FULL),
                expiresAt: 1_800_000_000_000,
            },
            key
        );
        const link = `obsidian://git-setup?d=${encoded}&k=${key}`;

        expect(link.length).toBeLessThan(1200);
    });
});
