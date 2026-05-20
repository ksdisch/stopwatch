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

  // Per-sound volume tuning (0.0–1.0). Global sounds default to 0.15
  // (unchanged behavior). BFRB recovery-end chime is loud and separately
  // adjustable by the user since they explicitly want to hear it over focus work.
  const BFRB_VOLUME_KEY = 'bfrb_volume';
  const BFRB_VOLUME_DEFAULT = 0.55;
  let bfrbVolume = (() => {
    const raw = parseFloat(localStorage.getItem(BFRB_VOLUME_KEY));
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : BFRB_VOLUME_DEFAULT;
  })();

  function beep(freq, duration, type = 'sine', volume = 0.15) {
    if (muted) return;
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration / 1000);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + duration / 1000);
    } catch (e) { /* audio not available */ }
  }

  function playSequence(name, volume) {
    const seq = PROFILES[currentProfile]?.[name] || PROFILES.classic[name];
    if (!seq) return;
    seq.forEach(s => {
      if (s.delay) {
        setTimeout(() => beep(s.freq, s.dur, s.type || 'sine', volume), s.delay);
      } else {
        beep(s.freq, s.dur, s.type || 'sine', volume);
      }
    });
  }

  function playStart() { playSequence('start'); }
  function playStop() { playSequence('stop'); }
  function playLap() { playSequence('lap'); }
  function playReset() { playSequence('reset'); }
  function playAlarm() { playSequence('alarm'); }
  function playPhaseChange() { playSequence('phaseChange'); }
  // Louder, user-adjustable chime specifically for end of BFRB competing-response routine.
  function playBFRBEnd() { playSequence('phaseChange', bfrbVolume); }

  function isMuted() { return muted; }

  function toggleMute() {
    muted = !muted;
    localStorage.setItem('sound_muted', muted ? '1' : '0');
    // Ambient noise honors the global mute. On mute, tear down the
    // playing source but remember the profile so a future unmute can
    // resume the same noise. On unmute, restart if a profile is
    // remembered AND the user is mid-session (the source node was
    // either torn down on mute or was never started; either way,
    // startAmbient is idempotent and safe to call).
    if (muted) {
      const remembered = _ambientProfile;
      _stopAmbientNode();
      _ambientProfile = remembered;
    } else if (_ambientProfile) {
      const resume = _ambientProfile;
      _ambientProfile = null; // force startAmbient to re-arm
      startAmbient(resume);
    }
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

  function getBFRBVolume() { return bfrbVolume; }
  function setBFRBVolume(v) {
    const clamped = Math.max(0, Math.min(1, Number(v) || 0));
    bfrbVolume = clamped;
    localStorage.setItem(BFRB_VOLUME_KEY, String(clamped));
  }

  // ── Backlog #3: Ambient noise (procedural) ──────────────────────────
  //
  // Generates continuous white / brown / pink / green / blue / violet /
  // gray noise via a single 5-second AudioBuffer per profile, played
  // through a looped AudioBufferSourceNode. Buffer is generated lazily on
  // first start of each profile and cached for the lifetime of the
  // AudioContext — cheap (~880 KB per profile at 44.1 kHz mono, ~6 MB
  // peak if all 7 colors get played in one session) and avoids the
  // ScriptProcessorNode deprecation path.
  //
  // Honors the global `muted` flag: if the user toggles sound off via the
  // existing settings toggle, ambient stops mid-session too. (Future split
  // is easy if the request comes — separate `ambient_muted` key.)
  //
  // Volume is persisted under `ambient_volume` so it survives reloads.
  // Default 0.05 keeps the noise unobtrusive on default device speakers.

  const AMBIENT_VOLUME_KEY = 'ambient_volume';
  const AMBIENT_VOLUME_DEFAULT = 0.05;
  const AMBIENT_BUFFER_SECONDS = 5;
  const AMBIENT_PROFILES = ['white', 'brown', 'pink', 'green', 'blue', 'violet', 'gray'];

  let ambientVolume = (() => {
    const raw = parseFloat(localStorage.getItem(AMBIENT_VOLUME_KEY));
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : AMBIENT_VOLUME_DEFAULT;
  })();
  const _ambientBuffers = Object.create(null); // profile → AudioBuffer
  let _ambientSource = null;                   // AudioBufferSourceNode
  let _ambientGain = null;                     // GainNode (volume control)
  let _ambientProfile = null;                  // 'white' | 'brown' | 'pink' | 'green' | 'blue' | 'violet' | 'gray' | null

  function _generateAmbientBuffer(c, profile) {
    const sampleRate = c.sampleRate;
    const length = Math.floor(sampleRate * AMBIENT_BUFFER_SECONDS);
    const buf = c.createBuffer(1, length, sampleRate);
    const data = buf.getChannelData(0);
    if (profile === 'white') {
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    } else if (profile === 'brown') {
      // Leaky integrator on white noise → "red" / brown spectrum.
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5; // amplitude compensation
      }
    } else if (profile === 'pink') {
      // Paul Kellet's pink-noise approximation — 7 filter taps, ~1/f spectrum.
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        data[i] = pink * 0.11; // amplitude compensation
      }
    } else if (profile === 'green') {
      // 2-pole resonant bandpass at ~500 Hz, Q=1.0 — mid-frequency emphasis,
      // "Otto-style" forest/nature feel. Biquad coefficients from the RBJ
      // audio EQ cookbook (constant-skirt-gain BPF form). Hard-coded for the
      // current AudioContext sampleRate; center drifts ~10 Hz across the
      // 44.1/48 kHz range — inaudible.
      const w0 = 2 * Math.PI * 500 / sampleRate;
      const alpha = Math.sin(w0) / (2 * 1.0); // Q = 1.0
      const cosW0 = Math.cos(w0);
      const b0 =  alpha;
      const b1 =  0;
      const b2 = -alpha;
      const a0 =  1 + alpha;
      const a1 = -2 * cosW0;
      const a2 =  1 - alpha;
      const nb0 = b0 / a0, nb1 = b1 / a0, nb2 = b2 / a0;
      const na1 = a1 / a0, na2 = a2 / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < length; i++) {
        const x0 = Math.random() * 2 - 1;
        const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
        x2 = x1; x1 = x0;
        y2 = y1; y1 = y0;
        data[i] = y0 * 4.0; // amplitude compensation — bandpass output is dim
      }
    } else if (profile === 'blue') {
      // Single-difference differentiator: y[n] = x[n] - x[n-1]. Yields a
      // rising spectrum (+6 dB/oct in the simple form, conventionally
      // labeled "blue" in procedural-audio implementations). Brighter
      // than white; amplitude scaled to match pink/white loudness.
      let prev = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (white - prev) * 0.5; // amplitude compensation
        prev = white;
      }
    } else if (profile === 'violet') {
      // Second-difference: y[n] = x[n] - 2*x[n-1] + x[n-2]. Steeper
      // high-frequency emphasis than blue (differentiator applied twice).
      // Sounds airier/hissier — "purple" noise.
      let prev1 = 0, prev2 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (white - 2 * prev1 + prev2) * 0.25; // amplitude compensation
        prev2 = prev1;
        prev1 = white;
      }
    } else if (profile === 'gray') {
      // Approximation: pink noise (Kellet 7-tap) with a mid-band notch
      // at ~2 kHz (Q=0.7) to compensate for the ear's most-sensitive
      // band. Net effect is a "U-shape" spectrum that sounds perceptually
      // flatter than pink — qualitative gray-noise behavior without
      // building a full A-weighting filter chain.
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      const w0n = 2 * Math.PI * 2000 / sampleRate;
      const alphaN = Math.sin(w0n) / (2 * 0.7); // Q = 0.7
      const cosW0n = Math.cos(w0n);
      const nb0n = 1, nb1n = -2 * cosW0n, nb2n = 1;
      const na0n = 1 + alphaN, na1n = -2 * cosW0n, na2n = 1 - alphaN;
      const c0 = nb0n / na0n, c1 = nb1n / na0n, c2 = nb2n / na0n;
      const d1 = na1n / na0n, d2 = na2n / na0n;
      let nx1 = 0, nx2 = 0, ny1 = 0, ny2 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        const xPink = pink * 0.11; // match the pink-branch loudness baseline
        const y0 = c0 * xPink + c1 * nx1 + c2 * nx2 - d1 * ny1 - d2 * ny2;
        nx2 = nx1; nx1 = xPink;
        ny2 = ny1; ny1 = y0;
        data[i] = y0;
      }
    }
    return buf;
  }

  function _stopAmbientNode() {
    if (_ambientSource) {
      try { _ambientSource.stop(); } catch (_) {}
      try { _ambientSource.disconnect(); } catch (_) {}
      _ambientSource = null;
    }
    if (_ambientGain) {
      try { _ambientGain.disconnect(); } catch (_) {}
      _ambientGain = null;
    }
  }

  // Public — start (or restart) ambient noise on the given profile.
  // Idempotent: starting the same profile that's already playing is a
  // no-op; switching profiles tears down the existing source first.
  function startAmbient(profile) {
    if (!AMBIENT_PROFILES.includes(profile)) {
      stopAmbient();
      return;
    }
    if (_ambientProfile === profile && _ambientSource) return;
    if (muted) {
      _ambientProfile = profile;
      return; // Honor global mute; remember the choice for a future unmute.
    }
    try {
      const c = getCtx();
      _stopAmbientNode();
      if (!_ambientBuffers[profile]) {
        _ambientBuffers[profile] = _generateAmbientBuffer(c, profile);
      }
      const src = c.createBufferSource();
      src.buffer = _ambientBuffers[profile];
      src.loop = true;
      const gain = c.createGain();
      gain.gain.value = ambientVolume;
      src.connect(gain);
      gain.connect(c.destination);
      src.start();
      _ambientSource = src;
      _ambientGain = gain;
      _ambientProfile = profile;
    } catch (_) {
      // Audio context unavailable / suspended — silently no-op. The
      // user-gesture-required suspended-context case is covered by
      // callers being invoked from a click handler (Flow.start /
      // Pomodoro.start are both user-triggered).
    }
  }

  function stopAmbient() {
    _stopAmbientNode();
    _ambientProfile = null;
  }

  function getAmbientProfile() { return _ambientProfile; }

  function getAmbientVolume() { return ambientVolume; }
  function setAmbientVolume(v) {
    const clamped = Math.max(0, Math.min(1, Number(v) || 0));
    ambientVolume = clamped;
    localStorage.setItem(AMBIENT_VOLUME_KEY, String(clamped));
    if (_ambientGain) {
      try { _ambientGain.gain.value = clamped; } catch (_) {}
    }
  }

  function getAmbientProfiles() {
    return AMBIENT_PROFILES.map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) }));
  }

  return {
    playStart, playStop, playLap, playReset, playAlarm, playPhaseChange, playBFRBEnd,
    isMuted, toggleMute, getProfile, setProfile, getProfiles,
    getBFRBVolume, setBFRBVolume,
    startAmbient, stopAmbient, getAmbientProfile,
    getAmbientVolume, setAmbientVolume, getAmbientProfiles,
  };
})();
