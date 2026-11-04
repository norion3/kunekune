// ==============================================================================
// 『くねくねバトル オンライン』スネークエンティティクラス (snake.js)
// v34.0.0 相手マイアイコン顔(user_avatar)Canvas完全描画＆無敵シールド版:
// ・【相手マイアイコン顔(user_avatar)のCanvas完全描画】
// 　リモート走者がマイアイコン顔を選択した際、手元のスロット情報（NetworkManager.slots）
// 　にある相手の portrait URL から動的に Image オブジェクトを遅延生成・キャッシュ（avatarImg）。
// 　ホスト・ゲスト双方の頭部へ相手自身のアバターアイコンを真円クリップで100%確実に描画！
// ・【デバッグ用無敵シールド(isGodMode)維持】外壁死スキップ＆不死身判定
// ・【ブースト肉片ドロップの復元維持】身を削る加速と餌散布
// ・【巨大化時の旋回慣性（ジャイアントキリング）維持】
// ・【外壁激突即死判定維持】
// ・【とぐろ立体感＆生体ウロコ重なりレイヤード描画維持】
// ・【中心コアハイライトライン維持】
// ・【ゼロ負荷設計＆生体テーパーウェーブ完全維持】
// ==============================================================================

import { BASE_SPEED, BOOST_SPEED_MULT, TURN_SPEED_PLAYER, MAP_SIZE, SNAKE_COLORS } from './constants.js';
import { drawSnakeFace } from './snake_face.js';

const MAX_HISTORY = 2048; // リングバッファ最大長

/**
 * 頭上バッジ用スコア短縮フォーマッター
 */
function formatBadgeScore(val) {
    const s = Math.floor(val || 0);
    if (s >= 1000000) {
        return (s / 1000000).toFixed(1).replace(/\.0$/, '') + 'M pt';
    }
    if (s >= 10000) {
        return (s / 1000).toFixed(1).replace(/\.0$/, '') + 'k pt';
    }
    return `${s.toLocaleString()} pt`;
}

export class Snake {
    constructor(isPlayer = false, id = 0, name = '', color = '#00e5ff', face = 'normal') {
        this.isPlayer = isPlayer;
        this.id = id;
        this.name = name || (isPlayer ? 'あなた' : `CPU ${id}`);
        this.color = color;
        this.face = face;
        this.internalUid = isPlayer ? 'local_user' : null;

        this.x = MAP_SIZE / 2;
        this.y = MAP_SIZE / 2;
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;
        this.speed = BASE_SPEED;
        this.turnSpeed = isPlayer ? TURN_SPEED_PLAYER : 0.08;

        this.score = 50;
        this.size = 14;
        this.targetLength = 16;
        
        // ゼロアロケーション・リングバッファ
        this.history = new Array(MAX_HISTORY);
        this.headIdx = 0;
        this.historyLength = 0;
        
        this.distCounter = 0;
        this.maxSize = this.size;
        
        // ブースト時の肉片ドロップ用カウンター
        this.boostDropCounter = 0;

        this.isDead = false;
        this.kills = 0;
        this.isBoosting = false;
        this._prevBoostingState = false; // ブースト状態変化検知用
        this.isVisible = true;

        this.invulnerableTimer = 0;
        // ★ デバッグ用無敵シールド（デフォルトON）
        this.isGodMode = isPlayer ? true : false;

        this.aiLevel = isPlayer ? 0 : (Math.floor(Math.random() * 3) + 1);
        this.aiChangeTimer = Math.floor(Math.random() * 30);

        // 頭上バッジ描画用テキスト計測キャッシュ
        this._cachedBadgeScore = -1;
        this._cachedBadgeName = '';
        this._cachedBadgeWidth = 60;

        // ★ リモート走者のマイアイコン顔（user_avatar）用画像キャッシュ
        this.avatarImg = null;
        this._lastAvatarUrl = '';
    }

    reset(spawnX, spawnY) {
        this.x = spawnX;
        this.y = spawnY;
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;
        this.score = 50;
        this.recalculateSize();
        this.maxSize = this.size;
        
        // リングバッファの初期化（再利用）
        this.headIdx = 0;
        this.historyLength = 0;
        
        this.distCounter = 0;
        this.boostDropCounter = 0;
        this.isDead = false;
        this.kills = 0;
        this.isBoosting = false;
        this._prevBoostingState = false;
        this.isVisible = true;
        
        this.speed = BASE_SPEED;
        this.invulnerableTimer = 3.0;
        this.aiChangeTimer = Math.floor(Math.random() * 30);

        this._cachedBadgeScore = -1;
        this._cachedBadgeName = '';
    }

