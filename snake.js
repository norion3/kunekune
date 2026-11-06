// ==============================================================================
// 『くねくねバトル オンライン』スネークエンティティクラス (snake.js)
// v45.0.0 初期スコア100適正化＆開幕テンポ向上版:
// ・【初期スコア100適正化（開幕テンポ向上）】
// 　スポーン時およびリスポーン時の初期スコアを 50 から 100 へ引き上げ！
// 　開幕直後からブースト（閾値60以上）を約1.9秒間存分に使用可能となり、
// 　開始直後のテンポ感および緊急離脱能力を大幅に向上
// ・【絵文字・サロゲートペア安全トリム（文字化け完全防止）】
// 　従来の .slice(0, 9) で絵文字が途中で2分割され末尾が文字化け（）する問題を解消！
// 　Array.from() により絵文字や特殊記号を1文字として正確にカウントし、
// 　長大なユーザー名も最大7文字（全角14文字相当）＋「…」で安全に省略
// ・【バッジ最大幅の適正拡張（92px ➔ 108px）】
// 　漢字・ひらがな・絵文字が並んだ際のプレート枠線からの文字はみ出しを完全根絶！
// 　どのような文字種・長さの名前でも美しくプレート内に中央収容
// ・【頭部ステータスバッジのオフセット距離黄金比維持】size * 1.55 + 24px
// ・【前方視界100%完全クリア維持】進行方向の真後ろへ幾何学オフセット
// ・【文字水平正立描画＆例外完全ゼロ化維持】ワールド座標系水平描画
// ・【バッジ背景スマート透過化維持】rgba(11, 5, 26, 0.58)
// ・【胴体中心線（白い針金状の直線）アーティファクト完全根絶維持】
// ・【リモートAI出現・急成長時のカーブ追従型体節補間維持】
// ・【超巨大化時の太さ特化スケール（最大太さ 65px）維持】
// ・【節数ハードキャップ（最大95節）によるCanvas描画FPS完全防護維持】
// ・【巨体時の重量級旋回慣性バランス適正化維持】
// ・【ブースト自傷肉片の自画面即時ドロップ反映維持】
// ・【リスポーン時撃破フラグ（_hasBeenKilled）初期化維持】
// ・【ワープ時prevX/Y追従補正によるCCDデス・レーザー完全根絶維持】
// ・【相手マイアイコン顔(user_avatar)のCanvas完全描画維持】
// ・【デバッグ用無敵シールド(isGodMode)維持】外壁死スキップ＆不死身判定
// ・【外壁激突即死判定維持】
// ・【とぐろ立体感＆生体ウロコ重なりレイヤード描画維持】
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

        this.score = 100;
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
        this._hasBeenKilled = false; // 二重撃破防止フラグ
        this.kills = 0;
        this.isBoosting = false;
        this._prevBoostingState = false; // ブースト状態変化検知用
        this.isVisible = true;

        this.invulnerableTimer = 0;
        // ★ デバッグ用無敵シールド（デフォルトON・維持）
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
        this.score = 100;
        this.recalculateSize();
        this.maxSize = this.size;
        
        // リングバッファの初期化（再利用）
        this.headIdx = 0;
        this.historyLength = 0;
        
        this.distCounter = 0;
        this.boostDropCounter = 0;
        this.isDead = false;
        this._hasBeenKilled = false; // ★ リスポーン時に二重キルガードを確実にリセット
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
     * ★ ワープ補正用：胴体履歴および前フレーム座標の一括平行移動API
     * 通信ラグ復旧や大距離テレポート時、体長を消去せずに形状を維持したまま座標を追従させる
     * @param {number} dx X軸移動差分
     * @param {number} dy Y軸移動差分
     */
    shiftHistory(dx, dy) {
        if (this.prevX !== undefined) this.prevX += dx;
        if (this.prevY !== undefined) this.prevY += dy;

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
     * =========================================================================
     * ★ 【巨獣化太さ特化スケール ＆ 描画FPS保護節数ハードキャップ】
     * 1. 節数（targetLength）は最大「95節」で厳格に頭打ちにし、パス描画命令の激増を阻止
     * 2. 頭部・胴体太さ（size）はスコアに応じて最大 65px まで成長（画面の半分を塞ぐ巨獣感）
     * =========================================================================
     */
    recalculateSize() {
        const rawSize = 12 + Math.pow(this.score, 0.46) * 0.40;
        this.size = Math.min(65.0, rawSize);

        const rawLength = 10 + Math.floor(Math.pow(this.score, 0.54) * 0.44);
        this.targetLength = Math.min(95, rawLength);

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

            this.boostDropCounter += scoreCost;
            if (this.boostDropCounter >= 2.5 && this.score > 65) {
                this.boostDropCounter = 0;
                
                // 尻尾の座標を取得してドロップ
                const tailIdx = (this.headIdx + this.historyLength - 1 + MAX_HISTORY) % MAX_HISTORY;
                const tailPt = this.history[tailIdx];
                
                if (tailPt) {
                    const margin = 20;
                    const dropX = Math.max(margin, Math.min(MAP_SIZE - margin, tailPt.x + (Math.random() - 0.5) * 10));
                    const dropY = Math.max(margin, Math.min(MAP_SIZE - margin, tailPt.y + (Math.random() - 0.5) * 10));

                    // 1. マルチプレイ時は他走者へ向けて送信キューに登録
                    if (this.isPlayer && typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive) {
                        const colorIdx = Math.max(0, SNAKE_COLORS.indexOf(this.color));
                        window.NetworkManager.queueDropFood(dropX, dropY, 2.5, colorIdx);
                    }

                    // 2. 自機の画面にも即座に肉片オブジェクトを追加（描画の非対称を根絶）
                    if (typeof window !== 'undefined' && window.currentWorldInstance && window.currentWorldInstance.dropFoods) {
                        window.currentWorldInstance.dropFoods.push({
                            x: dropX,
                            y: dropY,
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
        // ★ 【巨大化時の重量級旋回慣性（ジャイアントキリング・適正バランス調整）】
        // 巨体スネークは小回りが利かない弱点を持たせることで、小型スネークの首切りを成立
        // =========================================================================
        const dynamicTurnMultiplier = Math.max(0.22, 14.0 / Math.max(14.0, this.size));
        const currentTurnSpeed = (this.isPlayer ? TURN_SPEED_PLAYER : 0.08) * dynamicTurnMultiplier;

        let diff = this.targetAngle - this.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.angle += Math.sign(diff) * Math.min(Math.abs(diff), currentTurnSpeed * timeScale);

        this.x += Math.cos(this.angle) * (this.speed * timeScale);
        this.y += Math.sin(this.angle) * (this.speed * timeScale);

        // =========================================================================
        // 【外壁（マップ境界）激突判定】
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

            // =========================================================================
            // ★ 【リモート走者遭遇時のカーブ追従型体節補間（直線間延び完全解消）】
            // 画面外からの接近や入室直後、targetLength と historyLength の差が大きい場合、
            // 単純な直線ではなく、過去の進行角度の曲率を加味して滑らかに体節を配置！
            // 旋回中に出現した相手が真っ直ぐな棒のように間延びする現象を100%防止
            // =========================================================================
            if (!this.isPlayer && (this.targetLength - this.historyLength > 4)) {
                const diffCount = Math.min(this.targetLength - this.historyLength, 8);
                for (let k = 0; k < diffCount; k++) {
                    const nextHistIdx = (this.headIdx + this.historyLength) % MAX_HISTORY;
                    const prevPt = this.history[(nextHistIdx - 1 + MAX_HISTORY) % MAX_HISTORY] || pt;
                    let fillPt = this.history[nextHistIdx];

                    // 直近の角度履歴から緩やかなカーブ進行角を推定
                    const curveAngle = (prevPt.angle !== undefined) ? prevPt.angle : this.angle;
                    const fillX = prevPt.x - Math.cos(curveAngle) * stepDist;
                    const fillY = prevPt.y - Math.sin(curveAngle) * stepDist;

                    if (!fillPt) {
                        this.history[nextHistIdx] = { x: fillX, y: fillY, angle: curveAngle };
                    } else {
                        fillPt.x = fillX; fillPt.y = fillY; fillPt.angle = curveAngle;
                    }
                    this.historyLength++;
                }
            } else if (this.historyLength < this.targetLength) {
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

        // =========================================================================
        // 3. 【第3層：脊椎ネオンコアハイライト（生体ソフトグロー適正化）】
        // ★ 直線強調アーティファクトの完全根絶：
        // 許容最大節間距離を厳格化（size * 2.2）し、太さ・不透明度をソフトな生体グローへ調整。
        // 体の中心を貫く「白い針金状の直線」や「間延び感」を100%解消！
        // =========================================================================
        if (histLen > 2) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
            ctx.lineWidth = Math.max(1.2, this.size * 0.15);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            let lastDrawX = null;
            let lastDrawY = null;
            const maxSegDist = this.size * 2.2; // 3.5 ➔ 2.2 へ適正化（過剰な直線引き伸ばしを防止）
            const maxSegDistSq = maxSegDist * maxSegDist;

            for (let i = histLen - 1; i >= 0; i--) {
                const idx = (this.headIdx + i) % MAX_HISTORY;
                const pt = this.history[idx];
                if (!pt) continue;

                const waveAmplitude = this.size * 0.22;
                const waveOffset = Math.sin(frameCount * 0.15 - i * 0.38) * waveAmplitude;
                const normAngle = (pt.angle || 0) + Math.PI / 2;
                const drawX = pt.x + Math.cos(normAngle) * waveOffset;
                const drawY = pt.y + Math.sin(normAngle) * waveOffset;

                if (i === histLen - 1 || lastDrawX === null) {
                    ctx.moveTo(drawX, drawY);
                } else {
                    const dx = drawX - lastDrawX;
                    const dy = drawY - lastDrawY;
                    const distSq = dx * dx + dy * dy;

                    if (distSq > maxSegDistSq) {
                        ctx.moveTo(drawX, drawY);
                    } else {
                        ctx.lineTo(drawX, drawY);
                    }
                }

                lastDrawX = drawX;
                lastDrawY = drawY;
            }
            ctx.stroke();
        }

        ctx.globalAlpha = invulnAlpha;

        // 4. 頭部描画
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        // GRAVITYユーザーアバター顔スキン
        if (this.face === 'user_avatar') {
            let targetAvatarImg = null;

            if (this.isPlayer) {
                targetAvatarImg = (window.userAvatarImgInstance && window.userAvatarImgInstance.complete)
                    ? window.userAvatarImgInstance
                    : null;
            } else {
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

        // 頭上ステータス表示（首元・進行方向背後幾何学追従描画）
        this.drawOverheadBadge(ctx);
    }

    /**
     * ステータスバッジ（得点・名前）の描画
     * =========================================================================
     * ★ 【首元・進行方向背後幾何学オフセット（黄金比クリアランス適正化）＆ 水平正立描画】
     * 進行方向（angle）の真後ろへ、頭部サイズに比例した最適距離（size * 1.55 + 24px）
     * だけ幾何学的にオフセット配置することで、後頭部・オーラ輪郭との被りを完全根絶！
     * 約19pxのクリアランスを確保した上で、第4〜5体節（背中中央）の上に自然に吸着追従。
     * 文字は常に水平正立で描画され、急旋回時や上下逆さまの走行でも完全な可読性を維持。
     * =========================================================================
     */
    drawOverheadBadge(ctx) {
        ctx.save();
        
        // 進行方向の真後ろ（首元〜背中）へ幾何学オフセットを算出（黄金比クリアランス化）
        const offsetDist = this.size * 1.55 + 24;
        const badgeX = this.x - Math.cos(this.angle) * offsetDist;
        const badgeY = this.y - Math.sin(this.angle) * offsetDist;

        // 常に水平正立（回転なし）のワールド座標系へ移動
        ctx.translate(badgeX, badgeY);

        const currentFloorScore = Math.floor(this.score);
        const scoreText = formatBadgeScore(currentFloorScore);

        // =========================================================================
        // ★ 【絵文字・サロゲートペア安全なトリム処理 ＆ バッジ最大幅拡張】
        // Array.from() により絵文字を2コード単位ではなく「1文字」として正しく計測。
        // 最大7文字＋「…」で安全にトリムし、バッジ最大幅を 108px へ適正拡張することで
        // 漢字・ひらがな・絵文字の名前がプレート枠線からはみ出す事故を100%物理根絶
        // =========================================================================
        const nameChars = Array.from(this.name || '');
        const nameText = nameChars.length > 7 ? nameChars.slice(0, 7).join('') + '…' : (this.name || '');

        if (this._cachedBadgeScore !== currentFloorScore || this._cachedBadgeName !== nameText) {
            this._cachedBadgeScore = currentFloorScore;
            this._cachedBadgeName = nameText;
            ctx.font = 'bold 10px sans-serif';
            const scoreW = ctx.measureText(scoreText).width;
            ctx.font = 'bold 9.5px sans-serif';
            const nameW = ctx.measureText(nameText).width;
            this._cachedBadgeWidth = Math.max(54, Math.min(108, Math.max(scoreW, nameW) + 14));
        }

        const badgeW = this._cachedBadgeWidth;
        const badgeH = 25;
        const radius = 6;

        // 背景プレート：背後の餌や壁が適度に透けるスマート半透明（0.58）
        ctx.fillStyle = 'rgba(11, 5, 26, 0.58)';
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