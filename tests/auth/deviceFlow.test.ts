import { describe, expect, it } from "vitest";
import {
    pollForToken,
    requestDeviceCode,
    type HttpPost,
} from "../../src/auth/deviceFlow";

const DEVICE_CODE = {
    device_code: "dev123",
    user_code: "ABCD-1234",
    verification_uri: "https://github.com/login/device",
    expires_in: 900,
    interval: 5,
};

/** Builds an HttpPost stub that returns the given responses in order and
 * records every call. */
function httpReturning(responses: Record<string, unknown>[]): {
    http: HttpPost;
    calls: { url: string; params: Record<string, string> }[];
} {
    const calls: { url: string; params: Record<string, string> }[] = [];
    const http: HttpPost = (url, params) => {
        calls.push({ url, params });
        const response = responses.shift();
        if (response == undefined) {
            throw new Error("unexpected extra http call");
        }
        return Promise.resolve(response);
    };
    return { http, calls };
}

const noSleep = () => Promise.resolve();

describe("requestDeviceCode", () => {
    it("posts the client id to GitHub and returns the device code response", async () => {
        const { http, calls } = httpReturning([{ ...DEVICE_CODE }]);

        const res = await requestDeviceCode(http, "client42");

        expect(res).toEqual(DEVICE_CODE);
        expect(calls[0]!.url).toBe("https://github.com/login/device/code");
        expect(calls[0]!.params.client_id).toBe("client42");
        expect(calls[0]!.params.scope).toBe("repo");
    });

    it("throws when GitHub returns an error instead of a device code", async () => {
        const { http } = httpReturning([{ error: "unauthorized_client" }]);

        await expect(requestDeviceCode(http, "bad")).rejects.toThrow(
            "unauthorized_client"
        );
    });
});

describe("pollForToken", () => {
    it("keeps polling through authorization_pending and returns the token", async () => {
        const { http, calls } = httpReturning([
            { error: "authorization_pending" },
            { error: "authorization_pending" },
            { access_token: "gho_token", token_type: "bearer" },
        ]);

        const token = await pollForToken(
            http,
            "client42",
            DEVICE_CODE,
            noSleep
        );

        expect(token).toBe("gho_token");
        expect(calls.length).toBe(3);
        expect(calls[0]!.url).toBe(
            "https://github.com/login/oauth/access_token"
        );
        expect(calls[0]!.params.device_code).toBe("dev123");
    });

    it("waits the interval between polls and 5s longer after slow_down", async () => {
        const sleeps: number[] = [];
        const sleep = (ms: number) => {
            sleeps.push(ms);
            return Promise.resolve();
        };
        const { http } = httpReturning([
            { error: "slow_down" },
            { access_token: "gho_token" },
        ]);

        await pollForToken(http, "client42", DEVICE_CODE, sleep);

        expect(sleeps).toEqual([5000, 10000]);
    });

    it("throws when the device code expires", async () => {
        const { http } = httpReturning([{ error: "expired_token" }]);

        await expect(
            pollForToken(http, "client42", DEVICE_CODE, noSleep)
        ).rejects.toThrow("expired");
    });

    it("throws when the user denies access", async () => {
        const { http } = httpReturning([{ error: "access_denied" }]);

        await expect(
            pollForToken(http, "client42", DEVICE_CODE, noSleep)
        ).rejects.toThrow("denied");
    });
});
