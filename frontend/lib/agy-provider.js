import { execFile, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MIN_AGY_VERSION = [1, 1, 17];
const DEFAULT_AGENT = 'elix-harness-transport';
const DEFAULT_CATALOG_TTL_MS = 15 * 60_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const DEFAULT_INITIALIZATION_TIMEOUT_MS = 45_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_SESSIONS = 8;

let catalogCache = null;
let catalogPromise = null;

function envText(name) {
  return String(process.env[name] || '').trim();
}

function numberEnv(name, fallback) {
  const value = Number(envText(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function agyExecutable() {
  const configured = envText('PARADOX_AGY_EXECUTABLE');
  if (configured) return configured.replace(/^['"]|['"]$/g, '');
  return process.platform === 'win32' ? 'agy.exe' : 'agy';
}

function compareVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = Number(left[index] || 0);
    const b = Number(right[index] || 0);
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

export function parseAgyVersion(value) {
  const match = String(value || '').match(/(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?/i);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function formatAgyVersion(version) {
  return Array.isArray(version) ? version.slice(0, 3).map((part) => Number(part) || 0).join('.') : '';
}

function cleanCommandError(error, fallback) {
  if (error?.code === 'ETIMEDOUT' || error?.killed) {
    return 'AGY command timed out while communicating with the model service.';
  }
  const rawStderr = String(error?.stderr || '').trim();
  const cleanedStderr = rawStderr
    .split(/\r?\n/)
    .filter((line) => !/^(fetching available models|available models|warning:)/i.test(line.trim()))
    .join(' ')
    .trim();
  const message = cleanedStderr || String(error?.stdout || error?.message || fallback || 'AGY command failed.').trim();
  return message.replace(/\s+/g, ' ').slice(0, 700);
}

async function runAgyCommand(args, options = {}) {
  const executable = agyExecutable();
  try {
    const result = await execFileAsync(executable, args, {
      cwd: envText('PARADOX_AGY_CWD') || process.cwd(),
      env: process.env,
      timeout: options.timeout || numberEnv('PARADOX_AGY_COMMAND_TIMEOUT_MS', DEFAULT_COMMAND_TIMEOUT_MS),
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    });
    return { stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const missing = new Error(`AGY_NOT_FOUND: Could not start the native AGY executable (${executable}).`);
      missing.code = 'AGY_NOT_FOUND';
      throw missing;
    }
    const wrapped = new Error(cleanCommandError(error, `AGY command failed: ${args.join(' ')}`));
    wrapped.code = error?.code || 'AGY_COMMAND_FAILED';
    wrapped.cause = error;
    throw wrapped;
  }
}

export function parseAgyModels(value) {
  const models = [];
  const seen = new Set();
  for (const rawLine of String(value || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^(fetching|available models|warning:|error:)/i.test(line)) continue;
    const match = line.match(/^([^\s]+)(?:\t+|\s{2,})(.+)$/);
    const id = String(match?.[1] || '').trim();
    const label = String(match?.[2] || id).trim();
    if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: label || id });
  }
  return models;
}

function catalogTtlMs() {
  return numberEnv('PARADOX_AGY_CATALOG_TTL_MS', DEFAULT_CATALOG_TTL_MS);
}

async function collectAgyStatus() {
  let versionOutput;
  try {
    versionOutput = await runAgyCommand(['--version']);
  } catch (error) {
    return {
      installed: false,
      authenticated: false,
      version: null,
      version_supported: false,
      models: [],
      model: null,
      configured: false,
      configuration_valid: false,
      detail: error?.code === 'AGY_NOT_FOUND' ? error.message : `AGY version check failed: ${error.message}`
    };
  }

  const parsedVersion = parseAgyVersion(versionOutput.stdout || versionOutput.stderr);
  const version = formatAgyVersion(parsedVersion);
  const versionSupported = Boolean(parsedVersion && compareVersions(parsedVersion, MIN_AGY_VERSION) >= 0);
  if (!versionSupported) {
    return {
      installed: true,
      authenticated: false,
      version: version || null,
      version_supported: false,
      models: [],
      model: null,
      configured: false,
      configuration_valid: false,
      detail: `AGY ${version || 'unknown'} is unsupported; version ${formatAgyVersion(MIN_AGY_VERSION)} or newer is required.`
    };
  }

  let modelOutput;
  try {
    modelOutput = await runAgyCommand(['models']);
  } catch (error) {
    if (catalogCache?.value?.models?.length) {
      return {
        ...catalogCache.value,
        detail: null
      };
    }
    return {
      installed: true,
      authenticated: false,
      version,
      version_supported: true,
      models: [],
      model: null,
      configured: false,
      configuration_valid: true,
      detail: `AGY model catalog unavailable: ${error.message}`
    };
  }

  const models = parseAgyModels(modelOutput.stdout);
  const requestedModel = envText('PARADOX_AI_MODEL');
  const model = requestedModel || models[0]?.id || null;
  const modelKnown = !requestedModel || models.some((entry) => entry.id === requestedModel);
  return {
    installed: true,
    authenticated: models.length > 0,
    version,
    version_supported: true,
    models,
    model,
    configured: models.length > 0 && Boolean(model) && modelKnown,
    configuration_valid: modelKnown,
    detail: models.length ? null : 'AGY returned no authenticated models. Sign in with AGY interactively and retry agy models.'
  };
}

export async function getAgyStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && catalogCache && now - catalogCache.time < catalogTtlMs()) return catalogCache.value;
  if (catalogPromise) return catalogPromise;
  catalogPromise = collectAgyStatus()
    .then((value) => {
      catalogCache = { time: Date.now(), value };
      return value;
    })
    .finally(() => { catalogPromise = null; });
  return catalogPromise;
}

async function resolveAgyModel(requestedModel) {
  const status = await getAgyStatus();
  if (!status.installed) {
    const error = new Error(status.detail || 'AGY is not installed.');
    error.code = 'AGY_NOT_FOUND';
    throw error;
  }
  if (!status.version_supported) {
    const error = new Error(status.detail || 'AGY version is unsupported.');
    error.code = 'AGY_VERSION_UNSUPPORTED';
    throw error;
  }
  const requested = String(requestedModel || envText('PARADOX_AI_MODEL') || '').trim();
  if (!status.models.length) {
    if (requested) return requested;
    const error = new Error(status.detail || 'AGY has no authenticated models.');
    error.code = 'AGY_NO_MODELS';
    throw error;
  }
  if (requested) {
    if (!status.models.some((entry) => entry.id === requested)) {
      const error = new Error(`AGY_MODEL_NOT_FOUND: ${requested} is not in the live AGY catalog. Available models: ${status.models.slice(0, 12).map((entry) => entry.id).join(', ')}`);
      error.code = 'AGY_MODEL_NOT_FOUND';
      throw error;
    }
    return requested;
  }
  return status.models[0].id;
}

function normalizeEffort(value) {
  const effort = String(value || '').trim().toLowerCase();
  return ['low', 'medium', 'high'].includes(effort) ? effort : '';
}

function toAgyError(error, context = 'AGY request failed') {
  const message = String(error?.message || error || context).replace(/\s+/g, ' ').slice(0, 1200);
  const wrapped = new Error(message);
  wrapped.code = error?.code || 'AGY_REQUEST_FAILED';
  wrapped.cause = error;
  return wrapped;
}

export class AgySession {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.cwd = options.cwd || envText('PARADOX_AGY_CWD') || process.cwd();
    this.attachmentDirs = [...new Set((options.attachmentDirs || []).filter(Boolean).map(String))];
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
    this.child = null;
    this.buffer = '';
    this.pending = null;
    this.startPromise = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.closePromise = null;
    this.closed = false;
    this.lastStderr = '';
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#start();
    try {
      return await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      throw toAgyError(error, 'Unable to start AGY.');
    }
  }

  async #start() {
    const model = await resolveAgyModel(this.config.model);
    this.config.model = model;
    const args = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--model', model,
      '--agent', envText('PARADOX_AGY_AGENT') || DEFAULT_AGENT,
      '--sandbox',
      '--disable-slash-commands',
      '--print-timeout', `${Math.ceil(numberEnv('PARADOX_AGY_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS) / 1000)}s`
    ];
    const hasEffortInModel = /-(?:high|medium|low)$/i.test(model);
    const effort = hasEffortInModel ? '' : normalizeEffort(this.config.reasoning_effort || envText('PARADOX_AI_REASONING_EFFORT'));
    if (effort) args.push('--effort', effort);
    for (const directory of this.attachmentDirs) args.push('--add-dir', directory);

    this.child = spawn(agyExecutable(), args, {
      cwd: this.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.closed = false;
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.closePromise = new Promise((resolve) => {
      this._resolveClose = resolve;
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.#consume(chunk));
    this.child.stderr.on('data', (chunk) => {
      this.lastStderr = `${this.lastStderr}${chunk}`.slice(-2000);
    });
    this.child.once('error', (error) => this.#fail(error));
    this.child.once('close', (code, signal) => {
      this.closed = true;
      const detail = this.lastStderr.trim();
      const error = code === 0
        ? new Error('AGY process closed before the request completed.')
        : new Error(`AGY process exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}${detail ? `: ${detail}` : '.'}`);
      if (this.readyReject) this.readyReject(error);
      if (this.pending) this.#settlePending(error);
      this._resolveClose?.();
    });

    const timeout = setTimeout(() => {
      const error = new Error('AGY initialization timed out.');
      error.code = 'AGY_INITIALIZATION_TIMEOUT';
      this.#fail(error);
    }, numberEnv('PARADOX_AGY_INITIALIZATION_TIMEOUT_MS', DEFAULT_INITIALIZATION_TIMEOUT_MS));
    try {
      await this.readyPromise;
    } finally {
      clearTimeout(timeout);
    }
    return this;
  }

  #consume(chunk) {
    // console.log('[AGY RAW CHUNK]', chunk);
    this.buffer += String(chunk || '');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      const raw = line.trim();
      if (!raw) continue;
      let event;
      try { event = JSON.parse(raw); } catch { continue; }
      try { this.onEvent?.(event); } catch {}
      if (event.event === 'step_update' && this.pending && event.step_update?.step_type === 'agent_response') {
        this.pending.text += String(event.step_update.text_delta || '');
      }
      try { this.pending?.onEvent?.(event); } catch {}
      if (event.event === 'init') {
        this.readyResolve?.(this);
        this.readyResolve = null;
        this.readyReject = null;
        continue;
      }
      if (event.event === 'error' && !this.pending) {
        this.#fail(new Error(event.error || event.message || 'AGY returned an error.'));
        continue;
      }
      if (event.event !== 'result' || !this.pending) continue;
      const result = event.result || {};
      if (String(result.status || '').toUpperCase() === 'ERROR' || result.error) {
        this.#settlePending(new Error(result.error || 'AGY returned an error.'));
      } else {
        const response = String(result.response || this.pending.text || '').trim();
        this.#settlePending(null, response);
      }
    }
  }

  #fail(error) {
    const wrapped = toAgyError(error);
    // A fatal startup/transport error leaves the session unusable. Mark it
    // closed and terminate the child here so the pool cannot retain a broken
    // process (or leave an orphan behind after an initialization timeout).
    this.closed = true;
    this.readyReject?.(wrapped);
    this.readyResolve = null;
    this.readyReject = null;
    if (this.pending) this.#settlePending(wrapped);
    try { this.child?.kill(); } catch {}
  }

  #settlePending(error, response = '') {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    if (error) pending.reject(toAgyError(error));
    else pending.resolve(response);
  }

  async send(prompt, onEvent = null) {
    await this.start();
    if (this.closed || !this.child?.stdin?.writable) throw new Error('AGY process is unavailable.');
    if (this.pending) throw new Error('AGY session is already handling a request.');
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error('AGY request timed out.');
        error.code = 'AGY_REQUEST_TIMEOUT';
        this.#settlePending(error);
        this.child?.kill();
      }, numberEnv('PARADOX_AGY_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS));
      this.pending = { resolve, reject, text: '', timer: timeout, onEvent };
      const message = JSON.stringify({ event: 'user', message: { role: 'user', content: String(prompt || '') } });
      this.child.stdin.write(`${message}\n`, (error) => {
        if (error) this.#settlePending(error);
      });
    });
  }

  async close() {
    if (!this.child || this.closed) return;
    this.closed = true;
    this.#settlePending(new Error('AGY session closed.'));
    try { this.child.stdin.end(); } catch {}
    const timeout = setTimeout(() => {
      try { this.child.kill(); } catch {}
      this._resolveClose?.();
    }, numberEnv('PARADOX_AGY_SHUTDOWN_TIMEOUT_MS', DEFAULT_SHUTDOWN_TIMEOUT_MS));
    try { await this.closePromise; } finally { clearTimeout(timeout); }
  }
}

