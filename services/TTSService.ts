
export class TTSService {
  private synth: SpeechSynthesis | null = null;
  private voice: SpeechSynthesisVoice | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
      this.loadVoice();
      // Voices are loaded asynchronously in some browsers
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = () => this.loadVoice();
      }
    } else {
      console.warn("TTSService: SpeechSynthesis is not supported in this browser.");
    }
  }

  private loadVoice() {
    if (!this.synth) return;
    const voices = this.synth.getVoices();
    if (voices.length === 0) return;

    // Prefer a natural sounding English voice if available
    this.voice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) || 
                 voices.find(v => v.lang.startsWith('en')) || 
                 voices[0];
    console.log("TTSService: Voice loaded:", this.voice?.name);
  }

  async speak(text: string) {
    if (!this.synth) {
      console.warn("TTSService: SpeechSynthesis not available");
      return;
    }

    // Fallback if voices weren't ready at init
    if (!this.voice) {
      this.loadVoice();
    }

    console.log(`TTSService: Attempting to speak: "${text}"`);

    // Cancel any ongoing speech
    this.synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    if (this.voice) {
      utterance.voice = this.voice;
    }
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Error handling
    utterance.onerror = (event) => {
      console.error("TTSService: SpeechSynthesis error:", event);
    };

    this.synth.speak(utterance);
  }
}

export const ttsService = new TTSService();
