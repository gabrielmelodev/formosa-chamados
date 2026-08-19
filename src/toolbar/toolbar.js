"use strict";

/**
 * ============================================================
 * ELEMENTOS DA TOOLBAR
 * ============================================================
 */

const backButton = document.getElementById("back");
const forwardButton = document.getElementById("forward");
const reloadButton = document.getElementById("reload");

const minimizeButton = document.getElementById("minimize");
const maximizeButton = document.getElementById("maximize");
const closeButton = document.getElementById("close");

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");

const maximizeIcon = document.getElementById("maximize-icon");

/**
 * ============================================================
 * NOTIFICAÇÕES / CHAMADOS
 * ============================================================
 */

const notificationsButton = document.getElementById("notifications");
const ticketBadge = document.getElementById("ticket-badge");

/**
 * ============================================================
 * VALIDAÇÃO
 * ============================================================
 */

if (
  !backButton ||
  !forwardButton ||
  !reloadButton ||
  !minimizeButton ||
  !maximizeButton ||
  !closeButton ||
  !statusDot ||
  !statusText ||
  !maximizeIcon
) {
  throw new Error(
    "[Formosa Chamados] Elementos obrigatórios da toolbar não encontrados.",
  );
}

/**
 * ============================================================
 * PRELOAD
 * ============================================================
 */

if (!window.formosaWindow) {
  throw new Error("[Formosa Chamados] API formosaWindow não encontrada.");
}

/**
 * ============================================================
 * ESTADO
 * ============================================================
 */

let pendingTicketCount = 0;

let previousPendingTicketCount = 0;

/**
 * ============================================================
 * NAVEGAÇÃO
 * ============================================================
 */

backButton.addEventListener("click", () => {
  window.formosaWindow.back();
});

forwardButton.addEventListener("click", () => {
  window.formosaWindow.forward();
});

reloadButton.addEventListener("click", () => {
  window.formosaWindow.reload();
});

/**
 * ============================================================
 * CONTROLES DA JANELA
 * ============================================================
 */

minimizeButton.addEventListener("click", () => {
  window.formosaWindow.minimize();
});

maximizeButton.addEventListener("click", () => {
  window.formosaWindow.maximize();
});

closeButton.addEventListener("click", () => {
  window.formosaWindow.close();
});

/**
 * ============================================================
 * STATUS DO SISTEMA
 * ============================================================
 */

window.formosaWindow.onStatus((status) => {
  if (!status) {
    return;
  }

  statusDot.classList.remove("online", "offline", "loading");

  if (status.loading) {
    statusDot.classList.add("loading");

    statusText.textContent = "Carregando...";

    return;
  }

  if (status.online) {
    statusDot.classList.add("online");

    statusText.textContent = "Conectado";

    return;
  }

  statusDot.classList.add("offline");

  statusText.textContent = "Sem conexão";
});

/**
 * ============================================================
 * ESTADO DA NAVEGAÇÃO
 * ============================================================
 */

window.formosaWindow.onNavigationState((state) => {
  if (!state) {
    return;
  }

  backButton.disabled = !state.canGoBack;

  forwardButton.disabled = !state.canGoForward;
});

/**
 * ============================================================
 * ANIMAÇÃO DA NOTIFICAÇÃO
 * ============================================================
 */

function animateNotification() {
  if (!notificationsButton) {
    return;
  }

  notificationsButton.classList.remove("notification-pulse");

  /*
   * Força o navegador a reiniciar
   * a animação CSS.
   */

  void notificationsButton.offsetWidth;

  notificationsButton.classList.add("notification-pulse");

  window.setTimeout(() => {
    notificationsButton.classList.remove("notification-pulse");
  }, 700);
}

/**
 * ============================================================
 * ATUALIZAR BADGE DE CHAMADOS
 * ============================================================
 */