    /**
     * ★ ワープ補正用：胴体履歴の一括平行移動API
     * 通信ラグ復旧や大距離テレポート時、体長を消去せずに形状を維持したまま座標を追従させる
     * @param {number} dx X軸移動差分
     * @param {number} dy Y軸移動差分
     */
    shiftHistory(dx, dy) {
        const histLen = this.historyLength || 0;
        for (let i = 0; i < histLen; i++) {
            const idx = (this.headIdx + i) % MAX_HISTORY;
            const pt = this.history[idx];
            if (pt) {
                pt.x += dx;
                pt.y += dy;
            }
        }
    }

    /**
     * サイズ＆体長計算
     * スコア上昇時に頭部と首回りの太さがしっかりと成長し、巨大化の快感をダイレクトに伝える
     */
    recalculateSize() {
        this.size = 12 + Math.pow(this.score, 0.46) * 0.40;
        this.targetLength = 10 + Math.floor(Math.pow(this.score, 0.54) * 0.44);
        if (this.size > this.maxSize) this.maxSize = this.size;
    }

    addScore(val) {
        this.score += val;
        this.recalculateSize();
    }

    die() {
        // 無敵モードがONの場合は死亡処理を完全にブロック
        if (this.isGodMode) return;
        this.isDead = true;
    }

    /**
     * 完全DeltaTime物理演算
     * @param {number|null} arg1 dtSec または inputAngle
     * @param {number|boolean|null} arg2 inputAngle または boostActive
     * @param {boolean} [arg3] boostActive
     */
    updatePhysics(arg1, arg2, arg3) {
        if (this.isDead) return;

        let dtSec = 1 / 60;
        let inputAngle = null;
        let boostActive = false;

        if (arguments.length >= 3 || typeof arg3 === 'boolean') {
            dtSec = (typeof arg1 === 'number' && arg1 > 0) ? Math.min(arg1, 0.1) : (1 / 60);
            inputAngle = (typeof arg2 === 'number') ? arg2 : null;
            boostActive = Boolean(arg3);
        } else {
            inputAngle = (typeof arg1 === 'number') ? arg1 : null;
            boostActive = Boolean(arg2);
            dtSec = 1 / 60;
        }

        const timeScale = Math.max(0.1, Math.min(3.0, dtSec * 60));

        if (this.invulnerableTimer > 0) {
            this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dtSec);
        }

        const newBoostingState = boostActive && this.score > 60;

        if (this.isPlayer && this._prevBoostingState !== newBoostingState) {
            this._prevBoostingState = newBoostingState;
            if (typeof window !== 'undefined' && window.NetworkManager && typeof window.NetworkManager.forceImmediateSync === 'function') {
                window.NetworkManager.forceImmediateSync();
            }
        }

        this.isBoosting = newBoostingState;
        
        const dynamicBaseSpeed = Math.max(3.6, 3.4 + (12.0 / Math.max(10, this.size)));
        const currentSpeed = this.isBoosting ? dynamicBaseSpeed * BOOST_SPEED_MULT : dynamicBaseSpeed;
        this.speed = currentSpeed;

        if (this.isBoosting) {
            const scoreCost = 0.35 * timeScale;
            this.score = Math.max(50, this.score - scoreCost);
            this.recalculateSize();

            // =========================================================================
            // ★ 【ブースト肉片ドロップの復元】
            // 自分のスコア（身）を削って加速する際、尾の位置から餌をドロップする
            // =========================================================================
            this.boostDropCounter += scoreCost;
            if (this.boostDropCounter >= 2.5 && this.score > 65) {
                this.boostDropCounter = 0;
                
                // 尻尾の座標を取得してドロップ
                const tailIdx = (this.headIdx + this.historyLength - 1 + MAX_HISTORY) % MAX_HISTORY;
                const tailPt = this.history[tailIdx];
                
                if (tailPt) {
                    if (this.isPlayer && typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive) {
                        const colorIdx = Math.max(0, SNAKE_COLORS.indexOf(this.color));
                        window.NetworkManager.queueDropFood(tailPt.x, tailPt.y, 2.5, colorIdx);
                    } else if (typeof window !== 'undefined' && window.currentWorldInstance) {
                        window.currentWorldInstance.dropFoods.push({
                            x: tailPt.x + (Math.random() - 0.5) * 10,
                            y: tailPt.y + (Math.random() - 0.5) * 10,
                            val: 2.5,
                            size: 4.5,
                            isBig: true,
                            isLargeAura: false,
                            color: this.color,
                            spawnTime: performance.now()
                        });
                    }
                }
            }
        }

