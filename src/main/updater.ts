import { app, BrowserWindow, dialog } from "electron";

import { autoUpdater, UpdateInfo, ProgressInfo } from "electron-updater";

export interface UpdaterCallbacks {
  sendUpdateState: () => void;
  updateTray: () => void;
  getMainWindow: () => BrowserWindow | null;
  setQuitting: (value: boolean) => void;
}

let updateCheckTimer: NodeJS.Timeout | null = null;

let updateDownloaded = false;

let updateDownloadProgress = 0;

let availableUpdateInfo: UpdateInfo | null = null;

let updaterConfigured = false;

let checkingForUpdate = false;

let downloadStarted = false;

let callbacks: UpdaterCallbacks | null = null;

const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000;

export function getUpdaterState() {
  return {
    currentVersion: app.getVersion(),

    checking: checkingForUpdate,

    updateAvailable: availableUpdateInfo !== null,

    version: availableUpdateInfo?.version ?? null,

    downloaded: updateDownloaded,

    progress: updateDownloadProgress,
  };
}

export function configureAutoUpdater(updaterCallbacks: UpdaterCallbacks): void {
  if (updaterConfigured) {
    return;
  }

  callbacks = updaterCallbacks;

  if (!app.isPackaged) {
    console.log(
      "[Formosa Chamados] AutoUpdater desativado durante desenvolvimento.",
    );

    return;
  }

  updaterConfigured = true;

  /*
   * ============================================================
   * CONFIGURAÇÃO
   * ============================================================
   */

  autoUpdater.autoDownload = false;

  autoUpdater.autoInstallOnAppQuit = true;

  /*
   * Evita que o electron-updater mostre mensagens próprias.
   */

  autoUpdater.logger = null;

  /*
   * ============================================================
   * CHECKING
   * ============================================================
   */

  autoUpdater.on("checking-for-update", () => {
    checkingForUpdate = true;

    console.log("[Formosa Chamados] Procurando atualização...");

    notifyState();
  });

  /*
   * ============================================================
   * UPDATE AVAILABLE
   * ============================================================
   */

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    checkingForUpdate = false;

    availableUpdateInfo = info;

    updateDownloaded = false;

    updateDownloadProgress = 0;

    downloadStarted = false;

    console.log("[Formosa Chamados] Nova versão encontrada:", info.version);

    console.log("[Formosa Chamados] Versão instalada:", app.getVersion());

    notifyState();

    /*
     * Baixa automaticamente.
     */

    if (!downloadStarted) {
      downloadStarted = true;

      console.log("[Formosa Chamados] Iniciando download da atualização...");

      void autoUpdater.downloadUpdate();
    }
  });

  /*
   * ============================================================
   * NO UPDATE
   * ============================================================
   */

  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    checkingForUpdate = false;

    availableUpdateInfo = null;

    updateDownloaded = false;

    updateDownloadProgress = 0;

    downloadStarted = false;

    console.log(
      "[Formosa Chamados] Nenhuma atualização disponível.",
      info.version,
    );

    notifyState();
  });

  /*
   * ============================================================
   * DOWNLOAD PROGRESS
   * ============================================================
   */

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    updateDownloadProgress = Math.round(progress.percent);

    console.log(
      `[Formosa Chamados] Download da atualização: ${updateDownloadProgress}%`,
    );

    notifyState();
  });

  /*
   * ============================================================
   * UPDATE DOWNLOADED
   * ============================================================
   */

  autoUpdater.on("update-downloaded", async (info: UpdateInfo) => {
    checkingForUpdate = false;

    availableUpdateInfo = info;

    updateDownloaded = true;

    updateDownloadProgress = 100;

    downloadStarted = false;

    console.log("[Formosa Chamados] Atualização baixada:", info.version);

    notifyState();

    await showUpdateDownloadedDialog(info);
  });

  /*
   * ============================================================
   * ERROR
   * ============================================================
   */

  autoUpdater.on("error", (error) => {
    checkingForUpdate = false;

    downloadStarted = false;

    console.error("[Formosa Chamados] Erro no AutoUpdater:", error);

    notifyState();
  });

  /*
   * ============================================================
   * VERIFICAÇÃO AUTOMÁTICA
   * ============================================================
   */

  updateCheckTimer = setInterval(() => {
    void checkForUpdates(false);
  }, UPDATE_CHECK_INTERVAL);

  /*
   * Primeira verificação 10 segundos depois de abrir.
   */

  setTimeout(() => {
    void checkForUpdates(false);
  }, 10_000);

  console.log("[Formosa Chamados] AutoUpdater configurado.");
}