export function normalizeAgySessionId(value) {
  const sessionId = String(value || '').trim();
  if (!sessionId) return '';
  if (sessionId.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(sessionId)) {
    const error = new Error('AGY session id is invalid.');
    error.code = 'AGY_SESSION_INVALID';
    throw error;
  }
  return sessionId;
}

function sessionFingerprint(config = {}, options = {}) {
  return JSON.stringify({
    model: String(config.model || envText('PARADOX_AI_MODEL') || ''),
    effort: normalizeEffort(config.reasoning_effort || envText('PARADOX_AI_REASONING_EFFORT')),
    cwd: String(options.cwd || envText('PARADOX_AGY_CWD') || process.cwd()),
    agent: envText('PARADOX_AGY_AGENT') || DEFAULT_AGENT,
    attachmentDirs: [...new Set((options.attachmentDirs || []).filter(Boolean).map(String))].sort()
  });
}

export class AgySessionPool {
  constructor(options = {}) {
    this.createSession = options.createSession || ((config, sessionOptions) => new AgySession(config, sessionOptions));
    this.idleTimeoutMs = Number(options.idleTimeoutMs) > 0
      ? Number(options.idleTimeoutMs)
      : numberEnv('PARADOX_AGY_SESSION_IDLE_TIMEOUT_MS', DEFAULT_SESSION_IDLE_TIMEOUT_MS);
    this.maxSessions = Number(options.maxSessions) > 0
      ? Math.floor(Number(options.maxSessions))
      : Math.floor(numberEnv('PARADOX_AGY_MAX_SESSIONS', DEFAULT_MAX_SESSIONS));
    this.entries = new Map();
  }

