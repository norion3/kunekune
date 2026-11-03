// ==============================================================================
// 『くねくねバトル オンライン』カメラ制御＆ワールド描画マネージャー (camera.js)
// v28.8.0 ズーム境界安全クランプ＆超広域描画安定化版:
// ・【ズーム境界安全クランプ適正化】サイズ基準スケールモデルと手動ズーム倍率の
// 　合成下限を旧 0.08 から 0.12 へ引き上げ適正クランプ。
// 　超巨大化＋手動最大ズームアウト時でも浮動小数点誤差による画面モアレや
// 　外壁描画の破綻、極端な縮小による視認性喪失を完全に防止
// ・【巨大化の快感・迫力完全維持】スネークサイズ基準スケールモデル
// 　(60.0 / (60.0 + (size - 12) * 0.82)) により、成長するほど大蛇が逞しく太く
// 　画面上で巨大化していく圧倒的なスケール感と手応えを完全保持
// ・【3段階マルチスケールグリッド完全維持】近景(100px)、中景(400px)、超遠景メガグリッド(2000px)の
// 　動的アルファ透過により、広域視界でもモアレ（網目チラつき）を完全防止
// ・【完全DeltaTime観戦追従】観戦カメラのターゲット追従速度を実経過秒数(dtSec)に完全同期
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
     * カメラ座標および視野スケールの更新（オリジナル巨大化スケールモデル＆DeltaTime対応）
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

        // =========================================================================
        // 2. サイズ基準カメラスケールモデル（巨大化快感の復元 ＆ 境界安全クランプ）
        // スネーク頭部半径（size）の物理的成長に基づき基準スケールを算出
        // =========================================================================
        const currentSize = player.isDead ? 14 : Math.max(14, player.size || 14);
        const baseTargetScale = 60.0 / (60.0 + (currentSize - 12) * 0.82);

        // ★ 手動ズーム倍率との合成（下限を0.12へ適正化し、極小縮小時の描画崩壊を完全防止）
        const finalTargetScale = Math.max(0.12, Math.min(1.80, baseTargetScale * (zoomMultiplier || 1.0)));

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
        const megaAlpha = this.scale < 0.28 ? Math.min(0.12, (0.28 - this.scale) / 0.16 * 0.10) : 0;

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