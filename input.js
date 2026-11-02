/**
 * ==============================================================================
 * 『くねくねバトル オンライン』入力制御モジュール (input.js)
 * v28.0.0 ボタン実体ピンポイント除外＆操作不能エリア極小化版:
 * ・【無効エリアの極小化】従来の「幅90px×下部240px」という広大な矩形除外ゾーンを完全撤廃！
 * 　document.elementFromPoint による実体ヒットテストを導入し、ボタン（MENU、音量、リセット等）の
 * 　真上をタップした時のみジョイスティックを遮断。ボタン同士の隙間やボタンのすぐ横を触れた場合は
 * 　0ミリ秒で即座にジョイスティックが起動し、操作不能ストレスを根絶
 * ・【動的レスキュー完全維持】ボタンの上から指を滑らせて外れた瞬間、touchmove 側で即座に検知し
 * 　抜け出た地点を起点としてジョイスティックをシームレス起動
 * ・【初速スワイプ即時反映】タッチ開始直後の指の移動量を即座に入力ベクトル(input.x, y)へ変換し旋回遅延をゼロ化
 * ・【マルチタッチ厳格捕捉】touchstart 時に changedTouches を優先走査し、右手ブースト操作中の左手指捕捉率100%
 * ・【ゴーストアクティブ根絶】画面上の指が0本になった際(e.touches.length === 0)、確実にジョイスティックをリセット
 * ・【ズームレンジ連動】0.20〜1.50 の広域視野連動
 * ==============================================================================
 */

export class InputManager {
    constructor() {
        // ジョイスティック状態
        this.x = 0;
        this.y = 0;
        this.active = false;
        this.touchId = null;
        this.center = { x: 0, y: 0 };
        this.maxRadius = 34;
        this.maxRadiusSq = 34 * 34;

        // ブースト状態（専用ボタン押下時のみ true）
        this.boost = false;

        // 視野ズーム倍率（0.20 〜 1.50）
        this.zoomMultiplier = 1.0;
        this.minZoom = 0.20;
        this.maxZoom = 1.50;

        // DOM参照
        this.canvas = null;
        this.joyBase = null;
        this.joyKnob = null;
        this.boostBtn = null;

        // コールバック
        this.onBoostChange = null; // (isBoosting) => void
    }

    init(canvas, onBoostChange) {
        this.canvas = canvas;
        this.onBoostChange = onBoostChange;
        this.joyBase = document.getElementById('joystick-base');
        this.joyKnob = document.getElementById('joystick-knob');
        this.boostBtn = document.getElementById('btn-boost');

        this.bindTouchEvents();
        this.bindMouseEvents();
        this.bindBoostButton();
    }

