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
    const h = Math.max(0, parseInt(hoursEl.value, 10) || 0);
    const m = Math.max(0, parseInt(minutesEl.value, 10) || 0);
    const s = Math.max(0, parseInt(secondsEl.value, 10) || 0);
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

  return { init, hide, setVisible };
})();
