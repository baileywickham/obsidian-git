import { Notice, requestUrl } from "obsidian";
import type ObsidianGit from "../main";
import type { HttpPost } from "./deviceFlow";
import { pollForToken, requestDeviceCode } from "./deviceFlow";

const httpPost: HttpPost = async (url, params) => {
    const res = await requestUrl({
        url,
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(params).toString(),
        throw: false,
    });
    return res.json as Record<string, unknown>;
};

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

/**
 * Runs the GitHub device flow and stores the resulting token in the same
 * localStorage credentials slot the manual PAT entry uses, so the
 * isomorphic-git onAuth path works unchanged.
 *
 * @returns true if a token was obtained and stored.
 */
export async function signInWithGitHub(plugin: ObsidianGit): Promise<boolean> {
    const clientId = plugin.settings.githubOauthClientId;
    if (!clientId) {
        new Notice(
            "No GitHub OAuth client ID configured. Set one under Settings → Git (BW) → Mobile sync.",
            10000
        );
        return false;
    }

    const device = await requestDeviceCode(httpPost, clientId);

    let copied = false;
    try {
        await navigator.clipboard.writeText(device.user_code);
        copied = true;
    } catch {
        // Clipboard can be unavailable (e.g. not user-triggered); the code is
        // still shown in the notice.
    }

    const fragment = document.createDocumentFragment();
    const div = document.createElement("div");
    div.appendText(
        `GitHub sign-in code: ${device.user_code}` +
            (copied ? " (copied)" : "") +
            " — enter it at "
    );
    const link = div.createEl("a", {
        text: device.verification_uri,
        href: device.verification_uri,
    });
    link.target = "_blank";
    fragment.append(div);
    const codeNotice = new Notice(fragment, 0);

    try {
        const token = await pollForToken(httpPost, clientId, device, sleep);
        plugin.localStorage.setUsername("x-access-token");
        plugin.localStorage.setPassword(token);
        new Notice("Signed in to GitHub.");
        return true;
    } catch (e) {
        plugin.displayError(e);
        return false;
    } finally {
        codeNotice.hide();
    }
}
