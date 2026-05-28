/**
 * HERO CONTROLLER - Maneja el Bot State Hero Section UI
 * PHASE 0: Interactive hero section with state displays and controls
 */

if (!window.heroController) {
  window.heroController = {
    // Cache de elementos
    elements: {
      botStateMode: null,
      tradingRealStatus: null,
      tradingRealDot: null,
      tradingRealToggle: null,
      trainingStatus: null,
      trainingDot: null,
      trainingToggle: null,
      botStatePnl: null,
      botStatePnlPct: null,
      botStateLastAction: null,
      confidenceFill: null,
      confidenceText: null,
      pauseTradingBtn: null,
      killSwitchBtn: null,
      killSwitchConfirm: null,
    },

    // Inicializar elementos
    init: () => {
      const el = window.heroController.elements;

      // Get elements
      el.botStateMode = document.getElementById('botStateMode');
      el.tradingRealStatus = document.getElementById('tradingRealStatus');
      el.tradingRealDot = document.getElementById('tradingRealDot');
      el.tradingRealToggle = document.getElementById('tradingRealToggle');
      el.trainingStatus = document.getElementById('trainingStatus');
      el.trainingDot = document.getElementById('trainingDot');
      el.trainingToggle = document.getElementById('trainingToggle');
      el.botStatePnl = document.getElementById('botStatePnl');
      el.botStatePnlPct = document.getElementById('botStatePnlPct');
      el.botStateLastAction = document.getElementById('botStateLastAction');
      el.confidenceFill = document.getElementById('confidenceFill');
      el.confidenceText = document.getElementById('confidenceText');
      el.pauseTradingBtn = document.getElementById('pauseTradingBtn');
      el.killSwitchBtn = document.getElementById('killSwitchBtn');
      el.killSwitchConfirm = document.getElementById('killSwitchConfirm');

      // Setup event listeners
      window.heroController.setupListeners();

      // Listen for state changes
      window.addEventListener('trading-real-toggled', (e) => {
        window.heroController.updateUI();
      });
      window.addEventListener('training-toggled', (e) => {
        window.heroController.updateUI();
      });
      window.addEventListener('kill-switch-toggled', (e) => {
        window.heroController.updateUI();
      });
      window.addEventListener('kill-switch-activated', (e) => {
        window.heroController.updateUI();
      });

      console.log('[HeroController] Initialized');
    },

    // Setup event listeners
    setupListeners: () => {
      const el = window.heroController.elements;

      // Trading Real toggle
      if (el.tradingRealToggle) {
        el.tradingRealToggle.addEventListener('click', async () => {
          const current = window.quantStateManager.tradingReal.enabled;
          await window.quantStateManager.toggleTradingReal(!current);
          window.heroController.updateUI();
        });
      }

      // Training is perpetual. There is intentionally no UI listener that can
      // disable the learning loop.

      // Pause Trading button
      if (el.pauseTradingBtn) {
        el.pauseTradingBtn.addEventListener('click', async () => {
          if (window.quantStateManager.tradingReal.enabled) {
            await window.quantStateManager.toggleTradingReal(false);
            window.heroController.updateUI();
          }
        });
      }

      // Kill Switch button
      if (el.killSwitchBtn) {
        el.killSwitchBtn.addEventListener('click', async () => {
          if (window.quantStateManager.killSwitch.enabled) {
            await window.quantStateManager.setKillSwitch(false);
            window.heroController.updateUI();
            return;
          }
          window.heroController.showKillSwitchConfirm();
        });
      }
    },

    // Update UI based on current state
    updateUI: () => {
      const el = window.heroController.elements;
      const state = window.quantStateManager.getState();

      // Update mode display
      if (el.botStateMode) {
        el.botStateMode.textContent = state.botState;
        el.botStateMode.className = 'state-value ' + state.botState.toLowerCase();
      }

      // Update Trading Real display
      if (el.tradingRealStatus) {
        el.tradingRealStatus.textContent = state.tradingReal ? 'ON' : 'OFF';
        el.tradingRealStatus.className =
          'control-status ' + (state.tradingReal ? '' : 'off');
      }

      if (el.tradingRealDot) {
        el.tradingRealDot.classList.toggle('off', !state.tradingReal);
      }

      if (el.tradingRealToggle) {
        el.tradingRealToggle.disabled = state.killSwitch;
        el.tradingRealToggle.classList.toggle('active', state.tradingReal);
        el.tradingRealToggle.classList.toggle('disabled', state.killSwitch);
        el.tradingRealToggle.querySelector('.toggle-state').textContent = state.tradingReal
          ? 'DISABLE'
          : 'ENABLE';
      }

      // Update Training display
      if (el.trainingStatus) {
        el.trainingStatus.textContent = state.training ? 'ON' : 'PENDIENTE';
        el.trainingStatus.className =
          'control-status training ' + (state.training ? '' : 'off');
      }

      if (el.trainingDot) {
        el.trainingDot.classList.toggle('off', !state.training);
      }

      if (el.trainingToggle) el.trainingToggle.remove();

      // Update pause button visibility
      if (el.pauseTradingBtn) {
        el.pauseTradingBtn.style.display = state.tradingReal ? 'flex' : 'none';
      }

      if (el.killSwitchBtn) {
        el.killSwitchBtn.classList.toggle('active', state.killSwitch);
        el.killSwitchBtn.querySelector('span:last-child').textContent = state.killSwitch
          ? 'RESUME TRADING'
          : 'KILL SWITCH';
        el.killSwitchBtn.setAttribute(
          'title',
          state.killSwitch
            ? 'Kill switch active: real trading is blocked'
            : 'Stop all real trading operations immediately'
        );
      }
    },

    // Show Kill Switch confirmation dialog
    showKillSwitchConfirm: () => {
      const el = window.heroController.elements;
      if (!el.killSwitchConfirm) return;

      el.killSwitchConfirm.style.display = 'block';

      const confirmBtn = el.killSwitchConfirm.querySelector('#confirmKillBtn');
      const cancelBtn = el.killSwitchConfirm.querySelector('#cancelKillBtn');
      const progressBar = el.killSwitchConfirm.querySelector('#confirmBar');

      // Enable confirm button after 3 seconds
      let timeLeft = 3;
      const updateProgress = () => {
        const percent = ((3 - timeLeft) / 3) * 100;
        if (progressBar) {
          progressBar.style.width = percent + '%';
        }
      };

      confirmBtn.disabled = true;

      const countdownInterval = setInterval(() => {
        timeLeft--;
        updateProgress();

        if (timeLeft <= 0) {
          clearInterval(countdownInterval);
          confirmBtn.disabled = false;
        }
      }, 1000);

      // Cancel button
      if (cancelBtn) {
        cancelBtn.onclick = () => {
          clearInterval(countdownInterval);
          el.killSwitchConfirm.style.display = 'none';
          confirmBtn.disabled = true;
          confirmBtn.onclick = null;
        };
      }

      // Confirm button
      if (confirmBtn) {
        confirmBtn.onclick = async () => {
          clearInterval(countdownInterval);
          await window.quantStateManager.setKillSwitch(true);
          el.killSwitchConfirm.style.display = 'none';
          window.heroController.updateUI();
        };
      }
    },

    // Update P&L display
    updatePnL: (pnlValue, pnlPercent) => {
      const el = window.heroController.elements;
      if (el.botStatePnl) {
        const isPositive = pnlValue >= 0;
        el.botStatePnl.textContent = (isPositive ? '+' : '') + pnlValue.toFixed(2);
        el.botStatePnl.className = 'metric-value ' +
          (isPositive ? 'positive' : 'negative');
      }

      if (el.botStatePnlPct) {
        const isPositive = pnlPercent >= 0;
        el.botStatePnlPct.textContent =
          (isPositive ? '+' : '') + pnlPercent.toFixed(2) + '%';
        el.botStatePnlPct.className =
          'metric-change ' + (isPositive ? '' : 'negative');
      }
    },

    // Update last action
    updateLastAction: (text) => {
      const el = window.heroController.elements;
      if (el.botStateLastAction) {
        el.botStateLastAction.textContent = text;
      }
    },

    // Update confidence
    updateConfidence: (percent) => {
      const el = window.heroController.elements;
      if (el.confidenceFill) {
        el.confidenceFill.style.width = percent + '%';
      }
      if (el.confidenceText) {
        el.confidenceText.textContent = Math.round(percent) + '%';
      }
    },
  };
}
