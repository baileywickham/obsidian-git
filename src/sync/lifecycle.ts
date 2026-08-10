import type ObsidianGit from "../main";

/**
 * Invisible sync: pull when the app comes to the foreground, commit-and-sync
 * when it goes to the background. iOS gives web views only a short window
 * after backgrounding, so the push is best-effort — the debounced
 * auto-backup after file changes is the primary push path.
 */
export function registerLifecycleSync(plugin: ObsidianGit): void {
    plugin.registerDomEvent(document, "visibilitychange", () => {
        if (
            !plugin.settings.syncOnAppLifecycle ||
            !plugin.gitReady ||
            plugin.localStorage.getPausedAutomatics()
        )
            return;

        if (document.visibilityState === "visible") {
            plugin.promiseQueue.addTask(() => plugin.pullChangesFromRemote());
        } else {
            plugin.promiseQueue.addTask(() =>
                plugin.commitAndSync({ fromAutoBackup: true })
            );
        }
    });
}
