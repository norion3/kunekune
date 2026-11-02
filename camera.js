// ==============================================================================
// 『くねくねバトル オンライン』カメラ制御＆ワールド描画マネージャー (camera.js)
// v27.6.0 3段階マルチスケールグリッド＆ダイナミック対数ズーム版:
// ・【3段階マルチスケールグリッド】シングル版の秀逸な背景演出を採用
// 　近景用(100px)、中景用(400px)、超遠景用メガグリッド(2000px)の3層構造へ刷新
// 　ズームアウトするほど細線が自然に消え、太いネオンメガグリッドが浮かび上がることで、
// 　深宇宙を泳ぐ巨大スネークの圧倒的なスケール感とモアレ（網目チラつき）防止を両立
// ・【対数ズーム(Logarithmic Zoom)】スコア1万〜100万時の壮大なズームアウト視野角を完全維持
// ・【完全DeltaTime観戦追従】観戦カメラのターゲット追従速度を実経過秒数(dtSec)に完全同期
// ・背景クリア、カメラトランスフォーム（begin / end）、外壁境界線描画
// ==============================================================================

import { MAP_SIZE } from './constants.js';

export class CameraManager {
    constructor() {
        this.spectatorCamX = MAP_SIZE / 2;
        this.spectatorCamY = MAP_SIZE / 2;
        this.scale = 1.0;
    }

    /**
     * スポーン時・リスポーン時のカメラ位置初期化
     * @param {number} x 
     * @param {number} y 
     */
    reset(x, y) {
        this.spectatorCamX = x;
        this.spectatorCamY = y;
        this.scale = 1.0;
    }

    /**
     * カメラ座標および視野スケールの更新（対数ズーム＆DeltaTime対応）
     * @param {Object} player 自機スネークインスタンス
     * @param {Object} killerTargetSnake 撃破した相手スネークインスタンス
     * @param {number} zoomMultiplier 入力マネージャーのズーム倍率
     * @param {number} [dtSec=0.016] 実経過秒数
     */
    update(player, killerTargetSnake, zoomMultiplier, dtSec = 1 / 60) {
        const safeDt = (typeof dtSec === 'number' && dtSec > 0) ? Math.min(dtSec, 0.1) : (1 / 60);

        // 1. 座標の更新（生存時は自機位置、死亡時はキラーまたは死亡地点をスムーズ追従）
        if (player.isDead) {
            if (killerTargetSnake && !killerTargetSnake.isDead) {
                const followLerp = 1.0 - Math.exp(-5.0 * safeDt);
                this.spectatorCamX += (killerTargetSnake.x - this.spectatorCamX) * followLerp;
                this.spectatorCamY += (killerTargetSnake.y - this.spectatorCamY) * followLerp;
            }
        } else {
            this.spectatorCamX = player.x;
            this.spectatorCamY = player.y;
        }

        // 2. ダイナミック対数ズーム（Logarithmic Scaling）
        const currentScore = player.isDead ? 50 : Math.max(50, player.score || 50);
        const logGrowth = Math.log10(currentScore / 50);
        const baseTargetScale = 1.0 / (1.0 + logGrowth * 0.58);

        // 手動ズーム倍率との合成（下限0.10、上限1.60で安全クランプ）
        const finalTargetScale = Math.max(0.10, Math.min(1.60, baseTargetScale * (zoomMultiplier || 1.0)));

        // 指数ラープによる滑らかなズーム追従
        const scaleLerp = 1.0 - Math.exp(-3.2 * safeDt);
        this.scale += (finalTargetScale - this.scale) * scaleLerp;
    }

    /**
     * 現在有効なカメラの中心座標を取得
     * @param {Object} player 
     * @returns {{x: number, y: number}}
     */
    getCenter(player) {
        return {
            x: player.isDead ? this.spectatorCamX : player.x,
            y: player.isDead ? this.spectatorCamY : player.y
        };
    }

