/**
 * ==============================================================================
 * 『くねくねバトル オンライン』Web Audio API プログラム動的音響エンジン (audio.js)
 * v27.0.0 ブースト音響デザイン刷新（マイルド・モーターサウンド版）:
 * ・【マイルド・モーターサウンドへの刷新】
 * 　「サーッ」という薄いノイズを大幅に軽減（ローパスフィルター化＆ゲイン激減）。
 * 　代わりに、サイン波より倍音豊かな「三角波（Triangle）」を120Hzと243Hzの
 * 　2オクターブで重ね合わせ、わずかなデチューン（ズレ）による「うなり（コーラス）」を
 * 　発生させることで、スマホのスピーカーでもハッキリ聞こえる太いエンジン推進音を実現！
 * ・【ブースト点火アタック効果（ピッチドロップ）】
 * 　ブーストボタンを押した瞬間（0.12秒間）、オシレーターのピッチが低音から目標音へ
 * 　「ギュン！」と急上昇するエンベロープを追加し、圧倒的な踏み込み感と加速感を創出
 * ・【効果音スロットリングによるAudioContext飽和・音割れ完全防止維持】
 * ・【メモリリーク完全防止維持】stopBoostSound() 連打時の _stopTimeoutId 排他管理
 * ・【即時クリーンアップガード維持】連続停止呼び出し時の確実なノード切断・解放
 * ・【クリップノイズ防止フェード維持】linearRampToValueAtTime
 * ・【iOS WebKit バックグラウンド自動サスペンド/レジューム維持】
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
        this.boostHumOsc2 = null; // ★コーラス・うなり用サブオシレーター
        this.boostHumGain = null;
        this.boostMasterGain = null;
        this.boostFilter = null;
        this._noiseBuffer = null;

        // 切断タイマー排他管理ID（メモリリーク防止用）
        this._stopTimeoutId = null;

        // 効果音スロットリング用タイムスタンプ（ノード乱立・音割れ防止）
        this._lastEatSmallTime = 0;
        this._lastEatBigTime = 0;

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

    // 小餌取得音（サイン波 880Hz -> 1320Hz の爽快なピコ音、25msスロットリング制御付）
    playEatSmall() {
        if (this.isMuted || !this.ctx) return;

        // 密集地帯での連続発音による音割れ・負荷を防止
        const nowMs = performance.now();
        if (nowMs - this._lastEatSmallTime < 25) return;
        this._lastEatSmallTime = nowMs;

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

    // 巨大餌取得音（三角波 440Hz -> 880Hz -> 1760Hz のリッチな和音、30msスロットリング制御付）
    playEatBig() {
        if (this.isMuted || !this.ctx) return;

        // 密集肉片捕食時のオシレーター飽和・クラッシュを防止
        const nowMs = performance.now();
        if (nowMs - this._lastEatBigTime < 30) return;
        this._lastEatBigTime = nowMs;

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
     * ★ ブースト加速音（マイルド・モーターサウンド）
     * 煩いノイズをローパスフィルターで低域のゴォォ音に抑えつつ、
     * 三角波（Triangle）のうなりとピッチアタックで太く心地よい推進力を創出
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

            // 1. 気流ノイズ源（エアフロー）※大幅に音量を下げて低域寄りへ
            this.boostNoiseNode = this.ctx.createBufferSource();
            this.boostNoiseNode.buffer = this._noiseBuffer;
            this.boostNoiseNode.loop = true;

            // 高周波のサーッという音を削り、低域の風圧感のみを残す
            this.boostFilter = this.ctx.createBiquadFilter();
            this.boostFilter.type = 'lowpass';
            this.boostFilter.frequency.setValueAtTime(300, now);
            this.boostFilter.frequency.linearRampToValueAtTime(450, now + 0.2);

            this.boostNoiseGain = this.ctx.createGain();
            this.boostNoiseGain.gain.setValueAtTime(0.012, now); // ノイズ成分を極小化

            this.boostNoiseNode.connect(this.boostFilter);
            this.boostFilter.connect(this.boostNoiseGain);

            // 2. 中低域推進ハム1（ベース：三角波による太い唸り）
            this.boostHumOsc = this.ctx.createOscillator();
            this.boostHumOsc.type = 'triangle';
            this.boostHumOsc.frequency.setValueAtTime(60, now); // 点火時の低い踏み込み
            this.boostHumOsc.frequency.exponentialRampToValueAtTime(120, now + 0.12); // 急上昇アタック（ギュン！）
            this.boostHumOsc.frequency.linearRampToValueAtTime(124, now + 0.5);

            // 3. 中低域推進ハム2（倍音＆コーラス：1オクターブ上＋デチューン）
            this.boostHumOsc2 = this.ctx.createOscillator();
            this.boostHumOsc2.type = 'triangle';
            this.boostHumOsc2.frequency.setValueAtTime(120, now);
            this.boostHumOsc2.frequency.exponentialRampToValueAtTime(243, now + 0.12); // 数Hzズラしてコーラス効果を生む
            this.boostHumOsc2.frequency.linearRampToValueAtTime(246, now + 0.5);

            this.boostHumGain = this.ctx.createGain();
            this.boostHumGain.gain.setValueAtTime(0.045, now); // 三角波はエネルギーが強いため適切に調整

            this.boostHumOsc.connect(this.boostHumGain);
            this.boostHumOsc2.connect(this.boostHumGain);

            // 4. マスターゲイン（クリップを防ぐ滑らかなフェードイン）
            this.boostMasterGain = this.ctx.createGain();
            this.boostMasterGain.gain.setValueAtTime(0.001, now);
            this.boostMasterGain.gain.linearRampToValueAtTime(0.12, now + 0.08);

            this.boostNoiseGain.connect(this.boostMasterGain);
            this.boostHumGain.connect(this.boostMasterGain);
            this.boostMasterGain.connect(this.ctx.destination);

            this.boostNoiseNode.start(now);
            this.boostHumOsc.start(now);
            this.boostHumOsc2.start(now);
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
            const hum2 = this.boostHumOsc2;
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
            if (hum2) {
                try { hum2.stop(now + 0.06); } catch (e) {}
            }

            // タイマーを排他管理し、80ms後に確実に破棄・切断
            this._stopTimeoutId = setTimeout(() => {
                try {
                    if (noise) noise.disconnect();
                    if (hum) hum.disconnect();
                    if (hum2) hum2.disconnect();
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
        this.boostHumOsc2 = null;
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