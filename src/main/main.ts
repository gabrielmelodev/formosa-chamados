import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  WebContentsView,
  Notification,
  Tray,
  Menu,
  nativeImage,
  screen,
} from "electron";

import path from "node:path";
import fs from "node:fs";

import {
  configureAutoUpdater,
  checkForUpdates,
  installDownloadedUpdate,
  getUpdaterState,
  stopAutoUpdater,
} from "./updater";

/*
 * ============================================================
 * CONFIGURAÇÃO
 * ============================================================
 */

const APP_NAME = "Formosa Chamados";

const APP_USER_MODEL_ID = "br.gov.formosa.chamados";

const SYSTEM_URL = "https://chamados.formosa.go.gov.br/tickets";

const SYSTEM_ORIGIN = "https://chamados.formosa.go.gov.br";

const TICKETS_API_URL =
  "https://chamados.formosa.go.gov.br/api/v1/tickets?status=PENDING&page=0&size=50";

/*
 * ============================================================
 * SESSÃO PERSISTENTE
 * ============================================================
 */

const PERSISTENT_SESSION_PARTITION = "persist:formosa-chamados";

/*
 * ============================================================
 * JANELA
 * ============================================================
 */

const WINDOW_WIDTH_RATIO = 0.86;

const WINDOW_HEIGHT_RATIO = 0.86;

const MIN_WIDTH = 1000;

const MIN_HEIGHT = 650;

const TOOLBAR_HEIGHT = 52;

/*
 * ============================================================
 * ZOOM
 * ============================================================
 */

const SYSTEM_ZOOM = 0.85;

/*
 * ============================================================
 * MONITORAMENTO
 * ============================================================
 */

const TICKETS_POLL_INTERVAL = 30_000;

const MAX_TRACKED_TICKET_IDS = 5000;

/*
 * ============================================================
 * ESTADO
 * ============================================================
 */

let mainWindow: BrowserWindow | null = null;

let systemView: WebContentsView | null = null;

let tray: Tray | null = null;

let ipcConfigured = false;

let ticketsPollTimer: NodeJS.Timeout | null = null;

let isQuitting = false;

let ticketsCheckInProgress = false;

let ticketsInitialized = false;

const knownPendingTicketIds = new Set<string>();

const notifiedTicketIds = new Set<string>();

let currentPendingCount = 0;

let systemViewCssKey: string | null = null;

/*
 * ============================================================
 * SESSÃO DO SISTEMA
 * ============================================================
 */

let systemSession: Electron.Session | null = null;

/*
 * ============================================================
 * TIPOS
 * ============================================================
 */

interface TicketSummary {
  id?: string | number;

  protocol?: string;

  status?: string;

  title?: string;

  subject?: string;

  description?: string;

  number?: string | number;

  code?: string | number;

  sectorName?: string;

  serviceName?: string;

  requesterName?: string;

  createdAt?: string;

  [key: string]: unknown;
}

interface TicketsApiResponse {
  content?: TicketSummary[];

  page?: number;

  size?: number;

  totalElements?: number;

  totalPages?: number;
}

interface TicketApiResult {
  ok: boolean;

  status: number;

  data: TicketsApiResponse | null;

  error?: string;
}

/*
 * ============================================================
 * SINGLE INSTANCE
 * ============================================================
 */

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
}

/*
 * ============================================================
 * WINDOWS APP ID
 * ============================================================
 */

if (process.platform === "win32") {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

/*
 * ============================================================
 * PATHS
 * ============================================================
 */

function getToolbarPath(): string {
  return path.join(app.getAppPath(), "src", "toolbar", "index.html");
}

function getPreloadPath(): string {
  return path.join(__dirname, "../preload/preload.js");
}

/*
 * ============================================================
 * ÍCONE
 * ============================================================
 */

function getIconPaths(): string[] {
  return [
    path.join(app.getAppPath(), "assets", "formosa.ico"),

    path.join(app.getAppPath(), "src", "assets", "formosa.ico"),

    path.join(process.resourcesPath, "assets", "formosa.ico"),

    path.join(process.resourcesPath, "formosa.ico"),
  ];
}

function getTrayIcon(): Electron.NativeImage {
  const possiblePaths = getIconPaths();

  for (const iconPath of possiblePaths) {
    try {
      if (!fs.existsSync(iconPath)) {
        continue;
      }

      const icon = nativeImage.createFromPath(iconPath);

      if (!icon.isEmpty()) {
        console.log("[Formosa Chamados] Ícone carregado:", iconPath);

        return icon;
      }
    } catch (error) {
      console.error("[Formosa Chamados] Erro ao carregar ícone:", error);
    }
  }

  console.warn("[Formosa Chamados] Nenhum ícone encontrado.");

  return nativeImage.createEmpty();
}

/*
 * ============================================================
 * URL SECURITY
 * ============================================================
 */

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    return parsed.protocol === "https:" && parsed.origin === SYSTEM_ORIGIN;
  } catch {
    return false;
  }
}

