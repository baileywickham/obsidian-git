import { Notice } from "obsidian";
import { signInWithGitHub } from "../auth/githubSignIn";
import type ObsidianGit from "../main";
import type { ObsidianGitSettings } from "../types";
import { GeneralModal } from "../ui/modals/generalModal";
import { formatRemoteUrl } from "../utils";
import {
    decodeSetupPayload,
    encodeSetupPayload,
    rewriteSshToHttps,
} from "./setupUri";

/**
 * Desktop command: packs the origin remote (rewritten to HTTPS for
 * isomorphic-git) and mobile-tuned settings into an encrypted
 * obsidian://git-setup link and puts it on the clipboard.
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

    const passphrase = await new GeneralModal(plugin, {
        placeholder:
            "Choose a passphrase for the setup link (you'll enter it on your phone)",
        allowEmpty: false,
    }).openAndGetResult();
    if (!passphrase) return;

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

    const encoded = await encodeSetupPayload(
        { remoteUrl: rewriteSshToHttps(remote), settings },
        passphrase
    );
    await navigator.clipboard.writeText(`obsidian://git-setup?d=${encoded}`);
    new Notice(
        "Mobile setup link copied to clipboard. Send it to your phone (AirDrop/iMessage) and tap it there.",
        10000
    );
}

export function registerSetupUriHandler(plugin: ObsidianGit): void {
    plugin.registerObsidianProtocolHandler("git-setup", (params) => {
        handleSetupUri(plugin, params.d).catch((e) => plugin.displayError(e));
    });
}

async function handleSetupUri(
    plugin: ObsidianGit,
    encoded: string | undefined
): Promise<void> {
    if (!encoded) {
        new Notice("Setup link is missing its payload.");
        return;
    }
    const passphrase = await new GeneralModal(plugin, {
        placeholder: "Enter the setup link passphrase",
        allowEmpty: false,
    }).openAndGetResult();
    if (!passphrase) return;

    // Nothing is applied unless the whole payload decrypts and parses.
    const payload = await decodeSetupPayload(encoded, passphrase);

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
