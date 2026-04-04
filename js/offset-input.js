const OffsetInput = (() => {
  let toggleBtn, inputArea, hoursEl, minutesEl, secondsEl, setBtn, cancelBtn;

  function init() {
    toggleBtn = document.getElementById('offset-toggle');
    inputArea = document.getElementById('offset-input');
    hoursEl = document.getElementById('offset-hours');
    minutesEl = document.getElementById('offset-minutes');
    secondsEl = document.getElementById('offset-seconds');
    setBtn = document.getElementById('offset-set');
    cancelBtn = document.getElementById('offset-cancel');

    toggleBtn.addEventListener('click', show);
    setBtn.addEventListener('click', applyOffset);
    cancelBtn.addEventListener('click', hide);

    const fields = [
      { el: hoursEl, min: 0, max: 99 },
      { el: minutesEl, min: 0, max: 59 },
      { el: secondsEl, min: 0, max: 59 },
    ];

    fields.forEach(({ el, min, max }) => {
      el.addEventListener('input', () => {
        const val = parseInt(el.value, 10);
        if (!isNaN(val) && val > max) {
          el.value = max;
          flashBorder(el);
        }
      });

      el.addEventListener('blur', () => {
        const val = parseInt(el.value, 10);
        if (isNaN(val) || val < min) el.value = min;
        else if (val > max) { el.value = max; flashBorder(el); }
      });

      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyOffset(); }
        else if (e.key === 'Escape') { e.preventDefault(); hide(); }
      });
    });
  }

  function show() {
    inputArea.classList.remove('hidden');
    toggleBtn.classList.add('hidden');
    minutesEl.focus();
    minutesEl.select();
  }

  function hide() {
    inputArea.classList.add('hidden');
    toggleBtn.classList.remove('hidden');
    hoursEl.value = 0;
    minutesEl.value = 0;
    secondsEl.value = 0;
  }

  function applyOffset() {
    const h = Math.min(99, Math.max(0, parseInt(hoursEl.value, 10) || 0));
    const m = Math.min(59, Math.max(0, parseInt(minutesEl.value, 10) || 0));
    const s = Math.min(59, Math.max(0, parseInt(secondsEl.value, 10) || 0));
    const ms = (h * 3600 + m * 60 + s) * 1000;

    if (ms > 0) {
      Stopwatch.setOffset(ms);
      Persistence.save();
      UI.updateDisplay(Stopwatch.getElapsedMs());
    }
    hide();
  }

  function setVisible(visible) {
    const area = document.getElementById('offset-area');
    if (visible) {
      area.classList.remove('hidden');
    } else {
      area.classList.add('hidden');
      hide();
    }
  }

  function flashBorder(el) {
    el.style.borderColor = 'var(--red)';
    setTimeout(() => { el.style.borderColor = ''; }, 400);
  }

  return { init, hide, setVisible };
})();
