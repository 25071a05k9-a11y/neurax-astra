/**
 * Compatibility helpers for older imports.
 * CSV ownership now lives in the FastAPI production store.  These functions
 * proxy to that backend and never resolve machine-local paths or fabricate rows.
 */
const BACKEND_URL = process.env.ASTRA_BACKEND_URL || 'http://127.0.0.1:5000';

async function backendJson(path) {
  const response = await fetch(`${BACKEND_URL}${path}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.detail;
    throw new Error((typeof detail === 'object' ? detail?.message : detail) || payload?.error || `Backend request failed (${response.status})`);
  }
  return payload;
}

export async function listCsvFiles() {
  const payload = await backendJson('/api/csv/files');
  return payload.files || [];
}

export async function readCsvFile(fileName, options = {}) {
  if (!fileName) throw new Error('fileName is required');
  const params = new URLSearchParams({ file: fileName });
  if (options.limit != null) params.set('limit', String(options.limit));
  if (options.offset != null) params.set('offset', String(options.offset));
  return backendJson(`/api/csv/data?${params.toString()}`);
}