/*
 * ============================================================
 * SESSÃO
 * ============================================================
 */

function configurePersistentSession(): void {
  if (systemSession) {
    return;
  }

  systemSession = session.fromPartition(PERSISTENT_SESSION_PARTITION, {
    cache: true,
  });

  console.log(
    "[Formosa Chamados] Sessão persistente configurada:",
    PERSISTENT_SESSION_PARTITION,
  );

  systemSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const url = webContents.getURL();

      try {
        const origin = new URL(url).origin;

        if (origin !== SYSTEM_ORIGIN) {
          callback(false);

          return;
        }
      } catch {
        callback(false);

        return;
      }

      callback(permission === "notifications");
    },
  );

  systemSession.cookies.on("changed", (_event, cookie, _cause, removed) => {
    const domain = cookie.domain ?? "";

    if (!domain.includes("chamados.formosa.go.gov.br")) {
      return;
    }

    console.log(
      "[Formosa Chamados] Cookie atualizado:",
      cookie.name,
      removed ? "(removido)" : "(mantido)",
    );
  });

  console.log(
    "[Formosa Chamados] Cookies/localStorage persistentes serão mantidos.",
  );
}

/*
 * ============================================================
 * WINDOW BOUNDS
 * ============================================================
 */

function getInitialWindowBounds() {
  const display = screen.getPrimaryDisplay();

  const workArea = display.workArea;

  let width = Math.round(workArea.width * WINDOW_WIDTH_RATIO);

  let height = Math.round(workArea.height * WINDOW_HEIGHT_RATIO);

  width = Math.max(width, MIN_WIDTH);

  height = Math.max(height, MIN_HEIGHT);

  width = Math.min(width, workArea.width);

  height = Math.min(height, workArea.height);

  const x = workArea.x + Math.round((workArea.width - width) / 2);

  const y = workArea.y + Math.round((workArea.height - height) / 2);

  return {
    x,
    y,
    width,
    height,
  };
}

function getSafeWindowBounds() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  const workArea = display.workArea;

  const bounds = getInitialWindowBounds();

  let { x, y, width, height } = bounds;

  width = Math.min(Math.max(width, MIN_WIDTH), workArea.width);

  height = Math.min(Math.max(height, MIN_HEIGHT), workArea.height);

  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width));

  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height));

  return {
    x,
    y,
    width,
    height,
  };
}

/*
 * ============================================================
 * CREATE WINDOW
 * ============================================================
 */

function createWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();

    mainWindow.focus();

    resizeSystemView();

    return;
  }

  const bounds = getSafeWindowBounds();

  mainWindow = new BrowserWindow({
    ...bounds,

    minWidth: MIN_WIDTH,

    minHeight: MIN_HEIGHT,

    title: APP_NAME,

    frame: false,

    show: false,

    backgroundColor: "#ffffff",

    autoHideMenuBar: true,

    resizable: true,

    maximizable: true,

    minimizable: true,

    closable: true,

    webPreferences: {
      preload: getPreloadPath(),

      nodeIntegration: false,

      contextIsolation: true,

      sandbox: true,

      webSecurity: true,

      allowRunningInsecureContent: false,
    },
  });

  createSystemView();

  const toolbarPath = getToolbarPath();

  console.log("[Formosa Chamados] Toolbar:", toolbarPath);

  void mainWindow.loadFile(toolbarPath);

  mainWindow.webContents.once("did-finish-load", () => {
    resizeSystemView();

    updateNavigationState();

    sendMaximizedState();

    sendPendingTicketCount(currentPendingCount);

    updateTray(currentPendingCount);

    sendUpdateState();

    mainWindow?.show();

    resizeSystemView();

    detectWebsiteTheme();

    startTicketsPolling();
  });

  mainWindow.on("resize", () => {
    resizeSystemView();
  });

  mainWindow.on("maximize", () => {
    resizeSystemView();

    sendMaximizedState();
  });

  mainWindow.on("unmaximize", () => {
    resizeSystemView();

    sendMaximizedState();
  });

  mainWindow.on("restore", () => {
    resizeSystemView();

    setTimeout(resizeSystemView, 50);

    setTimeout(resizeSystemView, 150);
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();

      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    systemViewCssKey = null;

    systemView = null;

    mainWindow = null;
  });
}