        if (inputAngle !== null) {
            this.targetAngle = inputAngle;
        }

        // =========================================================================
        // ★ 【巨大化時の旋回慣性（ジャイアントキリング・バランス調整）】
        // =========================================================================
        const dynamicTurnMultiplier = Math.max(0.35, 14.0 / Math.max(14.0, this.size));
        const currentTurnSpeed = (this.isPlayer ? TURN_SPEED_PLAYER : 0.08) * dynamicTurnMultiplier;

        let diff = this.targetAngle - this.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.angle += Math.sign(diff) * Math.min(Math.abs(diff), currentTurnSpeed * timeScale);

        this.x += Math.cos(this.angle) * (this.speed * timeScale);
        this.y += Math.sin(this.angle) * (this.speed * timeScale);

        // =========================================================================
        // 【外壁（マップ境界）激突判定】
        // isGodMode が ON または無敵時間中の場合は死亡せず安全にクランプ＆跳ね返し
        // =========================================================================
        const wallMin = this.size;
        const wallMax = MAP_SIZE - this.size;
        if (this.x <= wallMin || this.x >= wallMax || this.y <= wallMin || this.y >= wallMax) {
            const isProtected = this.isGodMode || (this.invulnerableTimer && this.invulnerableTimer > 0);
            if (!isProtected) {
                this.x = Math.max(wallMin, Math.min(wallMax, this.x));
                this.y = Math.max(wallMin, Math.min(wallMax, this.y));
                this.die();
                return;
            } else {
                // 無敵シールド中または無敵時間中は安全にクランプして押し戻す
                this.x = Math.max(wallMin, Math.min(wallMax, this.x));
                this.y = Math.max(wallMin, Math.min(wallMax, this.y));
                if (!this.isPlayer) {
                    this.targetAngle = Math.atan2(MAP_SIZE / 2 - this.y, MAP_SIZE / 2 - this.x);
                }
            }
        }

