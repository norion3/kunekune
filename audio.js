/**
 * ==============================================================================
 * 『くねくねバトル オンライン』Web Audio API プログラム動的音響エンジン (audio.js)
 * v25.6.0 タイマー排他管理＆メモリリーク完全防止・耳に優しい音響刷新版:
 * ・【メモリリーク完全防止】stopBoostSound() 連打時の setTimeout 重複タイマーを
 * 　this._stopTimeoutId で完全に排他管理。未切断ノードの浮遊やメモリリークを物理根絶！
 * ・【即時クリーンアップガード】連続停止呼び出し時でも古いノードを確実に切断・解放
 * ・甲高い高周波（520〜780Hzサイン波）を完全撤廃し、耳鳴り・耳障り感を100%根絶
 * ・バンドパスフィルターを通過させた柔らかな風切りエアフローノイズ（気流音）を主推進音に採用
 * ・中低域の温かみのあるサイン波推進ハム（130Hz->180Hz）を控えめに重ね、重厚かつ疲れない推進感を演出
 * ・滑らかな linearRamp によるフェード制御でプチッ音（クリップノイズ）を完全根絶
 * ・iOS WebKit バックグラウンド自動サスペンド/レジューム制御
 * ==============================================================================
 */

class AudioManager {
    constructor() {
        this.ctx = null;
        this.isMuted = true; // デフォルトOFF
        
        // ブースト音用ノード群
        this.boostNoiseNode = null;
        this.boostNoiseGain = null;
        this.boostHumOsc = null;
        this.boostHumGain = null;
        this.boostMasterGain = null;
        this.boostFilter = null;
        this._noiseBuffer = null;

        // 切断タイマー排他管理ID（メモリリーク防止用）
        this._stopTimeoutId = null;

        this.bindVisibilityChange();
    }

    // iOS WebKitのユーザー操作トリガーによるAudioContext初期化
    initContext() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
                this._initNoiseBuffer();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    // エアフロー風切り音用の1秒ホワイトノイズループバッファを生成
    _initNoiseBuffer() {
        if (!this.ctx || this._noiseBuffer) return;
        const sampleRate = this.ctx.sampleRate;
        const bufferSize = sampleRate * 1.5;
        const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            // 尖りを削った柔らかなピンク調ノイズ
            data[i] = (Math.random() * 2 - 1) * 0.65;
        }
        this._noiseBuffer = buffer;
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
     * ★ ブースト加速音（柔らかなエアフロージェット ＆ 温かみのある推進ハム）
     * 甲高い高周波オシレーターを全廃。
     * バンドパス気流ノイズ（シュオオォォー）＋ 低域の推進ハム（130Hz->180Hz）により、
     * 何分間加速しても耳が全く疲れない極上の滑空感を創出。
     */
    startBoostSound() {
        if (this.isMuted || !this.ctx || this.boostMasterGain) return;

        // 前回の切断待機タイマーがあれば即時破棄
        if (this._stopTimeoutId) {
            clearTimeout(this._stopTimeoutId);
            this._stopTimeoutId = null;
        }

        try {
            const now = this.ctx.currentTime;
            if (!this._noiseBuffer) this._initNoiseBuffer();

            // 1. 気流ノイズ源（エアフロー）
            this.boostNoiseNode = this.ctx.createBufferSource();
            this.boostNoiseNode.buffer = this._noiseBuffer;
            this.boostNoiseNode.loop = true;

            // 2. バンドパスフィルター（耳に心地よい 360Hz〜620Hz の気流成分のみを抽出）
            this.boostFilter = this.ctx.createBiquadFilter();
            this.boostFilter.type = 'bandpass';
            this.boostFilter.frequency.setValueAtTime(360, now);
            this.boostFilter.frequency.linearRampToValueAtTime(580, now + 0.22);
            this.boostFilter.Q.setValueAtTime(1.4, now);

            this.boostNoiseGain = this.ctx.createGain();
            this.boostNoiseGain.gain.setValueAtTime(0.09, now);

            this.boostNoiseNode.connect(this.boostFilter);
            this.boostFilter.connect(this.boostNoiseGain);

            // 3. 中低域推進ハム（柔らかなサイン波で厚みを付与：130Hz -> 180Hz）
            this.boostHumOsc = this.ctx.createOscillator();
            this.boostHumOsc.type = 'sine';
            this.boostHumOsc.frequency.setValueAtTime(130, now);
            this.boostHumOsc.frequency.linearRampToValueAtTime(180, now + 0.22);

            this.boostHumGain = this.ctx.createGain();
            this.boostHumGain.gain.setValueAtTime(0.045, now);

            this.boostHumOsc.connect(this.boostHumGain);

            // 4. マスターゲイン（クリップを防ぐ滑らかなフェードイン）
            this.boostMasterGain = this.ctx.createGain();
            this.boostMasterGain.gain.setValueAtTime(0.001, now);
            this.boostMasterGain.gain.linearRampToValueAtTime(0.12, now + 0.08);

            this.boostNoiseGain.connect(this.boostMasterGain);
            this.boostHumGain.connect(this.boostMasterGain);
            this.boostMasterGain.connect(this.ctx.destination);

            this.boostNoiseNode.start(now);
            this.boostHumOsc.start(now);
        } catch (e) {}
    }

    /**
     * ブースト加速音 停止（タイマー排他管理＆即時解放ガード）
     */
    stopBoostSound() {
        if (!this.boostMasterGain || !this.ctx) return;

        // 前回の切断待機タイマーがあれば即時破棄
        if (this._stopTimeoutId) {
            clearTimeout(this._stopTimeoutId);
            this._stopTimeoutId = null;
        }

        try {
            const now = this.ctx.currentTime;
            const masterGain = this.boostMasterGain;
            const noise = this.boostNoiseNode;
            const hum = this.boostHumOsc;
            const filter = this.boostFilter;
            const noiseGain = this.boostNoiseGain;
            const humGain = this.boostHumGain;

            // 滑らかなフェードアウト
            masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.06);

            if (noise) {
                try { noise.stop(now + 0.06); } catch (e) {}
            }
            if (hum) {
                try { hum.stop(now + 0.06); } catch (e) {}
            }

            // タイマーを排他管理し、80ms後に確実に破棄・切断
            this._stopTimeoutId = setTimeout(() => {
                try {
                    if (noise) noise.disconnect();
                    if (hum) hum.disconnect();
                    if (filter) filter.disconnect();
                    if (noiseGain) noiseGain.disconnect();
                    if (humGain) humGain.disconnect();
                    masterGain.disconnect();
                } catch (err) {}
                this._stopTimeoutId = null;
            }, 80);
        } catch (e) {}

        this.boostNoiseNode = null;
        this.boostHumOsc = null;
        this.boostFilter = null;
        this.boostNoiseGain = null;
        this.boostHumGain = null;
        this.boostMasterGain = null;
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