class NesXGame {
  constructor(container) {
    this.container = container;

    this.canvas = document.createElement("canvas");
    this.canvas.width = 256;
    this.canvas.height = 240;
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";

    this.ctx = this.canvas.getContext("2d", {
      alpha: false,
      desynchronized: true
    });

    this.ctx.imageSmoothingEnabled = false;

    this.imageData = this.ctx.createImageData(256, 240);

    this.running = false;
    this.paused = true;
    this.frameRequest = null;

    this.lastTime = 0;
    this.accumulator = 0;

    this.frameTime = 1000 / 60;

    // Audio
    this.audioContext = null;
    this.audioNode = null;

    this.audioSampleRate = 44100;

    // Stereo ring buffer
    this.audioBufferSize = 16384;
    this.audioBuffer = new Float32Array(this.audioBufferSize * 2);

    this.audioWrite = 0;
    this.audioRead = 0;

    this.nes = new jsnes.NES({
      sampleRate: this.audioSampleRate,

      onFrame: frameBuffer => {
        this.renderFrame(frameBuffer);
      },

      onAudioSample: (left, right) => {
        this.pushAudioSample(left, right);
      }
    });

    this.container.innerHTML = "";
    this.container.appendChild(this.canvas);
  }

  renderFrame(frameBuffer) {
    const data = this.imageData.data;

    for (let i = 0; i < frameBuffer.length; i++) {
      const pixel = frameBuffer[i];
      const offset = i << 2;

      data[offset] = pixel & 0xff;
      data[offset + 1] = (pixel >> 8) & 0xff;
      data[offset + 2] = (pixel >> 16) & 0xff;
      data[offset + 3] = 255;
    }

    this.ctx.putImageData(this.imageData, 0, 0);
  }

  loadROM(romData) {
    this.nes.loadROM(romData);

    this.paused = false;
    this.start();
  }

  start() {
    if (this.running) return;

    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;

    this.frameRequest = requestAnimationFrame(this.loop.bind(this));
  }

  loop(now) {
    if (!this.running) return;

    const delta = Math.min(now - this.lastTime, 100);

    this.lastTime = now;

    if (!this.paused) {
      this.accumulator += delta;

      let frames = 0;

      while (this.accumulator >= this.frameTime && frames < 2) {
        this.nes.frame();

        this.accumulator -= this.frameTime;
        frames++;
      }
    }

    this.frameRequest = requestAnimationFrame(this.loop.bind(this));
  }

  pause() {
    this.paused = true;
  }

  resume() {
    if (!this.running) {
      this.start();
      return;
    }

    this.lastTime = performance.now();
    this.accumulator = 0;
    this.paused = false;
  }

  stop() {
    this.running = false;
    this.paused = true;

    if (this.frameRequest !== null) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }

    this.stopAudio();
  }

  buttonDown(button) {
    this.nes.buttonDown(1, button);
  }

  buttonUp(button) {
    this.nes.buttonUp(1, button);
  }

  initAudio() {
    if (this.audioContext) {
      if (this.audioContext.state === "suspended") {
        this.audioContext.resume();
      }

      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) {
      console.warn("Web Audio API unavailable");
      return;
    }

    this.audioContext = new AudioContext({
      sampleRate: this.audioSampleRate,
      latencyHint: "interactive"
    });

    this.audioNode = this.audioContext.createScriptProcessor(1024, 0, 2);

    this.audioNode.onaudioprocess = event => {
      const left = event.outputBuffer.getChannelData(0);

      const right = event.outputBuffer.getChannelData(1);

      const size = this.audioBufferSize;

      for (let i = 0; i < left.length; i++) {
        if (this.audioRead < this.audioWrite) {
          const index = (this.audioRead % size) * 2;

          left[i] = this.audioBuffer[index];
          right[i] = this.audioBuffer[index + 1];

          this.audioRead++;
        } else {
          left[i] = 0;
          right[i] = 0;
        }
      }
    };

    this.audioNode.connect(this.audioContext.destination);
  }

  pushAudioSample(left, right) {
    if (!this.audioContext) {
      return;
    }

    const size = this.audioBufferSize;

    // Prevent overflow
    if (this.audioWrite - this.audioRead >= size - 1) {
      this.audioRead = this.audioWrite - (size - 2);
    }

    const index = (this.audioWrite % size) * 2;

    this.audioBuffer[index] = left;
    this.audioBuffer[index + 1] = right;

    this.audioWrite++;
  }

  resumeAudio() {
    this.initAudio();

    if (this.audioContext && this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }
  }

  stopAudio() {
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.suspend();
    }

    this.audioRead = this.audioWrite;
  }

  reset() {
    this.nes.reset();
  }

  getNES() {
    return this.nes;
  }
}