function updateTicketBadge(count) {
  if (!ticketBadge) {
    return;
  }

  let total = Number(count);

  /*
   * Proteção contra valores inválidos.
   */

  if (!Number.isFinite(total)) {
    total = 0;
  }

  total = Math.max(0, Math.floor(total));

  const oldCount = pendingTicketCount;

  pendingTicketCount = total;

  /**
   * ==========================================================
   * NENHUM CHAMADO
   * ==========================================================
   */

  if (total === 0) {
    ticketBadge.textContent = "0";

    ticketBadge.classList.add("hidden");

    ticketBadge.setAttribute("aria-hidden", "true");

    if (notificationsButton) {
      notificationsButton.classList.remove("has-tickets");

      notificationsButton.setAttribute("aria-label", "Nenhum chamado pendente");

      notificationsButton.setAttribute("title", "Nenhum chamado pendente");
    }

    previousPendingTicketCount = 0;

    return;
  }

  /**
   * ==========================================================
   * BADGE
   * ==========================================================
   */

  ticketBadge.textContent = total > 99 ? "99+" : String(total);

  ticketBadge.classList.remove("hidden");

  ticketBadge.setAttribute("aria-hidden", "false");

  /**
   * ==========================================================
   * ACESSIBILIDADE
   * ==========================================================
   */

  const label =
    `${total} chamado${total === 1 ? "" : "s"} ` +
    `pendente${total === 1 ? "" : "s"}`;

  if (notificationsButton) {
    notificationsButton.classList.add("has-tickets");

    notificationsButton.setAttribute("aria-label", label);

    notificationsButton.setAttribute("title", label);
  }

  /**
   * ==========================================================
   * NOVOS CHAMADOS
   * ==========================================================
   */

  if (total > previousPendingTicketCount) {
    animateNotification();
  }

  previousPendingTicketCount = total;

  console.log("[Formosa Chamados] Badge atualizado:", {
    anterior: oldCount,
    atual: total,
  });
}

/**
 * ============================================================
 * RECEBER CONTADOR DO MAIN PROCESS
 * ============================================================
 */

if (typeof window.formosaWindow.onPendingTicketCount === "function") {
  window.formosaWindow.onPendingTicketCount((count) => {
    console.log("[Formosa Chamados] Chamados pendentes:", count);

    updateTicketBadge(count);
  });
}

/**
 * ============================================================
 * BOTÃO DE NOTIFICAÇÕES
 * ============================================================
 */

if (notificationsButton) {
  notificationsButton.addEventListener("click", () => {
    console.log("[Formosa Chamados] Atualizando chamados...");

    /*
     * Consulta imediatamente o servidor.
     */

    if (typeof window.formosaWindow.refreshTickets === "function") {
      window.formosaWindow.refreshTickets();
    }
  });
}

/**
 * ============================================================
 * TEMA DO SITE
 * ============================================================
 */

window.formosaWindow.onWebsiteTheme((theme) => {
  if (!theme) {
    return;
  }

  const root = document.documentElement;

  const background =
    typeof theme.background === "string" ? theme.background.trim() : "";

  const text = typeof theme.color === "string" ? theme.color.trim() : "";

  /**
   * ========================================================
   * FUNDO
   * ========================================================
   */

  if (
    background &&
    background !== "transparent" &&
    background !== "rgba(0, 0, 0, 0)"
  ) {
    root.style.setProperty("--site-bg", background);
  }

  /**
   * ========================================================
   * TEXTO
   * ========================================================
   */

  if (text && text !== "currentColor" && text !== "inherit") {
    root.style.setProperty("--site-text", text);
  }

  /**
   * ========================================================
   * LIGHT / DARK
   * ========================================================
   */

  const isDark = isDarkColor(background);

  root.style.setProperty("color-scheme", isDark ? "dark" : "light");

  root.dataset.theme = isDark ? "dark" : "light";

  document.body.dataset.themeLoaded = "true";

  console.log("[Formosa Chamados] Tema:", isDark ? "dark" : "light", {
    background,
    color: text,
  });
});

/**
 * ============================================================
 * DETECTAR COR ESCURA
 * ============================================================
 */

