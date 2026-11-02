/**
 * ==============================================================================
 * 『くねくねバトル オンライン』入力制御モジュール (input.js)
 * v28.1.0 画面全域解放＆ブーストスライド・ゼロ負荷シームレス移行版:
 * ・【画面右側全域の解放】従来の「幅58%制限」を完全撤廃！画面の0%〜100%全域でジョイスティック起動を許可。
 * 　ボタン等の真上以外の余白を触れれば、左右・画面中央問わず意のままにジョイスティックが出現
 * ・【ブーストからジョイスティックへのシームレス移行】ブーストボタンを押したまま指を滑らせて外れた瞬間、
 * 　ブーストを解除し、抜け出た地点を起点として即座にジョイスティックへバトンタッチ（片手操作の完全確立）
 * ・【ゼロ負荷最適化】ブーストボタン中心座標・半径の事前キャッシュ＆二乗距離判定（掛け算2回のみ）を採用。
 * 　touchmove中のリフロー（強制レイアウト再計算）を完全ゼロ化し、スマホの端末差・画面回転にも100%追従
 * ・【マルチタッチ排他ガード】左手でジョイスティック操作中に右手ブーストが外れても、右手がジョイスティックを
 * 　横取りしない安全優先ガードを配備（両手プレイ時の誤爆暴走を完全防止）
 * ・【ボタン実体ピンポイント除外】ボタン真上のみ除外し、ボタン隙間や余白は0ミリ秒で起動
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

        // ブースト状態
        this.boost = false;
        this.boostTouchId = null;

        // ブースト脱出検知用キャッシュ（ゼロ負荷・全機種対応）
        this.boostCenter = { x: 0, y: 0 };
        this.boostRadiusSq = 0;

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

        this.updateBoostButtonBounds();
        window.addEventListener('resize', () => this.updateBoostButtonBounds());

        this.bindTouchEvents();
        this.bindMouseEvents();
        this.bindBoostButton();
    }

    /**
     * 機種サイズ・画面回転に応じたブーストボタン座標の事前キャッシュ
     * touchmove中のリフロー負荷を完全ゼロにする
     */
    updateBoostButtonBounds() {
        if (!this.boostBtn) return;
        const rect = this.boostBtn.getBoundingClientRect();
        this.boostCenter = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        // 判定半径（少し広めにとり指の微小なブレでの誤脱出を防止）
        const radius = (rect.width / 2) * 1.15;
        this.boostRadiusSq = radius * radius;
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

            // 押された瞬間に最新の位置をオンデマンド再確認（機種差・アドレスバー伸縮ガード）
            this.updateBoostButtonBounds();

            if (e.changedTouches && e.changedTouches.length > 0) {
                this.boostTouchId = e.changedTouches[0].identifier;
            }
            setBoost(true);
        }, { passive: false });

        // ブーストボタンからの指の脱出検知（スライド操作のシームレスジョイスティック移行）
        this.boostBtn.addEventListener('touchmove', (e) => {
            if (!this.boost || this.boostTouchId === null) return;
            e.preventDefault();
            e.stopPropagation();

            const t = Array.from(e.touches).find(touch => touch.identifier === this.boostTouchId);
            if (!t) return;

            // ゼロ負荷計算：掛け算2回のみでボタン外への脱出を判定
            const dx = t.clientX - this.boostCenter.x;
            const dy = t.clientY - this.boostCenter.y;
            const distSq = dx * dx + dy * dy;

            if (distSq > this.boostRadiusSq) {
                // ボタンから外れたらブースト解除
                setBoost(false);
                const escapedTouchId = this.boostTouchId;
                this.boostTouchId = null;

                // 他にジョイスティックを動かしていなければ、外れた指を即座にジョイスティックへ引き継ぐ！
                if (!this.active) {
                    if (typeof window !== 'undefined' && window.currentGameState === 'playing') {
                        if (!window.localPlayerInstance || !window.localPlayerInstance.isDead) {
                            const menuOverlay = document.getElementById('menu-overlay');
                            if (!menuOverlay || menuOverlay.style.display !== 'block') {
                                this.touchId = escapedTouchId;
                                this.startJoystick(t.clientX, t.clientY);
                            }
                        }
                    }
                }
            }
        }, { passive: false });

        const endBoost = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            this.boostTouchId = null;
            setBoost(false);
        };

        this.boostBtn.addEventListener('touchend', endBoost, { passive: false });
        this.boostBtn.addEventListener('touchcancel', endBoost, { passive: false });

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
     * ピンポイント実体ヒットテスト（無効エリアの極小化）
     */
    _isUIElement(clientX, clientY) {
        if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
            return false;
        }

        const target = document.elementFromPoint(clientX, clientY);
        if (!target) return false;

        if (target.id === 'game-canvas' || target.id === 'ui-layer' || target.tagName === 'HTML' || target.tagName === 'BODY') {
            return false;
        }

        const isClickableUI = Boolean(target.closest('button, .bottom-round-btn, #btn-boost, .stats-box, #stats-box, .sheet-tabs, .chat-chips-grid, .chat-input-bar'));
        return isClickableUI;
    }

    handleTouchStart(e) {
        if (typeof window !== 'undefined' && window.currentGameState !== 'playing') return;
        if (typeof window !== 'undefined' && window.localPlayerInstance && window.localPlayerInstance.isDead) return;

        const menuOverlay = document.getElementById('menu-overlay');
        if (menuOverlay && menuOverlay.style.display === 'block') return;

        e.preventDefault();

        if (this.active && this.touchId !== null) {
            const isTouchStillPresent = Array.from(e.touches).some(t => t.identifier === this.touchId);
            if (!isTouchStillPresent) {
                this.endJoystick();
            }
        }

        if (!this.active) {
            const touchesToCheck = (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches : e.touches;

            for (let i = 0; i < touchesToCheck.length; i++) {
                const t = touchesToCheck[i];

                // ブースト操作中の指はジョイスティック側で拾わない
                if (this.boostTouchId !== null && t.identifier === this.boostTouchId) continue;

                // ボタン実体の真上は除外（隙間やボタンのすぐ横、余白は全て起動）
                if (this._isUIElement(t.clientX, t.clientY)) continue;

                // ★ 画面幅58%制限を完全撤廃：画面の全域（0%〜100%）どこでも起動可能
                this.touchId = t.identifier;
                this.startJoystick(t.clientX, t.clientY);
                break;
            }
        }
    }

    handleTouchMove(e) {
        e.preventDefault();

        // 動的レスキュー（ボタン上から指を滑らせて外れた瞬間にゼロ遅延起動）
        if (!this.active) {
            if (typeof window !== 'undefined' && window.currentGameState !== 'playing') return;
            if (typeof window !== 'undefined' && window.localPlayerInstance && window.localPlayerInstance.isDead) return;

            const menuOverlay = document.getElementById('menu-overlay');
            if (menuOverlay && menuOverlay.style.display === 'block') return;

            for (let i = 0; i < e.touches.length; i++) {
                const t = e.touches[i];
                if (this.boostTouchId !== null && t.identifier === this.boostTouchId) continue;

                if (!this._isUIElement(t.clientX, t.clientY)) {
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

        if (!e.touches || e.touches.length === 0) {
            this.endJoystick();
            this.boostTouchId = null;
            if (this.boost) {
                this.boost = false;
                if (this.boostBtn) this.boostBtn.classList.remove('active');
                if (this.onBoostChange) this.onBoostChange(false);
            }
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

        // 動的追従アルゴリズム
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