/*
 * ============================================================
 * SYSTEM VIEW
 * ============================================================
 */

function createSystemView(): void {
  if (!mainWindow) {
    return;
  }

  if (systemView) {
    resizeSystemView();

    return;
  }

  if (!systemSession) {
    configurePersistentSession();
  }

  if (!systemSession) {
    console.error("[Formosa Chamados] Não foi possível criar a sessão.");

    return;
  }

  systemView = new WebContentsView({
    webPreferences: {
      session: systemSession,

      nodeIntegration: false,

      contextIsolation: true,

      sandbox: true,

      webSecurity: true,

      allowRunningInsecureContent: false,
    },
  });

  systemView.webContents.setZoomFactor(SYSTEM_ZOOM);

  mainWindow.contentView.addChildView(systemView);

  configureSystemViewSecurity();

  resizeSystemView();

  if (isAllowedUrl(SYSTEM_URL)) {
    console.log("[Formosa Chamados] Abrindo sistema com sessão persistente.");

    void systemView.webContents.loadURL(SYSTEM_URL);
  }
}

/*
 * ============================================================
 * RESIZE
 * ============================================================
 */

function resizeSystemView(): void {
  if (!mainWindow || !systemView) {
    return;
  }

  if (mainWindow.isDestroyed() || systemView.webContents.isDestroyed()) {
    return;
  }

  const [width, height] = mainWindow.getContentSize();

  if (width <= 0 || height <= 0) {
    return;
  }

  const viewHeight = Math.max(0, height - TOOLBAR_HEIGHT);

  systemView.setBounds({
    x: 0,

    y: TOOLBAR_HEIGHT,

    width,

    height: viewHeight,
  });
}

/*
 * ============================================================
 * CSS
 * ============================================================
 */

function styleSystemView(): void {
  if (!systemView || systemView.webContents.isDestroyed()) {
    return;
  }

  if (systemViewCssKey) {
    return;
  }

  const css = `
    html,
    body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      min-height: 100% !important;
      box-sizing: border-box !important;
    }

    html,
    body {
      overflow-x: auto !important;
      overflow-y: auto !important;
    }

    #root,
    #app {
      box-sizing: border-box !important;
      min-width: 0 !important;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    ::-webkit-scrollbar {
      width: 10px !important;
      height: 10px !important;
    }

    ::-webkit-scrollbar-track {
      background: transparent !important;
    }

    ::-webkit-scrollbar-thumb {
      background: rgba(
        120,
        120,
        120,
        0.38
      ) !important;

      border-radius: 8px !important;

      border: 2px solid transparent !important;

      background-clip:
        padding-box !important;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: rgba(
        100,
        100,
        100,
        0.55
      ) !important;

      border: 2px solid transparent !important;

      background-clip:
        padding-box !important;
    }
  `;

  void systemView.webContents
    .insertCSS(css)
    .then((key) => {
      systemViewCssKey = key;

      console.log("[Formosa Chamados] CSS da View aplicado.");
    })
    .catch((error) => {
      console.error("[Formosa Chamados] Erro ao aplicar CSS:", error);
    });
}

/*
 * ============================================================
 * THEME
 * ============================================================
 */