        this.distCounter += this.speed * timeScale;
        const stepDist = this.size * 0.58;
        if (this.distCounter >= stepDist) {
            this.distCounter = 0;
            
            this.headIdx = (this.headIdx - 1 + MAX_HISTORY) % MAX_HISTORY;
            let pt = this.history[this.headIdx];
            if (!pt) {
                pt = { x: this.x, y: this.y, angle: this.angle };
                this.history[this.headIdx] = pt;
            } else {
                pt.x = this.x; pt.y = this.y; pt.angle = this.angle;
            }

            if (this.historyLength < this.targetLength) {
                this.historyLength++;
            } else if (this.historyLength > this.targetLength) {
                this.historyLength = this.targetLength;
            }
        }
    }

    /**
     * ★ 新生・立体生体チューブ＆ウロコ重なり描画
     */
    draw(ctx, frameCount, cameraScale = 1.0) {
        if (this.isDead || !this.isVisible) return;

        // ズームアウト時の小型獲物強調パルスリング
        const localPlayer = (typeof window !== 'undefined' && window.localPlayerInstance) ? window.localPlayerInstance : null;
        if (!this.isPlayer && cameraScale < 0.75 && localPlayer && !localPlayer.isDead) {
            if (this.size < localPlayer.size * 0.65 || this.score < localPlayer.score * 0.5) {
                const pulse = 1.0 + Math.sin(frameCount * 0.16 + this.x) * 0.18;
                const ringRadius = Math.max(this.size * 2.2, 18 / cameraScale) * pulse;

                ctx.save();
                ctx.fillStyle = this.color;
                ctx.globalAlpha = 0.15;
                ctx.beginPath();
                ctx.arc(this.x, this.y, ringRadius, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = this.color;
                ctx.lineWidth = Math.max(1.2, 1.8 / cameraScale);
                ctx.globalAlpha = 0.55;
                ctx.beginPath();
                ctx.arc(this.x, this.y, ringRadius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }

        const histLen = this.historyLength;
        const isInvulnerableActive = this.isGodMode || (this.invulnerableTimer > 0);
        const invulnAlpha = isInvulnerableActive
            ? ((Math.floor(Date.now() / 100) % 2 === 0) ? 0.45 : 0.85)
            : 1.0;

        // 1. 【第1層：立体アンダーエッジ（シャドウ輪郭）】
        ctx.globalAlpha = 0.35 * invulnAlpha;
        ctx.fillStyle = '#060212';
        ctx.beginPath();
        for (let i = histLen - 1; i >= 0; i--) {
            const idx = (this.headIdx + i) % MAX_HISTORY;
            const pt = this.history[idx];
            if (!pt) continue;

            const progress = i / histLen;
            const segmentRadius = (this.size * (1 - Math.pow(progress, 3.0) * 0.60)) + 1.8;

            const waveAmplitude = this.size * 0.22;
            const waveOffset = Math.sin(frameCount * 0.15 - i * 0.38) * waveAmplitude;
            const normAngle = (pt.angle || 0) + Math.PI / 2;
            const drawX = pt.x + Math.cos(normAngle) * waveOffset;
            const drawY = pt.y + Math.sin(normAngle) * waveOffset;

            ctx.moveTo(drawX + segmentRadius, drawY);
            ctx.arc(drawX, drawY, segmentRadius, 0, Math.PI * 2);
        }
        ctx.fill();

        // 2. 【第2層：メイン生体ボディ（ウロコ重なりスタッキング）】
        ctx.globalAlpha = 0.88 * invulnAlpha;
        ctx.fillStyle = this.color;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.lineWidth = Math.max(1.0, this.size * 0.08);

        for (let i = histLen - 1; i >= 0; i--) {
            const idx = (this.headIdx + i) % MAX_HISTORY;
            const pt = this.history[idx];
            if (!pt) continue;

            const progress = i / histLen;
            const segmentRadius = this.size * (1 - Math.pow(progress, 3.0) * 0.60);

            const waveAmplitude = this.size * 0.22;
            const waveOffset = Math.sin(frameCount * 0.15 - i * 0.38) * waveAmplitude;
            const normAngle = (pt.angle || 0) + Math.PI / 2;
            const drawX = pt.x + Math.cos(normAngle) * waveOffset;
            const drawY = pt.y + Math.sin(normAngle) * waveOffset;

            ctx.beginPath();
            ctx.arc(drawX, drawY, segmentRadius, 0, Math.PI * 2);
            ctx.fill();
            if (i % 2 === 0 && i !== 0) {
                ctx.stroke();
            }
        }

        // 3. 【第3層：脊椎ネオンコアハイライト（進行軌跡ライン）】
        if (histLen > 2) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
            ctx.lineWidth = Math.max(1.5, this.size * 0.24);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            for (let i = histLen - 1; i >= 0; i--) {
                const idx = (this.headIdx + i) % MAX_HISTORY;
                const pt = this.history[idx];
                if (!pt) continue;

                const waveAmplitude = this.size * 0.22;
                const waveOffset = Math.sin(frameCount * 0.15 - i * 0.38) * waveAmplitude;
                const normAngle = (pt.angle || 0) + Math.PI / 2;
                const drawX = pt.x + Math.cos(normAngle) * waveOffset;
                const drawY = pt.y + Math.sin(normAngle) * waveOffset;

                if (i === histLen - 1) {
                    ctx.moveTo(drawX, drawY);
                } else {
                    ctx.lineTo(drawX, drawY);
                }
            }
            ctx.stroke();
        }

        ctx.globalAlpha = invulnAlpha;

        // 4. 頭部描画
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        // =========================================================================
        // ★ 【GRAVITYユーザーアバター顔スキン（自機＆リモート走者完全対応）】
        // =========================================================================
        if (this.face === 'user_avatar') {
            let targetAvatarImg = null;

            if (this.isPlayer) {
                targetAvatarImg = (window.userAvatarImgInstance && window.userAvatarImgInstance.complete)
                    ? window.userAvatarImgInstance
                    : null;
            } else {
                // リモート走者：手元のスロット情報（portrait）から Image を遅延ロード・キャッシュ
                const netMgr = (typeof window !== 'undefined' && window.NetworkManager) ? window.NetworkManager : null;
                const slotData = (netMgr && netMgr.slots) ? netMgr.slots[this.id] : null;
                const portraitUrl = (slotData && slotData.portrait) ? slotData.portrait : '';

                if (portraitUrl) {
                    if (this._lastAvatarUrl !== portraitUrl || !this.avatarImg) {
                        this._lastAvatarUrl = portraitUrl;
                        const img = new Image();
                        img.crossOrigin = 'anonymous';
                        img.src = portraitUrl;
                        this.avatarImg = img;
                    }
                    if (this.avatarImg && this.avatarImg.complete && this.avatarImg.naturalWidth > 0) {
                        targetAvatarImg = this.avatarImg;
                    }
                }
            }

            if (targetAvatarImg) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(0, 0, this.size, 0, Math.PI * 2);
                ctx.clip();
                ctx.rotate(Math.PI / 2);
                ctx.drawImage(targetAvatarImg, -this.size, -this.size, this.size * 2, this.size * 2);
                ctx.restore();

                ctx.strokeStyle = this.color;
                ctx.lineWidth = 1.8;
                ctx.beginPath();
                ctx.arc(0, 0, this.size, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                // 画像ロード中または未設定時は通常の顔にフォールバック
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.arc(0, 0, this.size, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
                ctx.lineWidth = 1.4;
                ctx.stroke();

                drawSnakeFace(ctx, 'normal', this.size);
            }
        } else {
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(0, 0, this.size, 0, Math.PI * 2);
            ctx.fill();

            // 頭部外縁の立体リング
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.lineWidth = 1.4;
            ctx.stroke();

            drawSnakeFace(ctx, this.face, this.size);
        }

        // ブースト時の頭部発光または無敵シールド時のオーラ
        if (this.isBoosting || this.isGodMode) {
            ctx.strokeStyle = this.isGodMode ? '#fde047' : '#ffffff';
            ctx.lineWidth = this.isGodMode ? 3.0 : 2.5;
            ctx.beginPath();
            ctx.arc(0, 0, this.size, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.restore();
        ctx.globalAlpha = 1.0;

        // 頭上ステータス表示
        this.drawOverheadBadge(ctx);
    }

    drawOverheadBadge(ctx) {
        ctx.save();
        
        const badgeY = this.y - this.size - 18;
        ctx.translate(this.x, badgeY);

        const currentFloorScore = Math.floor(this.score);
        const scoreText = formatBadgeScore(currentFloorScore);
        const nameText = this.name.length > 10 ? this.name.slice(0, 9) + '…' : this.name;

        if (this._cachedBadgeScore !== currentFloorScore || this._cachedBadgeName !== nameText) {
            this._cachedBadgeScore = currentFloorScore;
            this._cachedBadgeName = nameText;
            ctx.font = 'bold 10px sans-serif';
            const scoreW = ctx.measureText(scoreText).width;
            ctx.font = 'bold 9.5px sans-serif';
            const nameW = ctx.measureText(nameText).width;
            this._cachedBadgeWidth = Math.max(54, Math.min(92, Math.max(scoreW, nameW) + 14));
        }

        const badgeW = this._cachedBadgeWidth;
        const badgeH = 25;
        const radius = 6;

        ctx.fillStyle = 'rgba(11, 5, 26, 0.72)';
        ctx.strokeStyle = this.isGodMode ? 'rgba(253, 224, 71, 0.75)' : 'rgba(0, 229, 255, 0.35)';
        ctx.lineWidth = 1.2;

        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(-badgeW / 2, -badgeH / 2, badgeW, badgeH, radius);
        } else {
            ctx.rect(-badgeW / 2, -badgeH / 2, badgeW, badgeH);
        }
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'center';

        ctx.fillStyle = this.isPlayer ? '#fde047' : '#38bdf8';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(scoreText, 0, -2);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.font = 'bold 9.5px sans-serif';
        ctx.fillText(nameText, 0, 9.5);

        ctx.restore();
    }
}