  get size() {
    return this.entries.size;
  }

  #entryKey(sessionId, config, options) {
    return `${normalizeAgySessionId(sessionId)}\u0000${sessionFingerprint(config, options)}`;
  }

  #clearIdleTimer(entry) {
    if (!entry?.idleTimer) return;
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }

  async #closeEntry(key, entry) {
    if (!entry || this.entries.get(key) !== entry) return;
    this.#clearIdleTimer(entry);
    this.entries.delete(key);
    await entry.session.close().catch(() => {});
  }

  #scheduleIdleClose(key, entry) {
    this.#clearIdleTimer(entry);
    if (entry.active || entry.waiters > 0 || this.entries.get(key) !== entry) return;
    entry.idleTimer = setTimeout(() => {
      if (!entry.active && entry.waiters === 0) void this.#closeEntry(key, entry);
    }, this.idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  async #pruneIdleEntries() {
    if (this.entries.size < this.maxSessions) return;
    const candidates = [...this.entries.entries()]
      .filter(([, entry]) => !entry.active && entry.waiters === 0)
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
    while (this.entries.size >= this.maxSessions && candidates.length) {
      const [key, entry] = candidates.shift();
      await this.#closeEntry(key, entry);
    }
  }

  async acquire(sessionId, config = {}, options = {}) {
    const normalizedId = normalizeAgySessionId(sessionId);
    if (!normalizedId) return null;
    const key = this.#entryKey(normalizedId, config, options);
    let entry = this.entries.get(key);
    if (!entry) {
      await this.#pruneIdleEntries();
      entry = {
        session: this.createSession({ ...config }, options),
        tail: Promise.resolve(),
        active: false,
        waiters: 0,
        lastUsed: Date.now(),
        idleTimer: null
      };
      this.entries.set(key, entry);
    }

    this.#clearIdleTimer(entry);
    entry.waiters += 1;
    const previous = entry.tail.catch(() => {});
    let releaseTurn;
    const turn = new Promise((resolve) => { releaseTurn = resolve; });
    entry.tail = previous.then(() => turn);
    await previous;
    entry.waiters -= 1;
    entry.active = true;
    this.#clearIdleTimer(entry);

    if (entry.session.closed) entry.session = this.createSession({ ...config }, options);
    let released = false;
    return {
      session: entry.session,
      release: async () => {
        if (released) return;
        released = true;
        entry.active = false;
        entry.lastUsed = Date.now();
        releaseTurn();
        this.#scheduleIdleClose(key, entry);
      }
    };
  }

  async closeAll() {
    const entries = [...this.entries.entries()];
    this.entries.clear();
    await Promise.all(entries.map(async ([, entry]) => {
      this.#clearIdleTimer(entry);
      await entry.session.close().catch(() => {});
    }));
  }
}

const sharedAgySessions = new AgySessionPool();

export function acquireAgySession(sessionId, config = {}, options = {}) {
  return sharedAgySessions.acquire(sessionId, config, options);
}

export function closeAllAgySessions() {
  return sharedAgySessions.closeAll();
}

export async function withAgyAttachments(attachments, callback) {
  const list = Array.isArray(attachments) ? attachments.filter((item) => item?.buffer?.length) : [];
  if (!list.length) return callback([], null);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paradox-agy-'));
  const paths = [];
  try {
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      const base = String(item.filename || `attachment-${index + 1}`).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-100) || `attachment-${index + 1}`;
      const filename = `${String(index + 1).padStart(2, '0')}-${base}`;
      const filePath = path.join(directory, filename);
      await fs.writeFile(filePath, item.buffer);
      paths.push({ path: filePath, filename: item.filename || filename, mimeType: item.mimeType || 'application/octet-stream' });
    }
    return await callback(paths, directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function serverAgyProviderStatus(options = {}) {
  return getAgyStatus(options);
}

export function agyDefaultModel() {
  return envText('PARADOX_AI_MODEL');
}
