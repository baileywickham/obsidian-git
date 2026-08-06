/**
 * GitHub OAuth device flow (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).
 *
 * HTTP and sleeping are injected so the flow can run on Obsidian's
 * CORS-exempt `requestUrl` in production and plain stubs in tests.
 */

export type HttpPost = (
    url: string,
    params: Record<string, string>
) => Promise<Record<string, unknown>>;

export interface DeviceCodeResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
}

export async function requestDeviceCode(
    http: HttpPost,
    clientId: string
): Promise<DeviceCodeResponse> {
    const res = await http("https://github.com/login/device/code", {
        client_id: clientId,
        scope: "repo",
    });
    if (res.error != undefined) {
        throw new Error(
            `GitHub device code request failed: ${JSON.stringify(res.error)}`
        );
    }
    return res as unknown as DeviceCodeResponse;
}

export async function pollForToken(
    http: HttpPost,
    clientId: string,
    device: DeviceCodeResponse,
    sleep: (ms: number) => Promise<void>
): Promise<string> {
    let intervalMs = device.interval * 1000;
    // iOS suspends the app (and kills in-flight requests) while the user is
    // off in the browser entering the code, so failed polls are expected.
    // Retry everything; the device code's own lifetime is the deadline.
    let elapsedMs = 0;
    for (;;) {
        if (elapsedMs >= device.expires_in * 1000) {
            throw new Error(
                "The GitHub sign-in code expired. Please start over."
            );
        }
        await sleep(intervalMs);
        elapsedMs += intervalMs;
        let res: Record<string, unknown>;
        try {
            res = await http("https://github.com/login/oauth/access_token", {
                client_id: clientId,
                device_code: device.device_code,
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            });
        } catch {
            continue;
        }
        if (typeof res.access_token === "string") {
            return res.access_token;
        }
        switch (res.error) {
            case "authorization_pending":
                break;
            case "slow_down":
                intervalMs += 5000;
                break;
            case "expired_token":
                throw new Error(
                    "The GitHub sign-in code expired. Please start over."
                );
            case "access_denied":
                throw new Error("GitHub sign-in was denied.");
            default:
                throw new Error(`GitHub sign-in failed: ${String(res.error)}`);
        }
    }
}
