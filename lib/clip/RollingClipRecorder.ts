export class RollingClipRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: { blob: Blob; at: number }[] = [];
  start(canvas: HTMLCanvasElement): void {
    if (
      typeof MediaRecorder === "undefined" ||
      typeof canvas.captureStream !== "function"
    )
      return;
    const mime = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((value) => MediaRecorder.isTypeSupported(value));
    if (!mime) return;
    this.chunks = [];
    try {
      const stream = canvas.captureStream(30);
      this.recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 2_000_000,
      });
      this.recorder.ondataavailable = (event) => {
        if (event.data.size) {
          const now = Date.now();
          this.chunks.push({ blob: event.data, at: now });
          this.chunks = this.chunks.filter((entry) => now - entry.at <= 10_000);
        }
      };
      this.recorder.start(1000);
    } catch {
      this.stopTracks();
    }
  }
  async stop(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder) return null;
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = this.chunks.length
          ? new Blob(
              this.chunks.map((entry) => entry.blob),
              { type: recorder.mimeType },
            )
          : null;
        this.stopTracks();
        resolve(blob);
      };
      if (recorder.state !== "inactive") recorder.stop();
      else resolve(null);
    });
  }
  dispose(): void {
    if (this.recorder?.state !== "inactive") this.recorder?.stop();
    this.stopTracks();
    this.chunks = [];
  }
  private stopTracks(): void {
    this.recorder?.stream.getTracks().forEach((track) => track.stop());
    this.recorder = null;
  }
}
