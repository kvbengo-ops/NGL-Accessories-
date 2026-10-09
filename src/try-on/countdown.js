// Cancelling the camera session also cancels its countdown and pending timer.
export async function runCountdown(seconds, signal, onTick) {
  for (let remaining = seconds; remaining > 0; remaining--) {
    if (signal.aborted) return false;
    onTick(remaining);
    const finished = await new Promise(resolve => {
      const finish = value => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancelled);
        resolve(value);
      };
      const cancelled = () => finish(false);
      const timer = setTimeout(() => finish(true), 1000);
      signal.addEventListener('abort', cancelled, { once: true });
      if (signal.aborted) cancelled();
    });
    if (!finished) return false;
  }
  return !signal.aborted;
}
