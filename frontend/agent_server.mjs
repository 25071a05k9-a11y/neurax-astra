import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeEvidence, chatAgent, serverProviderHealth } from './lib/agent-core.js';
import { getAgyStatus } from './lib/agy-provider.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(__filename);

// Load .env file
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') console.warn('Could not load .env file:', error.message);
}

const PORT = Number.parseInt(process.env.PORT || '8000', 10);
const HOST = '127.0.0.1';
const DETERMINISTIC_BACKEND_URL = process.env.ASTRA_DETERMINISTIC_BACKEND_URL || 'http://127.0.0.1:5000';

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message, status: 'error' });
}

function startEventStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(': connected\n\n');
  return (event) => {
    if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function proxyToDeterministicBackend(req, res, pathname, search) {
  const targetUrl = new URL(`${pathname}${search}`, DETERMINISTIC_BACKEND_URL);
  
  const headers = { ...req.headers };
  delete headers.host;

  const clientReq = http.request(targetUrl, {
    method: req.method,
    headers
  }, (clientRes) => {
    const responseHeaders = {
      ...clientRes.headers,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS, PUT, DELETE',
      'access-control-allow-headers': 'Content-Type, Authorization, X-Requested-With'
    };
    res.writeHead(clientRes.statusCode, responseHeaders);
    clientRes.pipe(res);
  });

  clientReq.on('error', (err) => {
    console.error(`[PROXY ERROR] Failed to proxy to ${targetUrl}:`, err.message);
    sendError(res, 502, `Deterministic backend unreachable on ${DETERMINISTIC_BACKEND_URL}: ${err.message}`);
  });

  req.pipe(clientReq);
}

async function handleRequest(req, res) {
  // Enable CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const pathname = parsedUrl.pathname;

  try {
    // 1. Health Endpoint (System Observability)
    if (pathname === '/api/health' && req.method === 'GET') {
      const serverAi = await serverProviderHealth();
      const agy = serverAi.agy || {};
      
      // Probe deterministic backend health
      let deterministicHealthy = false;
      try {
        const detRes = await fetch(`${DETERMINISTIC_BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
        deterministicHealthy = detRes.ok;
      } catch {}

      sendJson(res, 200, {
        status: 'healthy',
        inspection: deterministicHealthy ? 'ready' : 'degraded',
        production: deterministicHealthy ? 'ready' : 'degraded',
        agentic_reasoning: agy.installed && agy.authenticated ? 'ready' : 'unavailable',
        provider: 'agy',
        model: agy.model || null,
        native_agy_installed: Boolean(agy.installed),
        native_agy_authenticated: Boolean(agy.authenticated),
        native_agy_version: agy.version || null,
        models_available: agy.models || [],
        timestamp: new Date().toISOString()
      });
      return;
    }

    // 2. AGY Available Models Endpoint
    if (pathname === '/api/agent/models' && req.method === 'GET') {
      const status = await getAgyStatus();
      sendJson(res, 200, {
        models: status.models || [],
        current: status.model || null,
        installed: status.installed,
        authenticated: status.authenticated
      });
      return;
    }

    // 3. AGY Detailed Provider Health
    if (pathname === '/api/agent/health' && req.method === 'GET') {
      const health = await serverProviderHealth();
      sendJson(res, 200, health);
      return;
    }

    // 4. Real streaming agent conversation. Status and verified content events are
    // emitted immediately; no hidden reasoning is exposed.
    if (pathname === '/api/agent/chat/stream' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const message = String(body.message || '').trim();
      const image_b64 = body.image_b64 || body.image || '';
      if (!message && !image_b64) {
        sendError(res, 400, 'Message or image field is required.');
        return;
      }
      const sendEvent = startEventStream(res);
      try {
        const aiModel = body.ai_model || body.aiModel || body.config?.model || (typeof body.model === 'string' && body.model.includes('-') ? body.model : null);
        const facilityId = body.facility_id || (typeof body.model === 'number' ? body.model : 2);
        const result = await chatAgent({
          message,
          image_b64,
          filename: body.filename || '',
          config: { ...(body.config || {}), ...(aiModel ? { model: aiModel } : {}) },
          context: {
            facility: body.facility || `Model ${facilityId}`,
            model: Number(facilityId), scenario: body.scenario || '', defect: body.defect || '',
            station: body.station || '', inspection_batch_id: body.inspection_batch_id || body.inspectionBatchId || null
          },
          sessionId: body.session_id || body.sessionId || '',
          onEvent: sendEvent
        });
        sendEvent({ type: 'result', result });
        sendEvent({ type: 'complete' });
      } catch (error) {
        sendEvent({ type: 'error', error: error.message || 'Agent request failed.' });
      } finally {
        res.end();
      }
      return;
    }

    // 4. Agent Conversation Endpoint
    if (pathname === '/api/agent/chat' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const message = String(body.message || '').trim();
      const image_b64 = body.image_b64 || body.image || '';
      const filename = body.filename || '';
      if (!message && !image_b64) {
        sendError(res, 400, 'Message or image field is required.');
        return;
      }

      const aiModel = body.ai_model || body.aiModel || body.config?.model || (typeof body.model === 'string' && body.model.includes('-') ? body.model : null);
      const facilityId = body.facility_id || (typeof body.model === 'number' ? body.model : 2);
      const result = await chatAgent({
        message,
        image_b64,
        filename,
        config: {
          ...(body.config || {}),
          ...(aiModel ? { model: aiModel } : {})
        },
        context: {
          facility: body.facility || `Model ${facilityId}`,
          model: Number(facilityId),
          scenario: body.scenario || '',
          defect: body.defect || '',
          station: body.station || '',
          inspection_batch_id: body.inspection_batch_id || body.inspectionBatchId || null
        },
        sessionId: body.session_id || body.sessionId || ''
      });

      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/agent/analyze/stream' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const model = Number(body.model || body.facility_id);
      const scenarioId = String(body.scenario_id || body.scenario || '').trim();
      if (![1, 2, 3].includes(model) || !scenarioId) {
        sendError(res, 400, 'model (1-3) and scenario_id are required.');
        return;
      }
      const sendEvent = startEventStream(res);
      try {
        const result = await analyzeEvidence({
          model,
          scenarioId,
          inspectionBatchId: body.inspection_batch_id || body.inspectionBatchId || null,
          config: { ...(body.config || {}), ...(body.ai_model || body.aiModel ? { model: body.ai_model || body.aiModel } : {}) },
          sessionId: body.session_id || body.sessionId || '',
          onEvent: sendEvent
        });
        sendEvent({ type: 'result', result });
        sendEvent({ type: 'complete' });
      } catch (error) {
        sendEvent({ type: 'error', error: error.message || 'Automatic analysis failed.' });
      } finally {
        res.end();
      }
      return;
    }

    // 4b. Automatic evidence analysis. Deterministic services build the case first;
    // AGY only explains that verified evidence package.
    if (pathname === '/api/agent/analyze' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const model = Number(body.model || body.facility_id);
      const scenarioId = String(body.scenario_id || body.scenario || '').trim();
      if (![1, 2, 3].includes(model) || !scenarioId) {
        sendError(res, 400, 'model (1-3) and scenario_id are required.');
        return;
      }
      const result = await analyzeEvidence({
        model,
        scenarioId,
        inspectionBatchId: body.inspection_batch_id || body.inspectionBatchId || null,
        config: {
          ...(body.config || {}),
          ...(body.ai_model || body.aiModel ? { model: body.ai_model || body.aiModel } : {})
        },
        sessionId: body.session_id || body.sessionId || ''
      });
      sendJson(res, 200, result);
      return;
    }

    // 7. Route other /api/* calls to the deterministic Python backend
    if (pathname.startsWith('/api/')) {
      await proxyToDeterministicBackend(req, res, pathname, parsedUrl.search);
      return;
    }

    // Not found
    sendError(res, 404, `Endpoint ${pathname} not found.`);
  } catch (error) {
    console.error('[SERVER ERROR]', error);
    sendError(res, 500, error.message || 'Internal server error');
  }
}

const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log(`=============================================================`);
  console.log(`[ASTRA AGENT SERVER] Running at http://${HOST}:${PORT}`);
  console.log(`[ASTRA AGENT SERVER] Proxying deterministic APIs to ${DETERMINISTIC_BACKEND_URL}`);
  console.log(`[ASTRA AGENT SERVER] AI Provider: Native Google Antigravity CLI (agy)`);
  console.log(`=============================================================`);
});