function detectWebsiteTheme(): void {
  if (!systemView || !mainWindow) {
    return;
  }

  if (
    systemView.webContents.isDestroyed() ||
    mainWindow.webContents.isDestroyed()
  ) {
    return;
  }

  void systemView.webContents
    .executeJavaScript(
      `
      (() => {
        function valid(color) {
          if (!color) {
            return false;
          }

          return (
            color !== "transparent" &&
            color !== "rgba(0, 0, 0, 0)"
          );
        }

        function theme(element) {
          if (!element) {
            return null;
          }

          try {
            const style =
              getComputedStyle(element);

            if (!valid(style.backgroundColor)) {
              return null;
            }

            return {
              background:
                style.backgroundColor,

              color:
                style.color,

              colorScheme:
                style.colorScheme,
            };
          } catch {
            return null;
          }
        }

        const selectors = [
          document.documentElement,
          document.body,
          document.querySelector("#root"),
          document.querySelector("#app"),
          document.querySelector("main"),
        ];

        for (const element of selectors) {
          const result = theme(element);

          if (result) {
            return result;
          }
        }

        return {
          background:
            "rgb(255, 255, 255)",

          color:
            "rgb(17, 24, 39)",

          colorScheme:
            "light",
        };
      })();
      `,
      true,
    )
    .then((theme) => {
      if (!mainWindow || mainWindow.isDestroyed() || !theme) {
        return;
      }

      mainWindow.webContents.send("website-theme", theme);
    })
    .catch((error) => {
      console.error("[Formosa Chamados] Erro ao detectar tema:", error);
    });
}

function watchWebsiteTheme(): void {
  if (!systemView || systemView.webContents.isDestroyed()) {
    return;
  }

  void systemView.webContents
    .executeJavaScript(
      `
      (() => {
        if (window.__formosaThemeObserver) {
          return;
        }

        let timer = null;

        function notify() {
          if (timer) {
            clearTimeout(timer);
          }

          timer = setTimeout(() => {
            console.info(
              "__FORMOSA_THEME_CHANGED__",
            );
          }, 50);
        }

        const observer =
          new MutationObserver(notify);

        observer.observe(
          document.documentElement,
          {
            attributes: true,

            attributeFilter: [
              "class",
              "style",
              "data-theme",
              "data-mode",
              "data-color-scheme",
            ],
          },
        );

        if (document.body) {
          observer.observe(
            document.body,
            {
              attributes: true,

              attributeFilter: [
                "class",
                "style",
                "data-theme",
                "data-mode",
                "data-color-scheme",
              ],
            },
          );
        }

        window.__formosaThemeObserver =
          observer;
      })();
      `,
      true,
    )
    .catch(() => {});
}

/*
 * ============================================================
 * SECURITY
 * ============================================================
 */

function configureSystemViewSecurity(): void {
  if (!systemView) {
    return;
  }

  systemView.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      return {
        action: "allow",
      };
    }

    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }

    return {
      action: "deny",
    };
  });

  systemView.webContents.on("will-navigate", (event, url) => {
    if (isAllowedUrl(url)) {
      return;
    }

    event.preventDefault();

    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
  });

  systemView.webContents.on("console-message", (_event, _level, message) => {
    if (message === "__FORMOSA_THEME_CHANGED__") {
      detectWebsiteTheme();
    }
  });

  systemView.webContents.on("did-start-loading", () => {
    sendToolbarStatus({
      loading: true,
      online: true,
    });
  });

  systemView.webContents.on("did-stop-loading", () => {
    sendToolbarStatus({
      loading: false,
      online: true,
    });

    styleSystemView();

    disableWebsiteSidebarToggle();

    updateNavigationState();

    detectWebsiteTheme();

    watchWebsiteTheme();

    void checkPendingTickets();

    resizeSystemView();
  });

  systemView.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }

      console.error("[Formosa Chamados]", {
        errorCode,
        errorDescription,
        validatedURL,
      });

      sendToolbarStatus({
        loading: false,
        online: false,
      });
    },
  );

  systemView.webContents.on("did-navigate", () => {
    systemViewCssKey = null;

    styleSystemView();

    disableWebsiteSidebarToggle();

    updateNavigationState();

    detectWebsiteTheme();

    watchWebsiteTheme();

    void checkPendingTickets();

    resizeSystemView();
  });

  systemView.webContents.on("did-navigate-in-page", () => {
    updateNavigationState();

    detectWebsiteTheme();

    watchWebsiteTheme();

    void checkPendingTickets();

    resizeSystemView();
  });

  systemView.webContents.on("dom-ready", () => {
    styleSystemView();

    disableWebsiteSidebarToggle();

    detectWebsiteTheme();

    watchWebsiteTheme();

    resizeSystemView();
  });
}

/*
 * ============================================================
 * TICKETS
 * ============================================================
 */

