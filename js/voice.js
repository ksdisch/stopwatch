const Voice = (() => {
  const RecCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isSupported = !!RecCtor;

  const COMMANDS = {
    start: ['start', 'go', 'begin', 'resume'],
    stop: ['stop', 'pause', 'halt'],
    lap: ['lap', 'split'],
    reset: ['reset', 'clear'],
  };

  let enabled = localStorage.getItem('voice_enabled') === '1';
  let recognition = null;
  let wantListening = false;
  let btnEl = null;

  function init() {
    btnEl = document.getElementById('voice-toggle');
    if (!btnEl) return;
    if (!isSupported) {
      btnEl.classList.add('hidden');
      return;
    }
    btnEl.addEventListener('click', toggle);
    updateButton();
    if (enabled) startListening();
  }

  function toggle() {
    enabled = !enabled;
    localStorage.setItem('voice_enabled', enabled ? '1' : '0');
    updateButton();
    if (enabled) startListening();
    else stopListening();
  }

  function startListening() {
    if (!isSupported || recognition) return;
    try {
      recognition = new RecCtor();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      recognition.onresult = onResult;
      recognition.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          enabled = false;
          wantListening = false;
          localStorage.setItem('voice_enabled', '0');
          updateButton();
          try { recognition && recognition.abort(); } catch (_) {}
          recognition = null;
          announce('Microphone permission denied');
        }
      };
      recognition.onend = () => {
        if (wantListening) {
          // Browsers stop continuous recognition periodically; restart to keep listening.
          try { recognition.start(); } catch (_) { recognition = null; }
        } else {
          recognition = null;
        }
      };
      wantListening = true;
      recognition.start();
    } catch (_) {
      recognition = null;
    }
  }

  function stopListening() {
    wantListening = false;
    if (recognition) {
      try { recognition.stop(); } catch (_) {}
      recognition = null;
    }
  }

  function onResult(event) {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (!res.isFinal) continue;
      const transcript = (res[0].transcript || '').trim().toLowerCase();
      const cmd = matchCommand(transcript);
      if (cmd) execute(cmd);
    }
  }

  function matchCommand(text) {
    const words = text.split(/\s+/);
    for (const [cmd, aliases] of Object.entries(COMMANDS)) {
      if (aliases.some(a => words.includes(a))) return cmd;
    }
    return null;
  }

  function execute(cmd) {
    const mode = typeof appMode !== 'undefined' ? appMode : 'stopwatch';
    const engine = getActiveEngine(mode);
    const status = engine && typeof engine.getStatus === 'function' ? engine.getStatus() : null;
    const btnLeft = document.getElementById('btn-left');
    const btnRight = document.getElementById('btn-right');
    if (!btnLeft || !btnRight) return;

    if (cmd === 'start') {
      if (status !== 'running') {
        btnRight.click();
        announce('Started');
      }
    } else if (cmd === 'stop') {
      if (status === 'running') {
        btnRight.click();
        announce('Stopped');
      }
    } else if (cmd === 'lap') {
      if (mode === 'stopwatch' && status === 'running') {
        btnLeft.click();
        announce('Lap');
      }
    } else if (cmd === 'reset') {
      if (status === 'paused' || status === 'finished' || status === 'done') {
        btnLeft.click();
        announce('Reset');
      }
    }
  }

  function getActiveEngine(mode) {
    if (mode === 'stopwatch' && typeof Stopwatch !== 'undefined') return Stopwatch;
    if (mode === 'timer' && typeof Timer !== 'undefined') return Timer;
    if (mode === 'pomodoro' && typeof Pomodoro !== 'undefined') return Pomodoro;
    if (mode === 'flow' && typeof Flow !== 'undefined') return Flow;
    if (mode === 'interval' && typeof Interval !== 'undefined') return Interval;
    return null;
  }

  function announce(msg) {
    const el = document.getElementById('sr-announce');
    if (el) {
      el.textContent = '';
      requestAnimationFrame(() => { el.textContent = msg; });
    }
  }

  function updateButton() {
    if (!btnEl) return;
    btnEl.classList.toggle('voice-active', enabled);
    btnEl.setAttribute('aria-label', enabled ? 'Voice control on' : 'Voice control off');
    btnEl.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  }

  return { init, isSupported: () => isSupported, isEnabled: () => enabled };
})();
