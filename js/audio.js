const SFX = (() => {
  let ctx = null;
  let muted = localStorage.getItem('sound_muted') === '1';

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return ctx;
  }

  function beep(freq, duration, type = 'sine') {
    if (muted) return;
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration / 1000);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + duration / 1000);
    } catch (e) { /* audio not available */ }
  }

  function playStart() {
    beep(800, 60);
    setTimeout(() => beep(1200, 60), 70);
  }

  function playStop() {
    beep(1200, 60);
    setTimeout(() => beep(800, 60), 70);
  }

  function playLap() {
    beep(1000, 50);
  }

  function playReset() {
    beep(400, 30, 'triangle');
  }

  function playAlarm() {
    // Three ascending beeps for timer finish
    beep(800, 150);
    setTimeout(() => beep(1000, 150), 200);
    setTimeout(() => beep(1200, 300), 400);
  }

  function isMuted() { return muted; }

  function toggleMute() {
    muted = !muted;
    localStorage.setItem('sound_muted', muted ? '1' : '0');
    return muted;
  }

  return { playStart, playStop, playLap, playReset, playAlarm, isMuted, toggleMute };
})();