    // ブーストボタン専用リスナー
    bindBoostButton() {
        if (!this.boostBtn) return;

        const setBoost = (on) => {
            if (this.boost === on) return;
            this.boost = on;
            this.boostBtn.classList.toggle('active', on);
            if (this.onBoostChange) this.onBoostChange(on);
        };

        this.boostBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setBoost(true);
        }, { passive: false });

        this.boostBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setBoost(false);
        }, { passive: false });

        this.boostBtn.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setBoost(false);
        }, { passive: false });

        this.boostBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            setBoost(true);
        });

        window.addEventListener('mouseup', () => {
            if (this.boost) setBoost(false);
        });
    }

    bindTouchEvents() {
        if (!this.canvas) return;

        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
        this.canvas.addEventListener('touchcancel', (e) => this.handleTouchEnd(e), { passive: false });
    }

    /**
     * ★ ピンポイント実体ヒットテスト（無効エリアの極小化）
     * 大雑把な四角い領域除外を撤廃し、タッチ直下に「実際にボタンが存在する場合のみ」除外
     * ボタンの隙間やボタンのすぐ横を触った場合は false を返し、即座にジョイスティックを発動させる
     * @param {number} clientX 
     * @param {number} clientY 
     * @returns {boolean}
     */
    _isUIElement(clientX, clientY) {
        if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
            return false;
        }

        const target = document.elementFromPoint(clientX, clientY);
        if (!target) return false;

        // CanvasやUIレイヤーそのものは操作可能
        if (target.id === 'game-canvas' || target.id === 'ui-layer' || target.tagName === 'HTML' || target.tagName === 'BODY') {
            return false;
        }

        // ボタン実体、またはHUDパネル上を直接触れている場合のみ除外
        const isClickableUI = Boolean(target.closest('button, .bottom-round-btn, #btn-boost, .stats-box, #stats-box, .sheet-tabs, .chat-chips-grid, .chat-input-bar'));
        return isClickableUI;
    }

    handleTouchStart(e) {
        // 対戦中でない、または自機死亡時はジョイスティック入力を無視
        if (typeof window !== 'undefined' && window.currentGameState !== 'playing') return;
        if (typeof window !== 'undefined' && window.localPlayerInstance && window.localPlayerInstance.isDead) return;

        // メニューが開いている場合はジョイスティックを受け付けない
        const menuOverlay = document.getElementById('menu-overlay');
        if (menuOverlay && menuOverlay.style.display === 'block') return;

        e.preventDefault();

        // 前回のタッチが解放されずに残っていた場合、指リストと照合して安全クリア
        if (this.active && this.touchId !== null) {
            const isTouchStillPresent = Array.from(e.touches).some(t => t.identifier === this.touchId);
            if (!isTouchStillPresent) {
                this.endJoystick();
            }
        }

        if (!this.active) {
            const allowableWidth = window.innerWidth * 0.58;

            // changedTouches（今触れた指）を優先的に走査し、マルチタッチ競合を防止
            const touchesToCheck = (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches : e.touches;

            for (let i = 0; i < touchesToCheck.length; i++) {
                const t = touchesToCheck[i];

                // ★ ボタン実体の真上を直接触れた場合のみ除外（隙間やボタンのすぐ横は除外しない）
                if (this._isUIElement(t.clientX, t.clientY)) continue;

                // 画面左側58%以内であればジョイスティック開始
                if (t.clientX <= allowableWidth) {
                    this.touchId = t.identifier;
                    this.startJoystick(t.clientX, t.clientY);
                    break;
                }
            }
        }
    }

    handleTouchMove(e) {
        e.preventDefault();

        const allowableWidth = window.innerWidth * 0.58;

        // ★ 動的レスキュー処理（ボタン実体の上から指を滑らせて外れた瞬間にゼロ遅延開始）
        if (!this.active) {
            if (typeof window !== 'undefined' && window.currentGameState !== 'playing') return;
            if (typeof window !== 'undefined' && window.localPlayerInstance && window.localPlayerInstance.isDead) return;

            const menuOverlay = document.getElementById('menu-overlay');
            if (menuOverlay && menuOverlay.style.display === 'block') return;

            for (let i = 0; i < e.touches.length; i++) {
                const t = e.touches[i];
                if (!this._isUIElement(t.clientX, t.clientY) && t.clientX <= allowableWidth) {
                    this.touchId = t.identifier;
                    this.startJoystick(t.clientX, t.clientY);
                    break;
                }
            }
            return;
        }

        // アクティブ中の追従移動
        const t = Array.from(e.touches).find(touch => touch.identifier === this.touchId);
        if (t) {
            this.moveJoystick(t.clientX, t.clientY);
        }
    }

    handleTouchEnd(e) {
        e.preventDefault();

        // 画面上に指が1本もなければ確実にジョイスティック終了（ゴースト防止）
        if (!e.touches || e.touches.length === 0) {
            this.endJoystick();
            return;
        }

        if (this.active) {
            const stillActive = Array.from(e.touches).some(t => t.identifier === this.touchId);
            if (!stillActive) {
                this.endJoystick();
            }
        }
    }

    // PC / マウス用フォールバック
    bindMouseEvents() {
        let isMouseDown = false;

        this.canvas.addEventListener('mousedown', (e) => {
            if (typeof window !== 'undefined' && window.currentGameState !== 'playing') return;
            if (typeof window !== 'undefined' && window.localPlayerInstance && window.localPlayerInstance.isDead) return;

            const menuOverlay = document.getElementById('menu-overlay');
            if (menuOverlay && menuOverlay.style.display === 'block') return;

            // ボタン実体の上であれば無視
            if (this._isUIElement(e.clientX, e.clientY)) return;

            isMouseDown = true;
            this.startJoystick(e.clientX, e.clientY);
        });

        window.addEventListener('mousemove', (e) => {
            if (isMouseDown) {
                this.moveJoystick(e.clientX, e.clientY);
            }
        });

        window.addEventListener('mouseup', () => {
            if (isMouseDown) {
                isMouseDown = false;
                this.endJoystick();
            }
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.95 : 1.05;
            this.zoomMultiplier = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomMultiplier * delta));
        }, { passive: false });
    }

    startJoystick(x, y) {
        this.active = true;
        this.center = { x, y };

        if (this.joyBase) {
            this.joyBase.style.display = 'block';
            this.joyBase.style.left = `${x}px`;
            this.joyBase.style.top = `${y}px`;
        }
        if (this.joyKnob) {
            this.joyKnob.style.transform = 'translate(-50%, -50%)';
        }
        this.x = 0;
        this.y = 0;
    }

    moveJoystick(cx, cy) {
        let dx = cx - this.center.x;
        let dy = cy - this.center.y;
        const distSq = dx * dx + dy * dy;

        // 動的追従アルゴリズム：指が最大半径を超えて移動した場合、基点を指の方向へ引っ張り追従
        if (distSq > this.maxRadiusSq) {
            const dist = Math.sqrt(distSq);
            const excess = dist - this.maxRadius;
            const normX = dx / dist;
            const normY = dy / dist;

            this.center.x += normX * excess;
            this.center.y += normY * excess;

            if (this.joyBase) {
                this.joyBase.style.left = `${this.center.x}px`;
                this.joyBase.style.top = `${this.center.y}px`;
            }

            dx = normX * this.maxRadius;
            dy = normY * this.maxRadius;
        }

        if (this.joyKnob) {
            this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        }

        this.x = dx;
        this.y = dy;
    }

    endJoystick() {
        this.active = false;
        this.touchId = null;
        if (this.joyBase) {
            this.joyBase.style.display = 'none';
        }
        this.x = 0;
        this.y = 0;
    }
}