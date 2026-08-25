const BINS = 64;

export default function useAudioAnalyser() {
  let ctx = null;
  let analyser = null;
  let stream = null;
  const spectrum = new Uint8Array(BINS);
  let level = 0;
  let failed = false;

  async function attach() {
    if (analyser || failed) return false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      src.connect(analyser);
      return true;
    } catch {
      failed = true;
      return false;
    }
  }

  function detach() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (ctx) {
      ctx.close();
      ctx = null;
    }
    analyser = null;
    spectrum.fill(0);
    level = 0;
  }

  function sample() {
    if (!analyser) return { spectrum, level: 0 };
    const raw = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(raw);
    const step = Math.floor(raw.length / BINS) || 1;
    let sum = 0;
    for (let i = 0; i < BINS; i++) {
      let v = 0;
      for (let j = 0; j < step; j++) v += raw[i * step + j] || 0;
      v /= step;
      spectrum[i] = v;
      sum += v;
    }
    level = sum / (BINS * 255);
    return { spectrum, level };
  }

  return { attach, detach, sample, isLive: () => !!analyser };
}