async function checkPendingTickets(): Promise<void> {
  if (ticketsCheckInProgress) {
    return;
  }

  if (!systemView || systemView.webContents.isDestroyed()) {
    return;
  }

  ticketsCheckInProgress = true;

  try {
    const result = (await systemView.webContents.executeJavaScript(
      `
        (async () => {
          const apiUrl =
            ${JSON.stringify(TICKETS_API_URL)};

          function normalizeToken(value) {
            if (!value) {
              return null;
            }

            if (
              typeof value !== "string"
            ) {
              return null;
            }

            const token =
              value.trim();

            if (!token) {
              return null;
            }

            return token
              .replace(
                /^Bearer\\\\s+/i,
                "",
              )
              .trim();
          }

          function getTokenFromStorage(storage) {
            try {
              for (
                let index = 0;
                index < storage.length;
                index++
              ) {
                const key =
                  storage.key(index);

                if (!key) {
                  continue;
                }

                const lowerKey =
                  key.toLowerCase();

                const possible =
                  lowerKey.includes(
                    "token",
                  ) ||
                  lowerKey.includes(
                    "access",
                  ) ||
                  lowerKey.includes(
                    "auth",
                  ) ||
                  lowerKey.includes(
                    "jwt",
                  );

                if (!possible) {
                  continue;
                }

                const raw =
                  storage.getItem(key);

                if (!raw) {
                  continue;
                }

                const direct =
                  normalizeToken(raw);

                if (direct) {
                  return direct;
                }

                try {
                  const parsed =
                    JSON.parse(raw);

                  if (
                    parsed &&
                    typeof parsed ===
                      "object"
                  ) {
                    const candidates = [
                      parsed.accessToken,
                      parsed.access_token,
                      parsed.token,
                      parsed.jwt,
                      parsed.idToken,
                    ];

                    for (
                      const candidate of
                        candidates
                    ) {
                      const token =
                        normalizeToken(
                          candidate,
                        );

                      if (token) {
                        return token;
                      }
                    }
                  }
                } catch {}
              }
            } catch {}

            return null;
          }

          async function request(
            headers = {},
          ) {
            try {
              const response =
                await fetch(
                  apiUrl,
                  {
                    method: "GET",

                    credentials:
                      "include",

                    headers: {
                      Accept:
                        "application/json",

                      ...headers,
                    },

                    cache:
                      "no-store",
                  },
                );

              const text =
                await response.text();

              let data = null;

              try {
                data =
                  JSON.parse(text);
              } catch {}

              return {
                ok:
                  response.ok,

                status:
                  response.status,

                data,
              };
            } catch (error) {
              return {
                ok: false,

                status: 0,

                data: null,

                error:
                  String(error),
              };
            }
          }

          let result =
            await request();

          if (result.ok) {
            return result;
          }

          let token =
            getTokenFromStorage(
              window.localStorage,
            );

          if (!token) {
            token =
              getTokenFromStorage(
                window.sessionStorage,
              );
          }

          if (token) {
            result =
              await request({
                Authorization:
                  "Bearer " +
                  token,
              });

            if (result.ok) {
              return result;
            }
          }

          return result;
        })();
        `,
      true,
    )) as TicketApiResult;

    if (!result?.ok) {
      console.warn(
        "[Formosa Chamados] API indisponível:",
        result?.status,
        result?.error ?? "",
      );

      return;
    }

    const data = result.data as TicketsApiResponse;

    const content = Array.isArray(data?.content) ? data.content : [];

    const pendingTickets = content.filter(
      (ticket) => String(ticket?.status ?? "").toUpperCase() === "PENDING",
    );

    const pendingIds = pendingTickets
      .map(getTicketId)
      .filter((id): id is string => id !== null);

    if (!ticketsInitialized) {
      ticketsInitialized = true;

      knownPendingTicketIds.clear();

      for (const id of pendingIds) {
        knownPendingTicketIds.add(id);
      }

      currentPendingCount = getPendingCount(data, pendingTickets);

      sendPendingTicketCount(currentPendingCount);

      updateTray(currentPendingCount);

      console.log("[Formosa Chamados] Monitoramento inicial:", {
        pending: currentPendingCount,

        ids: pendingIds.length,
      });

      return;
    }

    const newTickets = pendingTickets.filter((ticket) => {
      const id = getTicketId(ticket);

      if (!id) {
        return false;
      }

      return !knownPendingTicketIds.has(id) && !notifiedTicketIds.has(id);
    });

    knownPendingTicketIds.clear();

    for (const id of pendingIds) {
      knownPendingTicketIds.add(id);
    }

    currentPendingCount = getPendingCount(data, pendingTickets);

    sendPendingTicketCount(currentPendingCount);

    updateTray(currentPendingCount);

    for (const ticket of newTickets) {
      showNewTicketNotification(ticket);
    }

    cleanupTrackedTicketIds();
  } catch (error) {
    console.error("[Formosa Chamados] Erro ao consultar tickets:", error);
  } finally {
    ticketsCheckInProgress = false;
  }
}

