import { contextBridge, ipcRenderer } from "electron";

/* ============================================================
   TIPOS
   ============================================================ */

interface SystemStatus {
  loading: boolean;
  online: boolean;
}

interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

interface WebsiteTheme {
  background: string;
  color: string;
  colorScheme?: string;
}

/*
 * ============================================================
 * RESULTADO DA PESQUISA
 * ============================================================
 */

type TicketSearchResult = unknown;

/*
 * ============================================================
 * FORMOSA WINDOW API
 * ============================================================
 */

contextBridge.exposeInMainWorld("formosaWindow", {
  /* ========================================================
     WINDOW
     ======================================================== */

  minimize: (): void => {
    ipcRenderer.send("window:minimize");
  },

  maximize: (): void => {
    ipcRenderer.send("window:maximize");
  },

  close: (): void => {
    ipcRenderer.send("window:close");
  },

  /* ========================================================
     NAVIGATION
     ======================================================== */

  back: (): void => {
    ipcRenderer.send("navigation:back");
  },

  forward: (): void => {
    ipcRenderer.send("navigation:forward");
  },

  reload: (): void => {
    ipcRenderer.send("navigation:reload");
  },

  /* ========================================================
     SYSTEM STATUS
     ======================================================== */

  onStatus: (callback: (status: SystemStatus) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: SystemStatus,
    ): void => {
      if (!status || typeof status !== "object") {
        return;
      }

      callback({
        loading: Boolean(status.loading),
        online: Boolean(status.online),
      });
    };

    ipcRenderer.on("system-status", listener);

    return () => {
      ipcRenderer.removeListener("system-status", listener);
    };
  },

  /* ========================================================
     NAVIGATION STATE
     ======================================================== */

  onNavigationState: (
    callback: (state: NavigationState) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: NavigationState,
    ): void => {
      if (!state || typeof state !== "object") {
        return;
      }

      callback({
        canGoBack: Boolean(state.canGoBack),
        canGoForward: Boolean(state.canGoForward),
      });
    };

    ipcRenderer.on("navigation-state", listener);

    return () => {
      ipcRenderer.removeListener("navigation-state", listener);
    };
  },

  /* ========================================================
     MAXIMIZED
     ======================================================== */

  onMaximized: (callback: (maximized: boolean) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      maximized: boolean,
    ): void => {
      callback(Boolean(maximized));
    };

    ipcRenderer.on("window:maximized", listener);

    return () => {
      ipcRenderer.removeListener("window:maximized", listener);
    };
  },

  /* ========================================================
     WEBSITE THEME
     ======================================================== */

  onWebsiteTheme: (callback: (theme: WebsiteTheme) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      theme: WebsiteTheme,
    ): void => {
      if (!theme || typeof theme !== "object") {
        return;
      }

      callback({
        background:
          typeof theme.background === "string"
            ? theme.background
            : "rgb(255, 255, 255)",

        color:
          typeof theme.color === "string" ? theme.color : "rgb(17, 24, 39)",

        colorScheme:
          typeof theme.colorScheme === "string" ? theme.colorScheme : "light",
      });
    };

    ipcRenderer.on("website-theme", listener);

    return () => {
      ipcRenderer.removeListener("website-theme", listener);
    };
  },

  /* ========================================================
     PENDING TICKETS
     ======================================================== */

  onPendingTicketCount: (callback: (count: number) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      count: unknown,
    ): void => {
      const numericCount = typeof count === "number" ? count : Number(count);

      const safeCount = Number.isFinite(numericCount)
        ? Math.max(0, Math.floor(numericCount))
        : 0;

      callback(safeCount);
    };

    ipcRenderer.on("tickets:pending-count", listener);

    return () => {
      ipcRenderer.removeListener("tickets:pending-count", listener);
    };
  },

  /* ========================================================
     REFRESH TICKETS
     ======================================================== */

  refreshTickets: (): void => {
    ipcRenderer.send("tickets:refresh");
  },

  /* ========================================================
     PESQUISA
     ======================================================== */

  searchTickets: (query: string): void => {
    const safeQuery =
      typeof query === "string" ? query.trim().slice(0, 200) : "";

    ipcRenderer.send("tickets:search", safeQuery);
  },

  /* ========================================================
     LIMPAR PESQUISA
     ======================================================== */

  clearTicketSearch: (): void => {
    ipcRenderer.send("tickets:search-clear");
  },

  /* ========================================================
     RESULTADOS DA PESQUISA
     ======================================================== */

  onTicketSearchResults: (
    callback: (results: TicketSearchResult) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      results: TicketSearchResult,
    ): void => {
      callback(results);
    };

    ipcRenderer.on("tickets:search-results", listener);

    return () => {
      ipcRenderer.removeListener("tickets:search-results", listener);
    };
  },

  /* ========================================================
     ERRO DA PESQUISA
     ======================================================== */

  onTicketSearchError: (callback: (message: string) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      message: unknown,
    ): void => {
      const safeMessage =
        typeof message === "string"
          ? message
          : "Não foi possível pesquisar os chamados.";

      callback(safeMessage);
    };

    ipcRenderer.on("tickets:search-error", listener);

    return () => {
      ipcRenderer.removeListener("tickets:search-error", listener);
    };
  },
});

/*
 * ============================================================
 * SEGURANÇA
 * ============================================================
 *
 * Não expor:
 *
 * - ipcRenderer
 * - process
 * - require
 * - Electron
 * - Node.js
 *
 * diretamente para a página.
 *
 * A página recebe somente a API "formosaWindow".
 * ============================================================
 */
