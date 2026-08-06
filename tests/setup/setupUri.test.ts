import { describe, expect, it } from "vitest";
import {
    decodeSetupPayload,
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