/*
 * ============================================================
 * TICKET HELPERS
 * ============================================================
 */

function getTicketId(ticket: TicketSummary): string | null {
  const value =
    ticket?.id ?? ticket?.protocol ?? ticket?.number ?? ticket?.code;

  if (value === undefined || value === null) {
    return null;
  }

  return String(value);
}

function getPendingCount(
  data: TicketsApiResponse,
  pendingTickets: TicketSummary[],
): number {
  const total = Number(data?.totalElements ?? 0);

  const content = Array.isArray(data?.content) ? data.content : [];

  const allArePending =
    content.length > 0 &&
    content.every(
      (ticket) => String(ticket?.status ?? "").toUpperCase() === "PENDING",
    );

  return allArePending ? total : pendingTickets.length;
}

function cleanupTrackedTicketIds(): void {
  if (notifiedTicketIds.size <= MAX_TRACKED_TICKET_IDS) {
    return;
  }

  const ids = Array.from(notifiedTicketIds);

  notifiedTicketIds.clear();

  for (const id of ids.slice(-MAX_TRACKED_TICKET_IDS)) {
    notifiedTicketIds.add(id);
  }
}

/*
 * ============================================================
 * POLLING
 * ============================================================
 */

function startTicketsPolling(): void {
  stopTicketsPolling();

  void checkPendingTickets();

  ticketsPollTimer = setInterval(() => {
    void checkPendingTickets();
  }, TICKETS_POLL_INTERVAL);
}

function stopTicketsPolling(): void {
  if (!ticketsPollTimer) {
    return;
  }

  clearInterval(ticketsPollTimer);

  ticketsPollTimer = null;
}

/*
 * ============================================================
 * TOOLBAR
 * ============================================================
 */

function sendPendingTicketCount(count: number): void {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("tickets:pending-count", count);
}

function sendToolbarStatus(status: {
  loading: boolean;
  online: boolean;
}): void {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("system-status", status);
}

