/**
 * STATE MANAGER - Maneja el estado de Trading Real y Training
 * PHASE 0: Infrastructure for independent trading/training controls
 */

// Extended state object (complementa el state global en renderer.js)
if (!window.quantStateManager) {
  window.quantStateManager = {
    killSwitch: {
      enabled: false,
      lastUpdated: null,
    },

    // Estado de Trading Real
    tradingReal: {
      enabled: false,
      lastUpdated: null,
      lastAction: null,
    },

    // Estado de Training
    training: {
      enabled: true,
      lastUpdated: new Date(),
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
      // Training is a perpetual learning loop. Real trading can be disabled,
      // but the learning engine should not be turned off from the UI.
      const nextEnabled = true;

      window.quantStateManager.training.enabled = nextEnabled;
      window.quantStateManager.training.lastUpdated = new Date();

      // Despachar evento
      window.dispatchEvent(
        new CustomEvent('training-toggled', {
          detail: { enabled: nextEnabled },
        })
      );

      console.log('[StateManager] Training perpetual:', nextEnabled ? 'ON' : 'OFF');
    },

    setKillSwitch: async (enable) => {
      const nextEnabled = Boolean(enable);
      console.warn(
        `[StateManager] KILL SWITCH ${nextEnabled ? 'ACTIVATED' : 'DEACTIVATED'}`
      );

      window.quantStateManager.killSwitch.enabled = nextEnabled;
      window.quantStateManager.killSwitch.lastUpdated = new Date();

      if (nextEnabled) {
        window.quantStateManager.tradingReal.enabled = false;
        window.quantStateManager.tradingReal.lastUpdated = new Date();
      }

      window.dispatchEvent(
        new CustomEvent('kill-switch-toggled', {
          detail: { enabled: nextEnabled },
        })
      );

      if (nextEnabled) {
        window.dispatchEvent(new CustomEvent('kill-switch-activated'));
      }

      console.log(
        '[StateManager] Real trading stopped, training preserved:',
        window.quantStateManager.training.enabled ? 'ON' : 'OFF'
      );
    },

    // Obtener estado actual como objeto
    getState: () => {
      return {
        botState: window.quantStateManager.botState,
        tradingReal: window.quantStateManager.tradingReal.enabled,
        training: window.quantStateManager.training.enabled,
        killSwitch: window.quantStateManager.killSwitch.enabled,
      };
    },

    // Reset para testing
    reset: () => {
      window.quantStateManager.tradingReal.enabled = false;
      window.quantStateManager.training.enabled = true;
      window.quantStateManager.killSwitch.enabled = false;
      console.log('[StateManager] State reset');
    },
  };
}
