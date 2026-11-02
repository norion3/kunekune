/**
 * ==============================================================================
 * 『くねくねバトル オンライン』入力制御モジュール (input.js)
 * v27.2.0 誤タップ完全遮断＆動的追従ジョイスティック版:
 * ・【UI干渉根絶】左下UIボタングループ領域のタッチ除外判定を拡大（幅90px×下部240px）し、
 * 　MENU・音量ボタン付近でのジョイスティック誤爆（UIスリップ）を完全に防止
 * ・ジョイスティック開始判定を画面左側（幅58%以内）に限定し、右手ブースト操作時の誤爆・操作抜けを100%根絶
 * ・ボトムシートメニュー展開中、死亡時、リザルト画面表示中の背後ジョイスティック誤反応・表示チラつきを完全防止
 * ・スコア10,000〜30,000超の巨大スネーク時でも周囲を広く見渡せるズームレンジ（0.35〜1.50）維持
 * ・指の移動に合わせて基点が滑らかに追従する「動的追従型ジョイスティック」完全維持
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

        // 視野ズーム倍率（0.35 〜 1.50）
        this.zoomMultiplier = 1.0;
        this.minZoom = 0.35;
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

    handleTouchStart(e) {
        // 対戦中でない、または自機死亡時はジョイスティック入力を無視
        if (typeof window !== 'undefined' && window.currentGameState !== 'playing') return;
        if (typeof window !== 'undefined' && window.localPlayerInstance && window.localPlayerInstance.isDead) return;

        // メニューが開いている場合はジョイスティックを受け付けない
        const menuOverlay = document.getElementById('menu-overlay');
        if (menuOverlay && menuOverlay.style.display === 'block') return;

        e.preventDefault();

        if (!this.active && e.touches.length > 0) {
            const allowableWidth = window.innerWidth * 0.58;
            const screenHeight = window.innerHeight;

            for (let i = 0; i < e.touches.length; i++) {
                const t = e.touches[i];

                // ★ 左下UI領域（MENUボタンや音量ボタン）への接触は除外
                // 変更点：領域を (幅80px×下部160px) から (幅90px×下部240px) へ拡大し、誤爆を完全防止
                const isBottomLeftUIZone = (t.clientX <= 90 && t.clientY >= screenHeight - 240);
                if (isBottomLeftUIZone) continue;

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
        if (!this.active) return;
        e.preventDefault();

        const t = Array.from(e.touches).find(touch => touch.identifier === this.touchId);
        if (t) {
            this.moveJoystick(t.clientX, t.clientY);
        }
    }

    handleTouchEnd(e) {
        if (!this.active) return;
        e.preventDefault();

        const stillActive = Array.from(e.touches).some(t => t.identifier === this.touchId);
        if (!stillActive) {
            this.endJoystick();
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

            // 左下UIエリア除外（マウス判定も同様に拡大）
            const isBottomLeftUIZone = (e.clientX <= 90 && e.clientY >= window.innerHeight - 240);
            if (isBottomLeftUIZone) return;

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