function updateNavigationState(): void {
  if (!systemView || !mainWindow) {
    return;
  }

  if (mainWindow.webContents.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("navigation-state", {
    canGoBack: systemView.webContents.canGoBack(),

    canGoForward: systemView.webContents.canGoForward(),
  });
}

function sendMaximizedState(): void {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("window:maximized", mainWindow.isMaximized());
}

/*
 * ============================================================
 * UPDATE STATE
 * ============================================================
 */

function sendUpdateState(): void {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("app:update-state", getUpdaterState());
}

/*
 * ============================================================
 * NOTIFICAÇÃO
 * ============================================================
 */

function showNewTicketNotification(ticket: TicketSummary): void {
  if (!Notification.isSupported()) {
    return;
  }

  if (String(ticket?.status ?? "").toUpperCase() !== "PENDING") {
    return;
  }

  const ticketId = getTicketId(ticket);

  if (ticketId && notifiedTicketIds.has(ticketId)) {
    return;
  }

  if (ticketId) {
    notifiedTicketIds.add(ticketId);
  }

  const protocol = ticket.protocol
    ? String(ticket.protocol)
    : ticket.number
      ? String(ticket.number)
      : "";

  const title = getTicketTitle(ticket);

  const notificationTitle = protocol
    ? `Novo chamado ${protocol}`
    : "Novo chamado pendente";

  const notificationBody = title || "Um novo chamado foi recebido.";

  try {
    const icon = getTrayIcon();

    const notification = new Notification({
      title: notificationTitle,

      body: notificationBody,

      silent: false,

      urgency: "normal",

      timeoutType: "default",

      icon: icon.isEmpty() ? undefined : icon,
    });

    notification.on("click", () => {
      openTicketFromNotification(ticket);
    });

    notification.show();
  } catch (error) {
    console.error("[Formosa Chamados] Erro ao criar notificação:", error);
  }
}

function showTestNotification(): void {
  if (!Notification.isSupported()) {
    return;
  }

  try {
    const notification = new Notification({
      title: "Formosa Chamados",

      body: "As notificações do Windows estão funcionando.",

      silent: false,

      urgency: "normal",

      timeoutType: "default",

      icon: getTrayIcon(),
    });

    notification.on("click", () => {
      openMainWindow();
    });

    notification.show();
  } catch (error) {
    console.error("[Formosa Chamados] Erro na notificação:", error);
  }
}

function getTicketTitle(ticket: TicketSummary | null): string {
  if (!ticket) {
    return "";
  }

  const title = ticket.description ?? ticket.title ?? ticket.subject ?? "";

  return String(title).replace(/\s+/g, " ").trim().slice(0, 180);
}

function openTicketFromNotification(ticket: TicketSummary): void {
  if (!mainWindow || !systemView) {
    return;
  }

  const ticketId = getTicketId(ticket);

  const targetUrl = ticketId
    ? `${SYSTEM_ORIGIN}/tickets/${encodeURIComponent(ticketId)}`
    : SYSTEM_URL;

  if (!isAllowedUrl(targetUrl)) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();

  mainWindow.focus();

  resizeSystemView();

  void systemView.webContents.loadURL(targetUrl);
}

/*
 * ============================================================
 * TRAY
 * ============================================================
 */

function createTray(): void {
  if (tray) {
    return;
  }

  const icon = getTrayIcon();

  tray = new Tray(icon);

  tray.setToolTip(APP_NAME);

  updateTray(0);

  tray.on("click", openMainWindow);

  tray.on("double-click", openMainWindow);
}

function openMainWindow(): void {
  if (!mainWindow) {
    createWindow();

    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();

  mainWindow.focus();

  resizeSystemView();
}

function updateTray(pendingCount: number): void {
  if (!tray) {
    return;
  }

  const updateState = getUpdaterState();

  const label =
    pendingCount > 0
      ? `Chamados pendentes: ${pendingCount}`
      : "Nenhum chamado pendente";

  tray.setToolTip(`${APP_NAME} — ${label}`);

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label,
      enabled: false,
    },

    {
      type: "separator",
    },

    {
      label: "Abrir Formosa Chamados",

      click: openMainWindow,
    },

    {
      label: "Atualizar chamados",

      click: () => {
        void checkPendingTickets();
      },
    },

    {
      label: "Testar notificação",

      click: () => {
        showTestNotification();
      },
    },

    {
      label: "Verificar atualização",

      click: () => {
        void checkForUpdates(true);
      },
    },
  ];

  if (updateState.downloaded) {
    template.push({
      label: `Instalar atualização ${updateState.version ?? ""}`.trim(),

      click: () => {
        installDownloadedUpdate();
      },
    });
  } else if (updateState.updateAvailable) {
    template.push({
      label: `Baixando atualização ${updateState.version ?? ""} — ${updateState.progress}%`,

      enabled: false,
    });
  }

  template.push(
    {
      label: "Abrir chamados pendentes",

      enabled: pendingCount > 0,

      click: () => {
        if (!systemView || !isAllowedUrl(SYSTEM_URL)) {
          return;
        }

        void systemView.webContents.loadURL(SYSTEM_URL);

        openMainWindow();
      },
    },

    {
      type: "separator",
    },

    {
      label: "Sair",

      click: () => {
        isQuitting = true;

        app.quit();
      },
    },
  );

  const contextMenu = Menu.buildFromTemplate(template);

  tray.setContextMenu(contextMenu);
}

/*
 * ============================================================
 * SIDEBAR
 * ============================================================
 */

function disableWebsiteSidebarToggle(): void {
  if (!systemView || systemView.webContents.isDestroyed()) {
    return;
  }

  const css = `
    button[aria-label="Alternar menu lateral"] {
      display: none !important;
    }
  `;

  void systemView.webContents
    .insertCSS(css, {
      cssOrigin: "user",
    })
    .catch((error) => {
      console.error("[Formosa Chamados] Erro ao ocultar menu lateral:", error);
    });

  void systemView.webContents
    .executeJavaScript(
      `
      (() => {
        const hideSidebarToggle = () => {
          const buttons =
            document.querySelectorAll(
              'button[aria-label="Alternar menu lateral"]'
            );

          buttons.forEach(
            (button) => {
              button.style.setProperty(
                "display",
                "none",
                "important",
              );

              button.setAttribute(
                "aria-hidden",
                "true",
              );

              button.setAttribute(
                "tabindex",
                "-1",
              );
            },
          );
        };

        hideSidebarToggle();

        if (
          !window.__formosaSidebarObserver
        ) {
          const observer =
            new MutationObserver(
              () => {
                hideSidebarToggle();
              },
            );

          observer.observe(
            document.documentElement,
            {
              childList: true,
              subtree: true,
            },
          );

          window.__formosaSidebarObserver =
            observer;
        }
      })();
      `,
      true,
    )
    .catch((error) => {
      console.error(
        "[Formosa Chamados] Erro ao controlar menu lateral:",
        error,
      );
    });
}

