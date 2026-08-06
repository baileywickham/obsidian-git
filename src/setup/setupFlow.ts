import { Notice } from "obsidian";
import { signInWithGitHub } from "../auth/githubSignIn";
import type ObsidianGit from "../main";
import type { ObsidianGitSettings } from "../types";
import { GeneralModal } from "../ui/modals/generalModal";
import { formatRemoteUrl } from "../utils";
import {
    decodeSetupPayload,
    encodeSetupPayload,
    generateSetupKey,
    isSetupPayloadExpired,
    rewriteSshToHttps,
} from "./setupUri";

const LINK_VALIDITY_MS = 60 * 60 * 1000;

/**
 * Desktop command: packs the origin remote (rewritten to HTTPS for
 * isomorphic-git) and mobile-tuned settings into an encrypted, time-limited
 * obsidian://git-setup link and puts it on the clipboard. The link is
 * self-contained — the key travels in the link and the phone only confirms
 * the target repo before applying.
 */
export async function generateMobileSetupLink(
    plugin: ObsidianGit
): Promise<void> {
    if (!(await plugin.isAllInitialized())) return;
    const remote = await plugin.gitManager.getRemoteUrl("origin");
    if (!remote) {
        new Notice("No 'origin' remote found — nothing to set up on mobile.");
        return;
    }

    const settings: Partial<ObsidianGitSettings> = {
        ...plugin.settings,
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

    const key = generateSetupKey();
    const encoded = await encodeSetupPayload(
        {
            remoteUrl: rewriteSshToHttps(remote),
            settings,
            expiresAt: Date.now() + LINK_VALIDITY_MS,
        },
        key
    );
    await navigator.clipboard.writeText(
        `obsidian://git-setup?d=${encoded}&k=${key}`
    );
    new Notice(
        "Mobile setup link copied to clipboard — valid for 1 hour. Send it to your phone (AirDrop/iMessage) and tap it there.",
        10000
    );
}

export function registerSetupUriHandler(plugin: ObsidianGit): void {
    plugin.registerObsidianProtocolHandler("git-setup", (params) => {
        handleSetupUri(plugin, params.d, params.k).catch((e) =>
            plugin.displayError(e)
        );
    });
}

async function handleSetupUri(
    plugin: ObsidianGit,
    encoded: string | undefined,
    key: string | undefined
): Promise<void> {
    if (!encoded || !key) {
        new Notice("Setup link is missing its payload or key.");
        return;
    }

    // Nothing is applied unless the whole payload decrypts and parses.
    const payload = await decodeSetupPayload(encoded, key);

    if (isSetupPayloadExpired(payload, Date.now())) {
        new Notice(
            "This setup link has expired. Generate a fresh one on your desktop.",
            10000
        );
        return;
    }

    // The link key proves nothing about the sender, so show what will be
    // applied and let the user refuse a link they didn't generate.
    const confirmOption = "Apply setup";
    const choice = await new GeneralModal(plugin, {
        options: [confirmOption, "Cancel"],
        placeholder: `Configure git sync against ${payload.remoteUrl}?`,
        onlySelection: true,
    }).openAndGetResult();
    if (choice !== confirmOption) {
        new Notice("Setup cancelled.");
        return;
    }

    Object.assign(plugin.settings, payload.settings);
    await plugin.saveSettings();

    if (
        plugin.settings.githubOauthClientId &&
        plugin.localStorage.getPassword() == null
    ) {
        const signedIn = await signInWithGitHub(plugin);
        if (!signedIn) {
            new Notice(
                "Setup saved, but GitHub sign-in did not finish. Run 'Sign in with GitHub' to retry."
            );
            return;
        }
    }

    const requirements = await plugin.gitManager.checkRequirements();
    if (requirements === "missing-repo") {
        new Notice("Cloning your vault repo — keep Obsidian open…");
        await plugin.gitManager.clone(
            formatRemoteUrl(payload.remoteUrl),
            ".",
            undefined
        );
        new Notice("Clone finished. Please restart Obsidian.", 0);
    } else {
        await plugin.init({ fromReload: true });
        new Notice("Git mobile setup applied.");
    }
}