    /**
     * 2Dコンテキストへカメラスケールおよび平行移動を適用
     * @param {CanvasRenderingContext2D} ctx 
     * @param {HTMLCanvasElement} canvas 
     * @param {number} camX 
     * @param {number} camY 
     */
    begin(ctx, canvas, camX, camY) {
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(this.scale, this.scale);
        ctx.translate(-camX, -camY);
    }

    /**
     * カメラ座標系の復元
     * @param {CanvasRenderingContext2D} ctx 
     */
    end(ctx) {
        ctx.restore();
    }

    /**
     * 宇宙空間背景の3段階マルチスケールグリッド線および外壁赤枠の描画
     * シングル版の洗練されたスケール演出を完全統合
     * @param {CanvasRenderingContext2D} ctx 
     * @param {number} camLeft 
     * @param {number} camTop 
     * @param {number} viewW 
     * @param {number} viewH 
     */
    drawGrid(ctx, camLeft, camTop, viewW, viewH) {
        const fineGridStep = 100;    // 近景用（細線）
        const coarseGridStep = 400;  // 中景用（標準線）
        const megaGridStep = 2000;   // 巨大ズームアウト時用（メガグリッド）

        // スケールに応じたアルファ透過率の動的計算（モアレチラつき完全防止）
        const fineAlpha = Math.max(0, Math.min(0.06, (this.scale - 0.35) / 0.35 * 0.06));
        const coarseAlpha = this.scale < 0.5 ? Math.min(0.08, (0.5 - this.scale) / 0.25 * 0.06 + 0.02) : 0.02;
        const megaAlpha = this.scale < 0.25 ? Math.min(0.12, (0.25 - this.scale) / 0.15 * 0.10) : 0;

        const endX = camLeft + viewW + megaGridStep;
        const endY = camTop + viewH + megaGridStep;

        // 1. 細グリッド（近景・通常時のみ表示）
        if (fineAlpha > 0.005) {
            const startXFine = Math.floor(camLeft / fineGridStep) * fineGridStep;
            const startYFine = Math.floor(camTop / fineGridStep) * fineGridStep;

            ctx.strokeStyle = `rgba(255, 255, 255, ${fineAlpha})`;
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            for (let x = startXFine; x < endX; x += fineGridStep) {
                ctx.moveTo(x, startYFine); ctx.lineTo(x, endY);
            }
            for (let y = startYFine; y < endY; y += fineGridStep) {
                ctx.moveTo(startXFine, y); ctx.lineTo(endX, y);
            }
            ctx.stroke();
        }

        // 2. 中グリッド（標準〜やや引きの時に主線となる）
        if (coarseAlpha > 0.005) {
            const startXCoarse = Math.floor(camLeft / coarseGridStep) * coarseGridStep;
            const startYCoarse = Math.floor(camTop / coarseGridStep) * coarseGridStep;

            ctx.strokeStyle = `rgba(255, 255, 255, ${coarseAlpha})`;
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            for (let x = startXCoarse; x < endX; x += coarseGridStep) {
                ctx.moveTo(x, startYCoarse); ctx.lineTo(x, endY);
            }
            for (let y = startYCoarse; y < endY; y += coarseGridStep) {
                ctx.moveTo(startXCoarse, y); ctx.lineTo(endX, y);
            }
            ctx.stroke();
        }

        // 3. メガグリッド（巨大化時・超広大視野時に宇宙の骨格として浮かび上がる）
        if (megaAlpha > 0.005) {
            const startXMega = Math.floor(camLeft / megaGridStep) * megaGridStep;
            const startYMega = Math.floor(camTop / megaGridStep) * megaGridStep;

            ctx.strokeStyle = `rgba(0, 229, 255, ${megaAlpha})`; // ネオンシアンのメガライン
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            for (let x = startXMega; x < endX; x += megaGridStep) {
                ctx.moveTo(x, startYMega); ctx.lineTo(x, endY);
            }
            for (let y = startYMega; y < endY; y += megaGridStep) {
                ctx.moveTo(startXMega, y); ctx.lineTo(endX, y);
            }
            ctx.stroke();
        }

        // 4. 外壁境界線
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 8;
        ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);
    }
}