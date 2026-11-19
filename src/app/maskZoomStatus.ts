/** Only the toolbar reads this store. The canvas owns the actual view and its fit command. */
export class MaskZoomStatus {
  fit = () => {};
  private listeners = new Set<() => void>();
  private value = { percent: 100, fitted: true, failed: false };
  private pending = 0;
  snapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  update(percent: number, fitted: boolean, failed: boolean) {
    const old = this.value;
    if (percent === old.percent && fitted === old.fitted && failed === old.failed) return;
    this.value = { percent, fitted, failed };
    if (!this.pending) this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.listeners.forEach(listener => listener());
    });
  }
}