function isDarkColor(color) {
  if (!color) {
    return false;
  }

  /**
   * ==========================================================
   * RGB / RGBA
   * ==========================================================
   */

  const rgbMatch = color.match(
    /rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/,
  );

  if (rgbMatch) {
    const r = Number(rgbMatch[1]);

    const g = Number(rgbMatch[2]);

    const b = Number(rgbMatch[3]);

    return getLuminance(r, g, b) < 0.5;
  }

  /**
   * ==========================================================
   * HEX
   * ==========================================================
   */

  if (color.startsWith("#")) {
    let hex = color.substring(1);

    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((value) => value + value)
        .join("");
    }

    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16);

      const g = parseInt(hex.substring(2, 4), 16);

      const b = parseInt(hex.substring(4, 6), 16);

      return getLuminance(r, g, b) < 0.5;
    }
  }

  return false;
}

/**
 * ============================================================
 * LUMINÂNCIA
 * ============================================================
 */

function getLuminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * ============================================================
 * MAXIMIZAR / RESTAURAR
 * ============================================================
 */

function updateMaximizeButton(maximized) {
  if (maximized) {
    maximizeButton.setAttribute("aria-label", "Restaurar");

    maximizeButton.setAttribute("title", "Restaurar");

    maximizeIcon.innerHTML = `
      <path d="M9 9h10v10H9z"></path>
      <path d="M5 15V5h10"></path>
    `;

    return;
  }

  maximizeButton.setAttribute("aria-label", "Maximizar");

  maximizeButton.setAttribute("title", "Maximizar");

  maximizeIcon.innerHTML = `
    <rect
      x="5"
      y="5"
      width="14"
      height="14"
      rx="1"
    ></rect>
  `;
}

window.formosaWindow.onMaximized((maximized) => {
  updateMaximizeButton(maximized);
});

/**
 * ============================================================
 * ATALHOS DE TECLADO
 * ============================================================
 */

document.addEventListener("keydown", (event) => {
  /**
   * ========================================================
   * F5
   * ========================================================
   */

  if (event.key === "F5") {
    event.preventDefault();

    window.formosaWindow.reload();

    return;
  }

  /**
   * ========================================================
   * CTRL + R
   * ========================================================
   */

  if (event.ctrlKey && event.key.toLowerCase() === "r") {
    event.preventDefault();

    window.formosaWindow.reload();

    return;
  }

  /**
   * ========================================================
   * ALT + ←
   * ========================================================
   */

  if (event.altKey && event.key === "ArrowLeft") {
    event.preventDefault();

    window.formosaWindow.back();

    return;
  }

  /**
   * ========================================================
   * ALT + →
   * ========================================================
   */

  if (event.altKey && event.key === "ArrowRight") {
    event.preventDefault();

    window.formosaWindow.forward();

    return;
  }
});

/**
 * ============================================================
 * INICIALIZAÇÃO
 * ============================================================
 */

backButton.disabled = true;

forwardButton.disabled = true;

statusDot.classList.remove("offline", "online");

statusDot.classList.add("loading");

statusText.textContent = "Carregando...";

/**
 * ============================================================
 * ESTADO INICIAL DAS NOTIFICAÇÕES
 * ============================================================
 */

pendingTicketCount = 0;

previousPendingTicketCount = 0;

if (ticketBadge) {
  ticketBadge.textContent = "0";

  ticketBadge.classList.add("hidden");

  ticketBadge.setAttribute("aria-hidden", "true");
}

if (notificationsButton) {
  notificationsButton.classList.remove("has-tickets", "notification-pulse");

  notificationsButton.setAttribute("aria-label", "Nenhum chamado pendente");

  notificationsButton.setAttribute("title", "Nenhum chamado pendente");
}

/**
 * ============================================================
 * ESTADO INICIAL MAXIMIZAR
 * ============================================================
 */

updateMaximizeButton(false);

/**
 * ============================================================
 * FINALIZAÇÃO
 * ============================================================
 */

console.log("[Formosa Chamados] Toolbar inicializada.");
