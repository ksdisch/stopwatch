const Analog = (() => {
  let svgContainer, secondHand, minuteHand, digitalSmall;
  let mode = localStorage.getItem('display_mode') || 'digital';

  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;

    svgContainer = document.getElementById('analog-display');
    secondHand = document.getElementById('analog-second');
    minuteHand = document.getElementById('analog-minute');
    digitalSmall = document.getElementById('digital-small');

    // Generate tick marks and numbers
    const tickGroup = document.querySelector('.tick-marks');
    if (tickGroup) {
      const ns = 'http://www.w3.org/2000/svg';
      for (let i = 0; i < 60; i++) {
        const isMajor = i % 5 === 0;
        const line = document.createElementNS(ns, 'line');
        const angle = i * 6;
        const outerR = 95;
        const innerR = isMajor ? 82 : 88;
        const rad = (angle - 90) * Math.PI / 180;
        line.setAttribute('x1', 100 + innerR * Math.cos(rad));
        line.setAttribute('y1', 100 + innerR * Math.sin(rad));
        line.setAttribute('x2', 100 + outerR * Math.cos(rad));
        line.setAttribute('y2', 100 + outerR * Math.sin(rad));
        line.setAttribute('class', isMajor ? 'analog-tick-major' : 'analog-tick');
        tickGroup.appendChild(line);

        // Add numbers at 5-second intervals
        if (isMajor) {
          const text = document.createElementNS(ns, 'text');
          const numR = 72;
          const numVal = i === 0 ? 60 : i;
          text.setAttribute('x', 100 + numR * Math.cos(rad));
          text.setAttribute('y', 100 + numR * Math.sin(rad));
          text.setAttribute('class', 'analog-number');
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'central');
          text.textContent = numVal;
          tickGroup.appendChild(text);
        }
      }
    }

    const toggleBtns = document.querySelectorAll('.mode-dot');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        setMode(btn.dataset.mode);
      });
    });

    applyMode();
  }

  function setMode(newMode) {
    mode = newMode;
    localStorage.setItem('display_mode', mode);
    applyMode();
  }

  function applyMode() {
    const timerDisplay = document.getElementById('timer-display');
    const analogDisplay = document.getElementById('analog-display');
    const dots = document.querySelectorAll('.mode-dot');

    if (mode === 'analog') {
      timerDisplay.classList.add('mode-analog');
      analogDisplay.classList.remove('hidden');
    } else {
      timerDisplay.classList.remove('mode-analog');
      analogDisplay.classList.add('hidden');
    }

    dots.forEach(d => d.classList.toggle('mode-dot-active', d.dataset.mode === mode));
  }

  function update(ms) {
    if (mode !== 'analog') return;

    const totalSeconds = ms / 1000;
    const secondsDeg = (totalSeconds % 60) * 6; // 360/60 = 6 degrees per second
    const minutesDeg = ((totalSeconds / 60) % 30) * 12; // 360/30 = 12 degrees per 30-min cycle

    if (secondHand) secondHand.setAttribute('transform', `rotate(${secondsDeg} 100 100)`);
    if (minuteHand) minuteHand.setAttribute('transform', `rotate(${minutesDeg} 100 100)`);

    // Update small digital display under the analog face
    if (digitalSmall) {
      const t = Utils.formatMs(ms);
      if (t.hours > 0) {
        digitalSmall.textContent = `${t.hours}:${t.minStr}:${t.secStr}.${t.csStr}`;
      } else {
        digitalSmall.textContent = `${t.minStr}:${t.secStr}.${t.csStr}`;
      }
    }
  }

  function getMode() {
    return mode;
  }

  return { init, update, getMode };
})();
