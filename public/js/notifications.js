(function() {
  const userId = localStorage.getItem("userId");
  const role = localStorage.getItem("role");
  let unreadCount = 0;

  function updateBadge(count) {
    unreadCount = count;
    const badge = document.getElementById("notif-badge");
    if (badge) {
      if (count > 0) {
        badge.style.display = "block";
        badge.textContent = count > 9 ? "9+" : count;
      } else {
        badge.style.display = "none";
      }
    }
  }

  // Expose fetchUnreadCount globally immediately when script is parsed
  window.fetchUnreadCount = function() {
    const deptId = localStorage.getItem("deptId") || "";
    if (!userId || !role) return;
    if (typeof apiFetch === "undefined") return;

    apiFetch(`/notifications/unread-count?role=${role}&userId=${userId}&deptId=${deptId}`)
      .then((res) => res.json())
      .then((data) => {
        updateBadge(data.count);
      })
      .catch((err) => console.error("Error fetching unread count:", err));
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (!userId || !role) return; // Not logged in

    // Find the action button (logout or back) in the topbar
    const actionBtn = document.getElementById("logoutBtn") || 
                      document.getElementById("backBtn") || 
                      document.querySelector(".back-btn") || 
                      document.querySelector(".backBtn") ||
                      document.querySelector(".logout");

    if (!actionBtn) return;

    // 1. Inject CSS Styles
    const style = document.createElement("style");
    style.textContent = `
      .topbar-actions {
        display: flex;
        align-items: center;
        gap: 16px;
        position: relative;
      }
      .notif-wrapper {
        position: relative;
      }
      .notif-toggle {
        width: 44px;
        height: 44px;
        display: grid;
        place-items: center;
        border: 1px solid var(--border, #cbd5e1);
        border-radius: 14px;
        background: linear-gradient(180deg, #ffffff, #f8fbff);
        color: var(--text, #0f172a);
        cursor: pointer;
        box-shadow: 0 10px 22px rgba(15, 23, 42, 0.05);
        transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, color 0.2s ease;
      }
      .notif-toggle:hover {
        transform: translateY(-1px);
        border-color: rgba(29, 78, 216, 0.35);
        color: var(--primary, #1d4ed8);
        box-shadow: 0 14px 26px rgba(29, 78, 216, 0.12);
      }
      .notif-toggle svg {
        width: 21px;
        height: 21px;
      }
      .notif-badge {
        position: absolute;
        top: -3px;
        right: -3px;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        border-radius: 999px;
        background: linear-gradient(135deg, #ef4444, #dc2626);
        color: #fff;
        font-size: 10px;
        font-weight: 800;
        line-height: 18px;
        text-align: center;
        border: 2px solid #fff;
        box-shadow: 0 8px 16px rgba(220, 38, 38, 0.24);
      }
      .notif-panel {
        display: none;
        position: absolute;
        top: calc(100% + 12px);
        right: 0;
        width: min(360px, calc(100vw - 32px));
        background: rgba(255, 255, 255, 0.98);
        border: 1px solid rgba(219, 227, 239, 0.95);
        border-radius: 18px;
        z-index: 1000;
        overflow: hidden;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.16);
        backdrop-filter: blur(16px);
      }
      .notif-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(219, 227, 239, 0.9);
        background: linear-gradient(180deg, #ffffff, #f8fafc);
      }
      .notif-panel-title {
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 800;
        font-size: 0.92rem;
        letter-spacing: -0.01em;
        color: var(--text, #0f172a);
      }
      .notif-panel-title::before {
        content: "";
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--primary, #1d4ed8), var(--accent, #0f766e));
        box-shadow: 0 0 0 4px rgba(29, 78, 216, 0.1);
      }
      .notif-mark-read {
        border: none;
        background: transparent;
        color: var(--primary, #1d4ed8);
        font: inherit;
        font-size: 0.82rem;
        font-weight: 700;
        cursor: pointer;
        padding: 6px 8px;
        border-radius: 10px;
        transition: background 0.2s ease, color 0.2s ease;
      }
      .notif-mark-read:hover {
        background: rgba(29, 78, 216, 0.08);
        color: var(--primary-dark, #1e3a8a);
      }
      .notif-list {
        max-height: 340px;
        overflow-y: auto;
        padding: 8px;
      }
      .notif-list::-webkit-scrollbar {
        width: 10px;
      }
      .notif-list::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 999px;
        border: 3px solid transparent;
        background-clip: content-box;
      }
      .notif-empty {
        padding: 18px 14px;
        color: var(--muted, #64748b);
        font-size: 0.9rem;
        text-align: center;
      }
      .notif-item {
        padding: 14px;
        border-radius: 14px;
        border: 1px solid transparent;
        text-align: left;
        transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
      }
      .notif-item + .notif-item {
        margin-top: 8px;
      }
      .notif-item.unread {
        background: linear-gradient(180deg, #f7fbff, #eef5ff);
        border-color: rgba(29, 78, 216, 0.12);
      }
      .notif-item.read {
        background: #ffffff;
        border-color: rgba(219, 227, 239, 0.8);
      }
      .notif-item:hover {
        transform: translateY(-1px);
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
      }
      .notif-item-title {
        margin: 0 0 4px;
        font-size: 0.92rem;
        font-weight: 800;
        color: #0f172a;
        letter-spacing: -0.01em;
      }
      .notif-item-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }
      .notif-item-row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .notif-item-time {
        flex: 0 0 auto;
        color: #94a3b8;
        font-size: 0.72rem;
        white-space: nowrap;
      }
      .notif-item-message {
        margin: 0 0 8px;
        color: #475569;
        font-size: 0.86rem;
        line-height: 1.55;
      }
      .notif-item-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: #94a3b8;
        font-size: 0.72rem;
      }
      .notif-item-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: 0 0 auto;
        background: #cbd5e1;
      }
      .notif-item.unread .notif-item-dot {
        background: linear-gradient(135deg, var(--primary, #1d4ed8), var(--accent, #0f766e));
      }
      .notif-item-empty-state {
        margin-top: 0;
      }
      .notif-fade-in {
        animation: notifFadeIn 0.18s ease-out;
      }
      @keyframes notifFadeIn {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `;
    document.head.appendChild(style);

    // 2. Inject HTML Bell
    const parent = actionBtn.parentElement;
    const topbarActions = document.createElement("div");
    topbarActions.className = "topbar-actions";

    const notifWrapper = document.createElement("div");
    notifWrapper.className = "notif-wrapper";
    notifWrapper.innerHTML = `
      <button
        class="notif-toggle"
        type="button"
        id="notifToggleBtn"
        aria-label="Open notifications"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 21a2.25 2.25 0 0 0 2.19-1.75h-4.38A2.25 2.25 0 0 0 12 21Z"
            fill="currentColor"
          />
          <path
            d="M19 17H5c.83-.86 1.32-2.02 1.37-3.24V10a5.63 5.63 0 0 1 4.88-5.6V4a1.75 1.75 0 1 1 3.5 0v.4A5.63 5.63 0 0 1 19.63 10v3.76c.05 1.22.54 2.38 1.37 3.24ZM12 7a3 3 0 0 0-3 3v3.95c0 .92-.28 1.8-.79 2.55h7.58a4.47 4.47 0 0 1-.79-2.55V10a3 3 0 0 0-3-3Z"
            fill="currentColor"
          />
        </svg>
      </button>
      <span id="notif-badge" class="notif-badge" style="display: none">0</span>
      <!-- Notification dropdown panel -->
      <div id="notif-panel" class="notif-panel">
        <div class="notif-panel-header">
          <span class="notif-panel-title">Notifications</span>
          <button
            class="notif-mark-read"
            type="button"
            id="markAllReadBtn"
          >
            Mark all read
          </button>
        </div>
        <div id="notif-list" class="notif-list">
          <p class="notif-empty notif-item-empty-state">Loading...</p>
        </div>
      </div>
    `;

    topbarActions.appendChild(notifWrapper);
    parent.insertBefore(topbarActions, actionBtn);
    topbarActions.appendChild(actionBtn);

    // Close panel when clicking outside
    document.addEventListener("click", (e) => {
      const panel = document.getElementById("notif-panel");
      const toggleBtn = document.getElementById("notifToggleBtn");
      if (panel && toggleBtn && !panel.contains(e.target) && !toggleBtn.contains(e.target)) {
        panel.style.display = "none";
      }
    });

    function toggleNotifPanel() {
      const panel = document.getElementById("notif-panel");
      if (!panel) return;
      const isOpen = panel.style.display === "block";
      panel.style.display = isOpen ? "none" : "block";
      if (!isOpen) loadNotifications();
    }

    function loadNotifications() {
      const deptId = localStorage.getItem("deptId") || "";
      fetch(`/api/notifications/all?role=${role}&userId=${userId}&deptId=${deptId}`)
        .then((r) => r.json())
        .then((data) => {
          const list = document.getElementById("notif-list");
          if (!list) return;
          if (data.length === 0) {
            list.innerHTML = '<p class="notif-empty notif-item-empty-state">No notifications yet.</p>';
            return;
          }
          list.innerHTML = data
            .map(
              (n) => `
            <div class="notif-item ${n.is_read ? "read" : "unread"} notif-fade-in">
              <div class="notif-item-head">
                <span class="notif-item-row">
                  <span class="notif-item-dot"></span>
                  <span class="notif-item-title">${escapeHtml(n.title)}</span>
                </span>
                <span class="notif-item-time">${new Date(n.created_at).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })}</span>
              </div>
              <p class="notif-item-message">${escapeHtml(n.message)}</p>
              ${
                n.pdf_url
                  ? `
                <a href="${escapeHtml(n.pdf_url)}" target="_blank" style="
                  display:inline-flex;align-items:center;gap:6px;
                  margin-top:6px;padding:6px 12px;
                  border-radius:8px;border:1px solid #dbe3ef;
                  background:#f8fafc;color:#1d4ed8;
                  font-size:0.82rem;font-weight:700;text-decoration:none;
                ">
                  👁 View PDF
                </a>
              `
                  : ""
              }
              <div class="notif-item-meta">
                <span>${new Date(n.created_at).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })}</span>
                <span>${escapeHtml(n.target || "students")}</span>
              </div>
            </div>
          `
            )
            .join("");
        });
    }

    function markAllRead() {
      const deptId = localStorage.getItem("deptId") || "";
      if (typeof apiFetch === "undefined") return;
      apiFetch(`/api/notifications/mark-read?role=${role}&userId=${userId}&deptId=${deptId}`, {
        method: "POST"
      }).then(() => {
        updateBadge(0);
        loadNotifications();
      });
    }

    function showToast(title, message) {
      const toast = document.createElement("div");
      toast.style.cssText = `
        position:fixed; bottom:24px; right:24px;
        background:#222; color:#fff; padding:12px 18px;
        border-radius:10px; font-size:13px; z-index:9999;
        max-width:280px; line-height:1.5;
        text-align: left;
      `;
      toast.innerHTML = `<strong>${escapeHtml(title)}</strong><br>${escapeHtml(message)}`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
    }

    function escapeHtml(str) {
      if (str === null || str === undefined) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    // Event listeners
    document.getElementById("notifToggleBtn").addEventListener("click", toggleNotifPanel);
    document.getElementById("markAllReadBtn").addEventListener("click", markAllRead);

    // Initial load from DOMContentLoaded
    window.fetchUnreadCount();

    // Socket Connection
    function initializeSocket() {
      if (!window.io) return;
      const socket = io();
      socket.emit("join_room", role);
      socket.emit("join_user_room", userId);

      const handleNotification = (notif) => {
        unreadCount++;
        updateBadge(unreadCount);
        showToast(notif.title, notif.message);
      };

      socket.on("new_notification", handleNotification);
      socket.on("new notification", handleNotification);
    }

    // Dynamic loading of socket.io if not present
    if (!window.io) {
      const socketScript = document.createElement("script");
      socketScript.src = "/socket.io/socket.io.js";
      socketScript.onload = initializeSocket;
      document.head.appendChild(socketScript);
    } else {
      initializeSocket();
    }
  });
})();
