/**
 * STATE MANAGER - Maneja el estado de Trading Real y Training
 * PHASE 0: Infrastructure for independent trading/training controls
 */

// Extended state object (complementa el state global en renderer.js)
if (!window.quantStateManager) {
  window.quantStateManager = {
    // Estado de Trading Real
    tradingReal: {
      enabled: false,
      lastUpdated: null,
      lastAction: null,
    },

    // Estado de Training
    training: {
      enabled: false,
      lastUpdated: null,
    },

    // Estado del Bot (derivado de trading + training)
    get botState() {
      if (!this.tradingReal.enabled && !this.training.enabled) {
        return 'IDLE';
      }
      if (this.tradingReal.enabled && this.training.enabled) {
        return 'OPERATING';
      }
      if (this.tradingReal.enabled && !this.training.enabled) {
        return 'TRADING';
      }
      if (!this.tradingReal.enabled && this.training.enabled) {
        return 'LEARNING';
      }
      return 'IDLE';
    },

    // Toggle Trading Real
    toggleTradingReal: async (enable) => {
      // Aquí se llamaría al backend real
      // await window.quant.botSetTradingReal(enable);

      window.quantStateManager.tradingReal.enabled = enable;
      window.quantStateManager.tradingReal.lastUpdated = new Date();

      // Despachar evento para que otros módulos se enteren
      window.dispatchEvent(
        new CustomEvent('trading-real-toggled', {
          detail: { enabled: enable },
        })
      );

      console.log(
        '[StateManager] Trading Real toggled:',
        enable ? 'ON' : 'OFF'
      );
    },

    // Toggle Training
    toggleTraining: async (enable) => {
      // Aquí se llamaría al backend real
      // await window.quant.botSetTraining(enable);

      window.quantStateManager.training.enabled = enable;
      window.quantStateManager.training.lastUpdated = new Date();

      // Despachar evento
      window.dispatchEvent(
        new CustomEvent('training-toggled', {
          detail: { enabled: enable },
        })
      );

      console.log('[StateManager] Training toggled:', enable ? 'ON' : 'OFF');
    },

    // Kill Switch - detener todo
    killSwitch: async () => {
      console.warn('[StateManager] KILL SWITCH ACTIVATED');

      // Llamar al backend
      // await window.quant.botKillSwitch();

      window.quantStateManager.tradingReal.enabled = false;
      window.quantStateManager.training.enabled = false;
      window.quantStateManager.tradingReal.lastUpdated = new Date();
      window.quantStateManager.training.lastUpdated = new Date();

      // Despachar evento
      window.dispatchEvent(new CustomEvent('kill-switch-activated'));

      console.log('[StateManager] All operations stopped');
    },

    // Obtener estado actual como objeto
    getState: () => {
      return {
        botState: window.quantStateManager.botState,
        tradingReal: window.quantStateManager.tradingReal.enabled,
        training: window.quantStateManager.training.enabled,
      };
    },

    // Reset para testing
    reset: () => {
      window.quantStateManager.tradingReal.enabled = false;
      window.quantStateManager.training.enabled = false;
      console.log('[StateManager] State reset');
    },
  };
}
