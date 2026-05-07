/**
 * Configuration Module - Environment-aware API Base URL
 * PHASE 2: Multi-environment support (local, VPS, production)
 */

if (!window.quantConfig) {
  const runtimeEnv = typeof process !== 'undefined' ? process.env || {} : {};
  const isHttpRuntime = /^https?:$/i.test(window.location.protocol || '');
  const sameOriginApiBase = isHttpRuntime ? window.location.origin : 'http://127.0.0.1:47829';

  window.quantConfig = {
    // Detect environment from various sources
    environment: (() => {
      // 1. Check URL parameter: ?env=vps or ?env=local
      const params = new URLSearchParams(window.location.search);
      const envParam = params.get('env');
      if (envParam && ['local', 'vps', 'production'].includes(envParam)) {
        return envParam;
      }

      // 2. Check localStorage for saved preference
      const savedEnv = localStorage.getItem('quantEnv');
      if (savedEnv && ['local', 'vps', 'production'].includes(savedEnv)) {
        return savedEnv;
      }

      // 3. Check window variable (set by Electron preload or HTML)
      if (window.QUANT_ENV && ['local', 'vps', 'production'].includes(window.QUANT_ENV)) {
        return window.QUANT_ENV;
      }

      // 4. Check NODE_ENV or default to local for development
      if (runtimeEnv.NODE_ENV === 'production') {
        return 'production';
      }

      // Default: local
      return 'local';
    })(),

    // Environment configurations
    environments: {
      local: {
        apiBaseUrl: sameOriginApiBase,
        description: 'Local development server'
      },
      vps: {
        apiBaseUrl: runtimeEnv.QUANT_VPS_URL || sameOriginApiBase,
        description: 'Remote VPS server'
      },
      production: {
        apiBaseUrl: runtimeEnv.QUANT_PROD_URL || sameOriginApiBase,
        description: 'Production server (https)'
      }
    },

    // Get current API base URL
    get apiBaseUrl() {
      const env = this.environment;
      const config = this.environments[env];
      if (!config) {
        console.warn(`[Config] Unknown environment: ${env}, falling back to local`);
        return this.environments.local.apiBaseUrl;
      }
      return config.apiBaseUrl;
    },

    // Set environment programmatically
    setEnvironment: (env) => {
      if (!['local', 'vps', 'production'].includes(env)) {
        console.error(`[Config] Invalid environment: ${env}`);
        return false;
      }
      window.quantConfig.environment = env;
      localStorage.setItem('quantEnv', env);
      console.log(`[Config] Environment set to: ${env}`);
      return true;
    },

    // Set custom API URL for VPS or custom deployments
    setCustomApiUrl: (env, url) => {
      if (!window.quantConfig.environments[env]) {
        console.error(`[Config] Unknown environment: ${env}`);
        return false;
      }
      window.quantConfig.environments[env].apiBaseUrl = url;
      console.log(`[Config] Custom API URL for ${env}: ${url}`);
      return true;
    },

    // Get full endpoint URL (appends path to base)
    getEndpoint: (path) => {
      const base = window.quantConfig.apiBaseUrl;
      // Ensure no double slashes
      const cleanPath = path.startsWith('/') ? path : `/${path}`;
      return `${base}${cleanPath}`;
    },

    // Logging and debugging
    getStatus: () => {
      return {
        environment: window.quantConfig.environment,
        apiBaseUrl: window.quantConfig.apiBaseUrl,
        description: window.quantConfig.environments[window.quantConfig.environment]?.description || 'Unknown'
      };
    },

    // Log configuration status to console
    logStatus: () => {
      const status = window.quantConfig.getStatus();
      console.group('[Config] Current Configuration');
      console.log('Environment:', status.environment);
      console.log('API Base URL:', status.apiBaseUrl);
      console.log('Description:', status.description);
      console.groupEnd();
    }
  };

  // Initialize on load
  console.log('[Config] Initialized - Environment:', window.quantConfig.environment);
}