/*
 * ============================================================
 * NOTIFICAR MAIN
 * ============================================================
 */

function notifyState(): void {
  callbacks?.sendUpdateState();

  callbacks?.updateTray();
}

/*
 * ============================================================
 * VERIFICAR ATUALIZAÇÃO
 * ============================================================
 */

export async function checkForUpdates(showDialog = false): Promise<void> {
  if (!app.isPackaged) {
    console.log("[Formosa Chamados] Atualização ignorada em desenvolvimento.");

    return;
  }

  if (checkingForUpdate) {
    return;
  }

  checkingForUpdate = true;

  notifyState();

  try {
    console.log("[Formosa Chamados] Verificando atualização...");

    const result = await autoUpdater.checkForUpdates();

    if (!result) {
      checkingForUpdate = false;

      notifyState();

      return;
    }

    const currentVersion = app.getVersion();

    const availableVersion = result.updateInfo.version;

    console.log("[Formosa Chamados] Versão atual:", currentVersion);

    console.log("[Formosa Chamados] Versão disponível:", availableVersion);

    /*
     * electron-updater normalmente já faz
     * essa comparação.
     */

    if (availableVersion === currentVersion) {
      checkingForUpdate = false;

      if (showDialog) {
        await dialog.showMessageBox({
          type: "info",

          title: "Formosa Chamados",

          message: "O aplicativo já está atualizado.",

          detail: `Versão atual: ${currentVersion}`,
        });
      }

      notifyState();

      return;
    }

    /*
     * O evento update-available cuidará
     * do download.
     */

    availableUpdateInfo = result.updateInfo;

    checkingForUpdate = false;

    notifyState();

    if (showDialog) {
      const response = await dialog.showMessageBox({
        type: "info",

        buttons: ["Baixar atualização", "Agora não"],

        defaultId: 0,

        cancelId: 1,

        title: "Nova atualização disponível",

        message: `Formosa Chamados ${availableVersion}`,

        detail: `A versão ${availableVersion} está disponível.\n\nA atualização será baixada em segundo plano.`,
      });

      if (response.response === 0) {
        if (!downloadStarted) {
          downloadStarted = true;

          await autoUpdater.downloadUpdate();
        }
      }
    } else {
      if (!downloadStarted) {
        downloadStarted = true;

        await autoUpdater.downloadUpdate();
      }
    }
  } catch (error) {
    checkingForUpdate = false;

    downloadStarted = false;

    console.error("[Formosa Chamados] Erro ao verificar atualização:", error);

    notifyState();

    if (showDialog) {
      await dialog.showMessageBox({
        type: "error",

        title: "Atualização",

        message: "Não foi possível verificar atualizações.",

        detail: String(error),
      });
    }
  }
}

/*
 * ============================================================
 * INSTALAR
 * ============================================================
 */

export function installDownloadedUpdate(): void {
  if (!updateDownloaded) {
    return;
  }

  if (!app.isPackaged) {
    return;
  }

  console.log("[Formosa Chamados] Instalando atualização...");

  callbacks?.setQuitting(true);

  autoUpdater.quitAndInstall(false, true);
}

/*
 * ============================================================
 * DIÁLOGO
 * ============================================================
 */

async function showUpdateDownloadedDialog(info: UpdateInfo): Promise<void> {
  const window = callbacks?.getMainWindow() ?? null;

  if (!window || window.isDestroyed()) {
    return;
  }

  const response = await dialog.showMessageBox(window, {
    type: "info",

    buttons: ["Reiniciar e atualizar", "Depois"],

    defaultId: 0,

    cancelId: 1,

    title: "Atualização pronta",

    message: `Formosa Chamados ${info.version} está pronto para ser instalado.`,

    detail:
      "A atualização foi baixada. O aplicativo pode ser reiniciado agora para concluir a instalação.",
  });

  if (response.response === 0) {
    installDownloadedUpdate();
  }
}

/*
 * ============================================================
 * FINALIZAÇÃO
 * ============================================================
 */

export function stopAutoUpdater(): void {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);

    updateCheckTimer = null;
  }
}
