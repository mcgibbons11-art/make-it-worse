class AudioManagerClass {
  private context: AudioContext | null = null;
  private active = 0;
  private muted = false;
  private volume = 1;
  setMuted(value: boolean): void {
    this.muted = value;
  }
  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
  }
  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const constructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!constructor) return null;
    this.context ??= new constructor();
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }
  tone(
    frequency: number,
    duration = 0.12,
    type: OscillatorType = "sine",
    gain = 0.06,
  ): void {
    if (this.muted) return;
    const context = this.ensure();
    if (!context || this.active > 8) return;
    this.active += 1;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    envelope.gain.setValueAtTime(gain * this.volume, context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(
      0.0001,
      context.currentTime + duration,
    );
    oscillator.connect(envelope).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
    oscillator.onended = () => {
      this.active -= 1;
    };
  }
  click(): void {
    this.tone(420, 0.05, "square", 0.025);
  }
  jump(): void {
    this.tone(520, 0.1, "sine", 0.045);
  }
  impact(): void {
    this.tone(90, 0.16, "sawtooth", 0.045);
  }
  spring(): void {
    this.tone(220, 0.22, "square", 0.04);
  }
  finish(): void {
    [0, 90, 180, 290].forEach((delay, index) =>
      setTimeout(
        () => this.tone([523, 659, 784, 1047][index]!, 0.24, "triangle", 0.07),
        delay,
      ),
    );
  }
  publish(): void {
    [392, 523, 659, 784].forEach((frequency, index) =>
      setTimeout(() => this.tone(frequency, 0.25, "sine", 0.06), index * 70),
    );
  }
}
export const AudioManager = new AudioManagerClass();
