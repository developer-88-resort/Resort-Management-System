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
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status !== 401 && !url.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('irms:toast', { detail: { type: 'error', message: err.message, details: err.failures } }));
    throw err;
  }
  if (method !== 'GET') {
    const msg = successMessage(method, url, data);
    if (msg) window.dispatchEvent(new CustomEvent('irms:toast', { detail: { type: 'success', message: msg } }));
  }
  return data;
}

/** Plain-language confirmation of what was saved. */
function successMessage(method, url, data) {
  const path = url.split('?')[0];
  if (path.startsWith('/auth/') || path.endsWith('/print')) return null;
  const receipt = data?.payment?.receipt ? ` ${data.payment.receipt.doc_type} ${data.payment.receipt.receipt_no} issued.` : '';
  const rules = [
    [/^\/reservations$/, 'Reservation saved. The room(s) are now blocked.'],
    [/^\/reservations\/opening$/, 'Opening record saved.'],
    [/^\/reservations\/\d+$/, 'Reservation updated.'],
    [/\/lines\/\d+\/transfer$/, 'Room transfer confirmed.'],
    [/^\/reservations\/\d+\/checkin$/, 'Check-in confirmed. Keys may be released.'],
    [/^\/reservations\/\d+\/checkout$/, 'Check-out complete. Room(s) set to Dirty.'],
    [/^\/daytour\/groups\/\d+\/checkout$/, 'Group checked out.'],
    [/\/payments$/, `Payment recorded.${receipt}`],
    [/\/cancel$/, 'Cancelled. History is kept.'],
    [/\/refund-decision$/, 'Refund decision recorded.'],
    [/\/credit-refund$/, 'Credit returned to the guest.'],
    [/\/charges\/\d+\/void$|\/transactions\/\d+\/void$/, 'Reversal posted. The original stays on record.'],
    [/\/charges$/, 'Charge added to the folio.'],
    [/\/discounts$/, 'Discount added.'],
    [/\/id-verify$/, 'ID verification saved.'],
    [/\/signed-form$/, 'Signed registration form recorded.'],
    [/\/hk-confirm$/, 'Housekeeping confirmation updated.'],
    [/\/arrived$/, 'Guest status updated (Check-in Pending).'],
    [/\/follow-up$/, 'Follow-up logged.'],
    [/^\/approvals$/, data?.approval?.status === 'Approved' ? 'Approved.' : 'Approval requested. Waiting for the supervisor.'],
    [/\/approve$/, 'Request approved.'],
    [/\/reject$/, 'Request rejected.'],
    [/\/hk-status$/, 'Room status updated.'],
    [/\/defects\/\d+\/resolve$/, 'Defect resolved.'],
    [/\/defects$/, 'Defect reported.'],
    [/\/block$/, 'Room blocked.'],
    [/\/release$/, 'Released back to service.'],
    [/^\/daytour\/groups$/, 'Day Tour group saved.'],
    [/^\/daytour\/opening$/, 'Day Tour opening record saved.'],
    [/\/counts$/, 'Guest counts saved.'],
    [/\/facilities$/, 'Facility charge added.'],
    [/\/entry-exception$/, 'Advance-group terms approved.'],
    [/\/start-settlement$/, 'Settlement started.'],
    [/\/groups\/\d+\/lockers$/, 'Locker assigned.'],
    [/\/return-key$/, 'Key return recorded.'],
    [/\/lost-key$/, 'Lost key recorded. Penalty added.'],
    [/\/locker-accounts\/\d+\/transfer$/, 'Guest moved to the new locker. Charges moved with the account.'],
    [/^\/department\/transactions$/, data?.duplicate ? 'Already posted. No duplicate was created.' : data?.transaction?.method === 'charge' ? `Charge ${data.transaction.source_txn_id} posted.` : `Sale ${data?.transaction?.source_txn_id || ''} recorded.`],
    [/\/attachment$/, 'Attachment saved.'],
    [/^\/reports\/reconciliation$/, 'Reconciliation saved.'],
  ];
  for (const [re, msg] of rules) if (re.test(path)) return msg;
  return 'Saved.';
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
