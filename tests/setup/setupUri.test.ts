import { describe, expect, it } from "vitest";
import {
    decodeSetupPayload,
    encodeSetupPayload,
    rewriteSshToHttps,
    type MobileSetupPayload,
} from "../../src/setup/setupUri";

const PAYLOAD: MobileSetupPayload = {
    remoteUrl: "https://github.com/baileywickham/obsidian.git",
    settings: { disablePopups: true, autoPullOnBoot: true },
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
    it("round-trips a payload through encode and decode", async () => {
        const encoded = await encodeSetupPayload(PAYLOAD, "hunter2");

        const decoded = await decodeSetupPayload(encoded, "hunter2");

        expect(decoded).toEqual(PAYLOAD);
    });

    it("produces URL-safe output", async () => {
        const encoded = await encodeSetupPayload(PAYLOAD, "hunter2");

        expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("rejects the wrong passphrase", async () => {
        const encoded = await encodeSetupPayload(PAYLOAD, "hunter2");

        await expect(decodeSetupPayload(encoded, "wrong")).rejects.toThrow();
    });

    it("rejects a truncated payload", async () => {
        const encoded = await encodeSetupPayload(PAYLOAD, "hunter2");

        await expect(
            decodeSetupPayload(encoded.slice(0, 20), "hunter2")
        ).rejects.toThrow();
    });
});
