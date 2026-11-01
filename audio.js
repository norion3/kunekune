/**
 * ==============================================================================
 * 『くねくねバトル オンライン』Web Audio API プログラム動的音響エンジン (audio.js)
 * v25.2.0 宇宙ジェット光彩加速音＆快適音響デザイン版:
 * ・不快な110Hz鋸歯状波（電気シェーバー・羽音ブザー）を完全撤廃
 * ・三角波（260Hz->390Hzスイープ）＋ サイン波（520Hz倍音）による滑らかな宇宙ジェット光速加速音
 * ・滑らかな linearRamp によるフェード制御でプチッ音（クリップノイズ）を完全根絶
 * ・発音完了時の自動 disconnect によるオーディオグラフ肥大化・メモリリーク完全防止
 * ・iOS WebKit バックグラウンド自動サスペンド/レジューム制御
 * ==============================================================================
 */

class AudioManager {
    constructor() {
        this.ctx = null;
        this.isMuted = true; // デフォルトOFF
        
        // ブースト音用ノード群
        this.boostOsc1 = null; // 主推進オシレーター（三角波スイープ）
        this.boostOsc2 = null; // 光彩倍音オシレーター（サイン波）
        this.boostGain = null;
        this.boostFilter = null;

        this.bindVisibilityChange();
    }

    // iOS WebKitのユーザー操作トリガーによるAudioContext初期化
    initContext() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    // バックグラウンド切り替え時の安全サスペンド制御
    bindVisibilityChange() {
        if (typeof document === 'undefined') return;
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (this.ctx && this.ctx.state === 'running') {
                    this.stopBoostSound();
                    this.ctx.suspend().catch(() => {});
                }
            } else {
                if (!this.isMuted && this.ctx && this.ctx.state === 'suspended') {
                    this.ctx.resume().catch(() => {});
                }
            }
        });
    }

    // サウンド ON / OFF 切り替え
    toggleMute() {
        this.initContext();
        this.isMuted = !this.isMuted;

        if (this.isMuted) {
            this.stopBoostSound();
        } else {
            // ONになった瞬間のフィードバック音（明るい2音アルペジオ）
            this.playChime();
        }
        return this.isMuted;
    }

    // 小餌取得音（サイン波 880Hz -> 1320Hz の爽快なピコ音）
    playEatSmall() {
        if (this.isMuted || !this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(1320, now + 0.05);

            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.onended = () => {
                osc.disconnect();
                gain.disconnect();
            };

            osc.start(now);
            osc.stop(now + 0.05);
        } catch (e) {}
    }

    // 巨大餌取得音（三角波 440Hz -> 880Hz -> 1760Hz のリッチな和音）
    playEatBig() {
        if (this.isMuted || !this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.setValueAtTime(880, now + 0.04);
            osc.frequency.setValueAtTime(1760, now + 0.08);

            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.onended = () => {
                osc.disconnect();
                gain.disconnect();
            };

            osc.start(now);
            osc.stop(now + 0.14);
        } catch (e) {}
    }

    /**
     * ★ ブースト加速音（宇宙ジェット光速加速音）
     * 不快な低音ブザー（110Hz鋸歯状波）を完全撤廃。
     * 滑らかな三角波（260Hz->390Hzスイープ）＋ サイン波（520Hz光彩倍音）を重ね、
     * 映画の宇宙船推進のような心地よく爽快な加速音を実現。
     */
    startBoostSound() {
        if (this.isMuted || !this.ctx || this.boostGain) return;
        try {
            const now = this.ctx.currentTime;

            // 1. 主推進オシレーター（柔らかな三角波で適度な太さを付与）
            this.boostOsc1 = this.ctx.createOscillator();
            this.boostOsc1.type = 'triangle';
            this.boostOsc1.frequency.setValueAtTime(260, now);
            this.boostOsc1.frequency.exponentialRampToValueAtTime(390, now + 0.18);

            // 2. 光彩倍音オシレーター（サイン波で近未来的な浮遊感を付与）
            this.boostOsc2 = this.ctx.createOscillator();
            this.boostOsc2.type = 'sine';
            this.boostOsc2.frequency.setValueAtTime(520, now);
            this.boostOsc2.frequency.exponentialRampToValueAtTime(780, now + 0.18);

            // 3. ローパスフィルター（角を取り耳に優しいまろやかな音色に調律）
            this.boostFilter = this.ctx.createBiquadFilter();
            this.boostFilter.type = 'lowpass';
            this.boostFilter.frequency.setValueAtTime(750, now);
            this.boostFilter.frequency.linearRampToValueAtTime(1200, now + 0.2);

            // 4. ゲイン（クリップノイズを防ぐ滑らかなフェードイン）
            this.boostGain = this.ctx.createGain();
            this.boostGain.gain.setValueAtTime(0.001, now);
            this.boostGain.gain.linearRampToValueAtTime(0.07, now + 0.1);

            // オーディオグラフの接続
            this.boostOsc1.connect(this.boostFilter);
            this.boostOsc2.connect(this.boostFilter);
            this.boostFilter.connect(this.boostGain);
            this.boostGain.connect(this.ctx.destination);

            this.boostOsc1.start(now);
            this.boostOsc2.start(now);
        } catch (e) {}
    }

    /**
     * ブースト加速音 停止
     */
    stopBoostSound() {
        if (!this.boostGain || !this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            const currentOsc1 = this.boostOsc1;
            const currentOsc2 = this.boostOsc2;
            const currentGain = this.boostGain;
            const currentFilter = this.boostFilter;

            // プチッという破裂音を防ぐ滑らかなフェードアウト
            currentGain.gain.linearRampToValueAtTime(0.0001, now + 0.08);

            if (currentOsc1) currentOsc1.stop(now + 0.08);
            if (currentOsc2) currentOsc2.stop(now + 0.08);

            setTimeout(() => {
                try {
                    if (currentOsc1) currentOsc1.disconnect();
                    if (currentOsc2) currentOsc2.disconnect();
                    if (currentFilter) currentFilter.disconnect();
                    currentGain.disconnect();
                } catch (err) {}
            }, 100);
        } catch (e) {}

        this.boostOsc1 = null;
        this.boostOsc2 = null;
        this.boostGain = null;
        this.boostFilter = null;
    }

    // 激突・撃破音（重厚な低音バースト）
    playCrash() {
        if (this.isMuted || !this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(140, now);
            osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);

            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.onended = () => {
                osc.disconnect();
                gain.disconnect();
            };

            osc.start(now);
            osc.stop(now + 0.25);
        } catch (e) {}
    }

    // 起動確認チャイム
    playChime() {
        if (!this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            [523.25, 659.25, 783.99].forEach((freq, i) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + i * 0.06);
                gain.gain.setValueAtTime(0.1, now + i * 0.06);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.06 + 0.12);
                
                osc.connect(gain);
                gain.connect(this.ctx.destination);

                osc.onended = () => {
                    osc.disconnect();
                    gain.disconnect();
                };

                osc.start(now + i * 0.06);
                osc.stop(now + i * 0.06 + 0.12);
            });
        } catch (e) {}
    }
}

export const Sound = new AudioManager();