/*
 * ============================================================
 * IPC
 * ============================================================
 */

function configureIPC(): void {
  if (ipcConfigured) {
    return;
  }

  ipcConfigured = true;

  ipcMain.on("window:minimize", () => {
    mainWindow?.minimize();
  });

  ipcMain.on("window:maximize", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on("window:close", () => {
    mainWindow?.hide();
  });

  ipcMain.on("navigation:back", () => {
    if (systemView && systemView.webContents.canGoBack()) {
      systemView.webContents.goBack();
    }
  });

  ipcMain.on("navigation:forward", () => {
    if (systemView && systemView.webContents.canGoForward()) {
      systemView.webContents.goForward();
    }
  });

  ipcMain.on("navigation:reload", () => {
    systemView?.webContents.reload();
  });

  ipcMain.on("tickets:refresh", () => {
    void checkPendingTickets();
  });

  ipcMain.on("notification:test", () => {
    showTestNotification();
  });

  ipcMain.on("app:update-check", () => {
    void checkForUpdates(true);
  });

  ipcMain.on("app:update-install", () => {
    installDownloadedUpdate();
  });
}

/*
 * ============================================================
 * PERMISSIONS
 * ============================================================
 */

function configurePermissions(): void {
  if (!systemSession) {
    configurePersistentSession();
  }

  if (!systemSession) {
    return;
  }

  systemSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const url = webContents.getURL();

      try {
        const origin = new URL(url).origin;

        if (origin !== SYSTEM_ORIGIN) {
          callback(false);

          return;
        }
      } catch {
        callback(false);

        return;
      }

      callback(permission === "notifications");
    },
  );
}

/*
 * ============================================================
 * DISPLAY
 * ============================================================
 */

function configureDisplayHandling(): void {
  screen.on("display-metrics-changed", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMaximized()) {
      resizeSystemView();

      return;
    }

    const bounds = mainWindow.getBounds();

    const display = screen.getDisplayNearestPoint({
      x: bounds.x,
      y: bounds.y,
    });

    const workArea = display.workArea;

    const visible =
      bounds.x < workArea.x + workArea.width &&
      bounds.x + bounds.width > workArea.x &&
      bounds.y < workArea.y + workArea.height &&
      bounds.y + bounds.height > workArea.y;

    if (!visible) {
      const safe = getSafeWindowBounds();

      mainWindow.setBounds(safe);
    }

    resizeSystemView();
  });
}

/*
 * ============================================================
 * APP READY
 * ============================================================
 */

if (gotTheLock) {
  app.whenReady().then(() => {
    if (process.platform === "win32") {
      app.setAppUserModelId(APP_USER_MODEL_ID);

      console.log("[Formosa Chamados] AppUserModelId:", APP_USER_MODEL_ID);
    }

    console.log(
      "[Formosa Chamados] Notification.isSupported():",
      Notification.isSupported(),
    );

    configurePersistentSession();

    configureIPC();

    configurePermissions();

    configureDisplayHandling();

    createTray();

    createWindow();

    /*
     * ========================================================
     * AUTO UPDATE
     * ========================================================
     */

    configureAutoUpdater({
      sendUpdateState,

      updateTray: () => {
        updateTray(currentPendingCount);
      },

      getMainWindow: () => mainWindow,

      setQuitting: (value) => {
        isQuitting = value;
      },
    });

    app.on("activate", () => {
      openMainWindow();
    });
  });

  app.on("second-instance", () => {
    openMainWindow();
  });
}

/*
 * ============================================================
 * WINDOW ALL CLOSED
 * ============================================================
 */

app.on("window-all-closed", () => {
  if (process.platform === "darwin") {
    app.quit();
  }
});

/*
 * ============================================================
 * BEFORE QUIT
 * ============================================================
 */

app.on("before-quit", () => {
  isQuitting = true;

  stopTicketsPolling();

  stopAutoUpdater();

  if (tray) {
    tray.destroy();

    tray = null;
  }
});
