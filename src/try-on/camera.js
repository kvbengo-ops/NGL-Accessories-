export async function startCamera({ signal, onEnded = () => {}, onPause = () => {} } = {}) {
  // Browsers hide navigator.mediaDevices on non-HTTPS pages (anything but localhost).
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('Camera unavailable'), { code: window.isSecureContext === false ? 'insecure-context' : 'no-camera' });
  if (signal?.aborted) throw Object.assign(new Error('Camera request cancelled'), { code: 'aborted' });
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user' } });
  } catch (error) {
    const code = error.name === 'NotAllowedError' || error.name === 'SecurityError' ? 'permission-denied'
      : error.name === 'NotFoundError' || error.name === 'OverconstrainedError' ? 'no-camera'
      : error.name === 'NotReadableError' || error.name === 'AbortError' ? 'camera-busy' : 'no-camera';
    console.warn('Camera request failed:', error.name, error.message); // diagnosis only; no camera data
    throw Object.assign(new Error(error.message || code), { code, cause: error });
  }
  if (signal?.aborted) {
    stream.getTracks().forEach(track => track.stop());
    throw Object.assign(new Error('Camera request cancelled'), { code: 'aborted' });
  }
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('aria-label', 'Live camera preview');
  video.srcObject = stream;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('visibilitychange', visibility);
    signal?.removeEventListener('abort', stop);
    stream.getTracks().forEach(track => { track.onended = null; track.stop(); });
    video.pause();
    video.srcObject = null;
  };
  const visibility = () => {
    if (document.hidden && !stopped) {
      stop();
      onPause();
    }
  };
  stream.getVideoTracks().forEach(track => {
    track.onended = () => { if (!stopped) { stop(); onEnded(); } };
  });
  document.addEventListener('visibilitychange', visibility);
  signal?.addEventListener('abort', stop, { once: true });
  if (document.hidden) {
    stop();
    onPause();
    throw Object.assign(new Error('Camera paused while page is hidden'), { code: 'paused' });
  }
  try {
    await video.play();
    if (signal?.aborted || stopped) throw Object.assign(new Error('Camera request cancelled'), { code: 'aborted' });
  } catch (error) {
    stop();
    if (error.code === 'aborted') throw error;
    throw Object.assign(new Error('Camera could not start'), { code: 'camera-busy', cause: error });
  }
  return { video, stop };
}
