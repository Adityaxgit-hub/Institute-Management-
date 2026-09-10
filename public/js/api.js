let cachedCsrfToken = null;

async function getCsrfToken() {
  if (cachedCsrfToken) return cachedCsrfToken;
  const res = await fetch("/csrf-token");
  const data = await res.json();
  cachedCsrfToken = data.csrfToken;
  return cachedCsrfToken;
}

async function apiFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const needsCsrf = ["POST", "PUT", "DELETE", "PATCH"].includes(method);

  const headers = { ...(options.headers || {}) };

  if (needsCsrf) {
    headers["CSRF-Token"] = await getCsrfToken();
  }

  const res = await fetch(url, { ...options, headers });

  // If the token was stale/expired, refresh once and retry
  if (res.status === 403 && needsCsrf) {
    cachedCsrfToken = null;
    headers["CSRF-Token"] = await getCsrfToken();
    return fetch(url, { ...options, headers });
  }

  return res;
}