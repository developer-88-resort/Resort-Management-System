// Thin API client. All money values are integer centavos on the wire.
const KEY = 'irms.token';
export const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* ignore */ } };

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.body = body || {};
    this.failures = body?.failures || [];
    this.needsApproval = !!body?.needsApproval;
  }
}

async function request(method, url, body) {
  const t = getToken();
  const res = await fetch(`/api${url}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && url !== '/auth/login') {
    setToken(null);
    window.dispatchEvent(new Event('irms:logout'));
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  put: (u, b = {}) => request('PUT', u, b),
};

/** Fetch a restricted attachment with auth and return an object URL. */
export async function attachmentUrl(id) {
  const res = await fetch(`/api/attachments/${id}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error('Cannot open attachment');
  return URL.createObjectURL(await res.blob());
}

export function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ filename: file.name, mime: file.type, data: r.result });
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
