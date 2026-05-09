(function attachTrainingDemoWriterClient(globalScope) {
  function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function readBoolean(value) {
    if (value === true || value === false) return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return null;
  }

  function safeLocalStorageGet(key) {
    try {
      if (globalScope.localStorage && typeof globalScope.localStorage.getItem === 'function') {
        return globalScope.localStorage.getItem(key);
      }
    } catch (_) {}
    return null;
  }

  function shouldAttemptTrainingDemoShadowWrite(config) {
    const source = isObject(config) ? config : {};
    return source.frontendEnabled === true && source.backendEnabled === true;
  }

  function shouldAcceptTrainingDemoAtomicClose(config, response) {
    const source = isObject(config) ? config : {};
    const result = isObject(response) ? response : {};
    return source.frontendEnabled === true
      && source.backendEnabled === true
      && source.atomicPreferred === true
      && result.ok === true;
  }

  function buildTrainingDemoClosedTradePayload(input) {
    const source = isObject(input) ? input : {};
    return {
      openPosition: isObject(source.openPosition) ? { ...source.openPosition } : {},
      exitContext: isObject(source.exitContext) ? { ...source.exitContext } : {},
      signal: isObject(source.signal) ? { ...source.signal } : {},
      options: isObject(source.options) ? { ...source.options } : {}
    };
  }

  function interpretTrainingDemoWriterResponse(response) {
    const source = isObject(response) ? response : {};
    const status = Number(source.status || 0);
    const body = isObject(source.body) ? source.body : {};

    if (status >= 200 && status < 300 && body.ok === true) {
      return { ok: true, fallback: false, reason: 'shadow_write_ok', warning: null, body: body, acceptAtomic: false, mode: 'shadow_only' };
    }
    if (status === 409) {
      return { ok: false, fallback: true, reason: 'disabled', warning: null, acceptAtomic: false, mode: 'fallback_legacy' };
    }
    if (status === 400) {
      return {
        ok: false,
        fallback: true,
        reason: 'invalid_payload',
        warning: 'training-demo-writer invalid payload: ' + String(body.error || 'unknown'),
        acceptAtomic: false,
        mode: 'fallback_legacy'
      };
    }
    return {
      ok: false,
      fallback: true,
      reason: status ? 'http_' + status : 'unknown',
      warning: status ? 'training-demo-writer fallback due to http ' + status : 'training-demo-writer fallback',
      acceptAtomic: false,
      mode: 'fallback_legacy'
    };
  }

  function resolveFrontendShadowFlag() {
    const runtimeConfig = globalScope.quantConfig || {};
    const candidates = [
      runtimeConfig.trainingDemoBackendWriterShadow,
      globalScope.QUANT_TRAINING_DEMO_BACKEND_WRITER_SHADOW,
      safeLocalStorageGet('quant.trainingDemoBackendWriterShadow')
    ];
    for (let index = 0; index < candidates.length; index += 1) {
      const parsed = readBoolean(candidates[index]);
      if (parsed !== null) return parsed;
    }
    return false;
  }

  function resolveFrontendAtomicPreferredFlag() {
    const runtimeConfig = globalScope.quantConfig || {};
    const candidates = [
      runtimeConfig.trainingDemoBackendAtomicPreferred,
      globalScope.QUANT_TRAINING_DEMO_BACKEND_ATOMIC_PREFERRED,
      safeLocalStorageGet('quant.trainingDemoBackendAtomicPreferred')
    ];
    for (let index = 0; index < candidates.length; index += 1) {
      const parsed = readBoolean(candidates[index]);
      if (parsed !== null) return parsed;
    }
    return false;
  }

  function defaultEndpointResolver(path) {
    if (globalScope.quantConfig && typeof globalScope.quantConfig.getEndpoint === 'function') {
      return globalScope.quantConfig.getEndpoint(path);
    }
    return path;
  }

  function createTrainingDemoWriterClient(overrides) {
    const runtime = isObject(overrides) ? overrides : {};
    const fetchImpl = typeof runtime.fetchImpl === 'function' ? runtime.fetchImpl : globalScope.fetch.bind(globalScope);
    const getEndpoint = typeof runtime.getEndpoint === 'function' ? runtime.getEndpoint : defaultEndpointResolver;
    let backendStatusCache = null;

    async function readBackendWriterConfigFromStatus() {
      const frontendEnabled = resolveFrontendShadowFlag();
      const atomicPreferred = resolveFrontendAtomicPreferredFlag();
      try {
        const now = Date.now();
        if (backendStatusCache && now - backendStatusCache.readAt < 15000) {
          return { frontendEnabled: frontendEnabled, backendEnabled: backendStatusCache.backendEnabled, atomicPreferred: atomicPreferred };
        }
        const response = await fetchImpl(getEndpoint('/api/training/core/status'), {
          method: 'GET',
          credentials: 'same-origin'
        });
        const body = await response.json();
        const backendEnabled = !!(response.ok && body && body.core && body.core.backendEnabled === true);
        backendStatusCache = { backendEnabled: backendEnabled, readAt: now };
        return { frontendEnabled: frontendEnabled, backendEnabled: backendEnabled, atomicPreferred: atomicPreferred };
      } catch (_) {
        return { frontendEnabled: frontendEnabled, backendEnabled: false, atomicPreferred: atomicPreferred };
      }
    }

    const getBackendWriterConfig = typeof runtime.getBackendWriterConfig === 'function'
      ? runtime.getBackendWriterConfig
      : readBackendWriterConfigFromStatus;

    async function writeClosedTradeShadow(input) {
      const config = await getBackendWriterConfig();
      if (!shouldAttemptTrainingDemoShadowWrite(config)) {
        return { ok: false, fallback: true, reason: 'not_enabled', warning: null, acceptAtomic: false, mode: 'fallback_legacy' };
      }

      const payload = buildTrainingDemoClosedTradePayload(input);
      try {
        const response = await fetchImpl(getEndpoint('/api/training/demo/closed-trade'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        });
        const body = await response.json();
        const interpreted = interpretTrainingDemoWriterResponse({ status: response.status, body: body });
        interpreted.acceptAtomic = shouldAcceptTrainingDemoAtomicClose(config, interpreted);
        interpreted.mode = interpreted.ok
          ? (interpreted.acceptAtomic ? 'atomic_preferred' : 'shadow_only')
          : 'fallback_legacy';
        interpreted.config = {
          frontendEnabled: config.frontendEnabled === true,
          backendEnabled: config.backendEnabled === true,
          atomicPreferred: config.atomicPreferred === true
        };
        return interpreted;
      } catch (error) {
        return {
          ok: false,
          fallback: true,
          reason: 'network',
          warning: 'training-demo-writer network fallback: ' + String(error && error.message || error),
          acceptAtomic: false,
          mode: 'fallback_legacy'
        };
      }
    }

    async function readTrainingDemoState() {
      try {
        const response = await fetchImpl(getEndpoint('/api/training/demo/state'), {
          method: 'GET',
          credentials: 'same-origin'
        });
        const body = await response.json();
        if (!response.ok || !body || body.ok !== true || body.available !== true || !body.state) {
          return {
            ok: false,
            reason: body?.reason || (response.ok ? 'training_state_unavailable' : `http_${response.status}`),
            warning: 'training-demo-state refresh unavailable'
          };
        }
        return {
          ok: true,
          state: body.state,
          body
        };
      } catch (error) {
        return {
          ok: false,
          reason: 'network',
          warning: 'training-demo-state refresh failed: ' + String(error && error.message || error)
        };
      }
    }

    return {
      writeClosedTradeShadow: writeClosedTradeShadow,
      readTrainingDemoState: readTrainingDemoState
    };
  }

  const api = {
    shouldAttemptTrainingDemoShadowWrite: shouldAttemptTrainingDemoShadowWrite,
    shouldAcceptTrainingDemoAtomicClose: shouldAcceptTrainingDemoAtomicClose,
    buildTrainingDemoClosedTradePayload: buildTrainingDemoClosedTradePayload,
    interpretTrainingDemoWriterResponse: interpretTrainingDemoWriterResponse,
    createTrainingDemoWriterClient: createTrainingDemoWriterClient
  };

  globalScope.QuantTrainingDemoWriter = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
