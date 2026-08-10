import { Modal, Notice } from "obsidian";
import QRCode from "qrcode";
import { signInWithGitHub } from "../auth/githubSignIn";
import type ObsidianGit from "../main";
import { GeneralModal } from "../ui/modals/generalModal";
import { formatRemoteUrl } from "../utils";
import {
    buildMobileSettings,
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

    const authorName = await plugin.gitManager.getConfig("user.name");
    const authorEmail = await plugin.gitManager.getConfig("user.email");

    const key = generateSetupKey();
    const encoded = await encodeSetupPayload(
        {
            remoteUrl: rewriteSshToHttps(remote),
            settings: buildMobileSettings(plugin.settings),
            expiresAt: Date.now() + LINK_VALIDITY_MS,
            author:
                authorName && authorEmail
                    ? { name: authorName, email: authorEmail }
                    : undefined,
        },
        key
    );
    const link = `obsidian://git-setup?d=${encoded}&k=${key}`;
    await navigator.clipboard.writeText(link);
    new SetupQrModal(plugin, link).open();
}

class SetupQrModal extends Modal {
    constructor(
        private readonly plugin: ObsidianGit,
        private readonly link: string
    ) {
        super(plugin.app);
    }

    override onOpen(): void {
        this.setTitle("Scan with your phone's camera");
        this.contentEl.createEl("p", {
            text: "iOS will offer to open the link in Obsidian. The link is also on your clipboard and expires in 1 hour.",
        });
        QRCode.toDataURL(this.link, {
            width: 440,
            errorCorrectionLevel: "L",
            margin: 2,
        })
            .then((dataUrl) => {
                const img = this.contentEl.createEl("img");
                img.src = dataUrl;
                img.style.width = "100%";
                img.style.imageRendering = "pixelated";
            })
            .catch((e) => this.plugin.displayError(e));
    }
}

async function applyAuthor(
    plugin: ObsidianGit,
    payload: { author?: { name: string; email: string } }
): Promise<void> {
    if (!payload.author) return;
    const existingName = await plugin.gitManager.getConfig("user.name");
    const existingEmail = await plugin.gitManager.getConfig("user.email");
    if (!existingName) {
        await plugin.gitManager.setConfig("user.name", payload.author.name);
    }
    if (!existingEmail) {
        await plugin.gitManager.setConfig("user.email", payload.author.email);
    }
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
        await applyAuthor(plugin, payload);
        new Notice("Clone finished. Please restart Obsidian.", 0);
    } else {
        // The vault may be a pre-existing repo with an SSH remote left over
        // from an earlier setup — isomorphic-git only speaks HTTPS.
        const target = formatRemoteUrl(payload.remoteUrl);
        const current = await plugin.gitManager.getRemoteUrl("origin");
        if (current !== target) {
            await plugin.gitManager.setRemote("origin", target);
            new Notice(`Switched remote 'origin' to ${target}`);
        }
        await applyAuthor(plugin, payload);
        await plugin.init({ fromReload: true });
        new Notice("Git mobile setup applied.");
    }
}
