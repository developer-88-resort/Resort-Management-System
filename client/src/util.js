// Formatting helpers. Money is stored in centavos.
const nf = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const peso = (c) => (c == null ? '-' : nf.format(c / 100));
export const pesoSigned = (c) => (c < 0 ? `(${peso(-c)})` : peso(c));
/** "1,234.50" -> 123450 centavos; returns NaN if invalid. */
export const toCents = (v) => {
  if (v === '' || v == null) return NaN;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
export const centsToInput = (c) => (c == null || Number.isNaN(c) ? '' : (c / 100).toFixed(2));

export const fmtDate = (d) => {
  if (!d) return '-';
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-PH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '-');
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const addDays = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const nights = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) : 0);
export const guestsLabel = (l) => [l.adults && `${l.adults} Ad`, l.children && `${l.children} Ch`, l.seniors && `${l.seniors} Sr`, l.pwd && `${l.pwd} PWD`].filter(Boolean).join(', ') || '-';

/** Maps a status value to a badge tone. */
export function tone(status) {
  const s = String(status || '');
  if (/^Reserved/.test(s)) return 'amber';
  if (/^(Clean|Available|Paid|Closed|Cleared|READY|Checked Out|Refund Completed|Refunded|Settled|Returned)$/i.test(s)) return 'green';
  if (/Dirty|Lost|Under Repair|Blocked|Cancelled|Unpaid|Key out|NOT READY|Balance Due/i.test(s)) return 'red';
  if (/Inspection|Cleaning|Partially|Pending|Settling|Unsettled|Not Ready|Reserved|Advance/i.test(s)) return 'amber';
  if (/Occupied|Checked In|Assigned|Shared|Arrived|Active/i.test(s)) return 'navy';
  return 'grey';
}
