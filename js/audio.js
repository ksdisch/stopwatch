const SFX = (() => {
  let ctx = null;
  let muted = localStorage.getItem('sound_muted') === '1';
  let currentProfile = localStorage.getItem('sound_profile') || 'classic';

  const PROFILES = {
    classic: {
      start:       [{ freq: 800, dur: 60, type: 'sine' }, { freq: 1200, dur: 60, type: 'sine', delay: 70 }],
      stop:        [{ freq: 1200, dur: 60, type: 'sine' }, { freq: 800, dur: 60, type: 'sine', delay: 70 }],
      lap:         [{ freq: 1000, dur: 50, type: 'sine' }],
      reset:       [{ freq: 400, dur: 30, type: 'triangle' }],
      alarm:       [{ freq: 800, dur: 150, type: 'sine' }, { freq: 1000, dur: 150, type: 'sine', delay: 200 }, { freq: 1200, dur: 300, type: 'sine', delay: 400 }],
      phaseChange: [{ freq: 1100, dur: 80, type: 'sine' }, { freq: 1400, dur: 80, type: 'sine', delay: 100 }],
    },
    soft: {
      start:       [{ freq: 440, dur: 120, type: 'sine' }, { freq: 660, dur: 120, type: 'sine', delay: 140 }],
      stop:        [{ freq: 660, dur: 120, type: 'sine' }, { freq: 440, dur: 120, type: 'sine', delay: 140 }],
      lap:         [{ freq: 520, dur: 100, type: 'sine' }],
      reset:       [{ freq: 330, dur: 80, type: 'sine' }],
      alarm:       [{ freq: 440, dur: 200, type: 'sine' }, { freq: 550, dur: 200, type: 'sine', delay: 250 }, { freq: 660, dur: 400, type: 'sine', delay: 500 }],
      phaseChange: [{ freq: 550, dur: 120, type: 'sine' }, { freq: 720, dur: 120, type: 'sine', delay: 150 }],
    },
    sharp: {
      start:       [{ freq: 1500, dur: 30, type: 'square' }, { freq: 2000, dur: 30, type: 'square', delay: 50 }],
      stop:        [{ freq: 2000, dur: 30, type: 'square' }, { freq: 1500, dur: 30, type: 'square', delay: 50 }],
      lap:         [{ freq: 1800, dur: 25, type: 'square' }],
      reset:       [{ freq: 600, dur: 20, type: 'square' }],
      alarm:       [{ freq: 1500, dur: 80, type: 'square' }, { freq: 1800, dur: 80, type: 'square', delay: 100 }, { freq: 2200, dur: 150, type: 'square', delay: 200 }],
      phaseChange: [{ freq: 1800, dur: 40, type: 'square' }, { freq: 2200, dur: 40, type: 'square', delay: 60 }],
    },
  };

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

  function playSequence(name) {
    const seq = PROFILES[currentProfile]?.[name] || PROFILES.classic[name];
    if (!seq) return;
    seq.forEach(s => {
      if (s.delay) {
        setTimeout(() => beep(s.freq, s.dur, s.type || 'sine'), s.delay);
      } else {
        beep(s.freq, s.dur, s.type || 'sine');
      }
    });
  }

  function playStart() { playSequence('start'); }
  function playStop() { playSequence('stop'); }
  function playLap() { playSequence('lap'); }
  function playReset() { playSequence('reset'); }
  function playAlarm() { playSequence('alarm'); }
  function playPhaseChange() { playSequence('phaseChange'); }

  function isMuted() { return muted; }

  function toggleMute() {
    muted = !muted;
    localStorage.setItem('sound_muted', muted ? '1' : '0');
    return muted;
  }

  function getProfile() { return currentProfile; }
  function setProfile(id) {
    if (PROFILES[id]) {
      currentProfile = id;
      localStorage.setItem('sound_profile', id);
    }
  }
  function getProfiles() {
    return Object.keys(PROFILES).map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) }));
  }

  return { playStart, playStop, playLap, playReset, playAlarm, playPhaseChange, isMuted, toggleMute, getProfile, setProfile, getProfiles };
})();
