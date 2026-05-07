/**
 * COLLAPSABLE PANELS - Maneja acordeones de secciones secundarias
 * PHASE 0: Progressive disclosure for training, historical data, etc.
 */

if (!window.collapsablePanels) {
  window.collapsablePanels = {
    // Estado de paneles
    state: {
      expanded: {},
    },

    // Inicializar todos los paneles colapsables
    init: () => {
      const panels = document.querySelectorAll('.panel-collapsable');

      panels.forEach((panel) => {
        const section = panel.getAttribute('data-section');
        const toggleBtn = panel.querySelector('.panel-toggle-btn');

        // Default: expanded
        if (section) {
          window.collapsablePanels.state.expanded[section] = true;
        }

        // Setup listener
        if (toggleBtn) {
          toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.collapsablePanels.toggle(panel, section);
          });
        }

        // Allow header to toggle too
        const header = panel.querySelector('.panel-header-collapsable');
        if (header) {
          header.addEventListener('click', () => {
            window.collapsablePanels.toggle(panel, section);
          });
        }
      });

      console.log('[CollapsablePanels] Initialized ' + panels.length + ' panels');
    },

    // Toggle panel state
    toggle: (panel, section) => {
      const isExpanded = window.collapsablePanels.state.expanded[section];

      if (isExpanded) {
        window.collapsablePanels.collapse(panel, section);
      } else {
        window.collapsablePanels.expand(panel, section);
      }
    },

    // Expand panel
    expand: (panel, section) => {
      panel.classList.remove('collapsed');
      window.collapsablePanels.state.expanded[section] = true;

      // Persist to localStorage
      const saved = JSON.parse(
        localStorage.getItem('panelStates') || '{}'
      );
      saved[section] = true;
      localStorage.setItem('panelStates', JSON.stringify(saved));

      console.log('[CollapsablePanels] Expanded:', section);
    },

    // Collapse panel
    collapse: (panel, section) => {
      panel.classList.add('collapsed');
      window.collapsablePanels.state.expanded[section] = false;

      // Persist to localStorage
      const saved = JSON.parse(
        localStorage.getItem('panelStates') || '{}'
      );
      saved[section] = false;
      localStorage.setItem('panelStates', JSON.stringify(saved));

      console.log('[CollapsablePanels] Collapsed:', section);
    },

    // Restore state from localStorage
    restoreState: () => {
      const saved = JSON.parse(
        localStorage.getItem('panelStates') || '{}'
      );

      const panels = document.querySelectorAll('.panel-collapsable');
      panels.forEach((panel) => {
        const section = panel.getAttribute('data-section');
        const shouldBeExpanded = saved[section] !== false; // default: expanded

        if (shouldBeExpanded) {
          window.collapsablePanels.expand(panel, section);
        } else {
          window.collapsablePanels.collapse(panel, section);
        }
      });

      console.log('[CollapsablePanels] State restored from localStorage');
    },

    // Collapse all panels
    collapseAll: () => {
      const panels = document.querySelectorAll('.panel-collapsable');
      panels.forEach((panel) => {
        const section = panel.getAttribute('data-section');
        window.collapsablePanels.collapse(panel, section);
      });
    },

    // Expand all panels
    expandAll: () => {
      const panels = document.querySelectorAll('.panel-collapsable');
      panels.forEach((panel) => {
        const section = panel.getAttribute('data-section');
        window.collapsablePanels.expand(panel, section);
      });
    },
  };
}
