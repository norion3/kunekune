/**
 * ==============================================================================
 * 『くねくねバトル オンライン』一体型HUD ＆ 自機中心相対追従レーダー (hud.js)
 * v18.0.0 改訂:
 * ・レーダーサイズを 105px から 140px に大型化し、索敵視認性を劇的に向上
 * ・オリジナル復刻: スコア1.2倍以上の「トップエネミー」は視野外でも赤点で遠隔表示
 * ==============================================================================
 */

export class HUDManager {
    constructor() {
        this.showMap = true;
        this.showRanking = false;
        this.radarSize = 140; // ★ オリジナルの良さを活かすため140pxに大型化
        this.radarMargin = 14;
        
        // 💡 描画負荷軽減: レーダー描画をキャッシュし、2フレームに1回の更新（30FPS）へスロットリングするための内部キャンバス
        this.radarCanvas = document.createElement('canvas');
        this.radarCanvas.width = this.radarSize;
        this.radarCanvas.height = this.radarSize;
        this.radarCtx = this.radarCanvas.getContext('2d', { alpha: true });
        this.radarFrameCount = 0;
    }

    init() {
        // stats-box（ランキング詳細）の初期非表示
        const statsBox = document.getElementById('stats-box');
        if (statsBox) {
            statsBox.style.display = this.showRanking ? 'block' : 'none';
        }
    }

    // ランキング表示のON/OFF切り替え
    toggleRanking() {
        this.showRanking = !this.showRanking;
        const statsBox = document.getElementById('stats-box');
        const btnRankToggle = document.getElementById('btn-toggle-ranking');

        if (statsBox) {
            statsBox.style.display = this.showRanking ? 'block' : 'none';
        }
        if (btnRankToggle) {
            btnRankToggle.classList.toggle('active', this.showRanking);
        }
        return this.showRanking;
    }

    // レーダー（ミニマップ）表示のON/OFF切り替え
    toggleMap() {
        this.showMap = !this.showMap;
        const btnMapToggle = document.getElementById('btn-toggle-map');

        if (btnMapToggle) {
            btnMapToggle.classList.toggle('active', this.showMap);
        }
        return this.showMap;
    }

    // スコアと順位のDOM更新
    updateStats(rank, total, score) {
        const valRank = document.getElementById('val-rank');
        const valTotal = document.getElementById('val-total');
        const valScore = document.getElementById('val-score');
        if (valRank) valRank.innerText = rank;
        if (valTotal) valTotal.innerText = total;
        if (valScore) valScore.innerText = Math.floor(score);
    }

    /**
     * 自機中心の相対追従レーダーをメインCanvasに直接描画
     * ★ 描画スロットリング ＆ Offscreen キャッシュ最適化版
     */
    drawRadar(ctx, canvasWidth, safeTop, player, otherEntities, cameraScale) {
        if (!this.showMap || !player) return;

        const rx = canvasWidth - this.radarSize - this.radarMargin;
        const ry = safeTop;

        // 💡 スロットリング: 2フレームに1回（30FPS）だけ内部キャンバスを更新
        if (this.radarFrameCount % 2 === 0) {
            const rCtx = this.radarCtx;
            const radarCenter = this.radarSize / 2;

            // 背景クリア & レーダー背景描画
            rCtx.clearRect(0, 0, this.radarSize, this.radarSize);
            rCtx.fillStyle = 'rgba(11, 5, 26, 0.72)';
            rCtx.fillRect(0, 0, this.radarSize, this.radarSize);

            const viewW = ctx.canvas.width / cameraScale;
            const viewH = ctx.canvas.height / cameraScale;
            const radarRange = Math.max(viewW, viewH) * 4.0;
            const radarRatio = this.radarSize / radarRange;

            const cx = player.x;
            const cy = player.y;

            // ★ オリジナル復刻: 自分よりスコアが1.2倍以上高い上位5体を「トップエネミー」として抽出
            const topEnemies = otherEntities
                .filter(s => !s.isDead && !s.isPlayer && s.score > player.score * 1.2)
                .sort((a, b) => b.score - a.score)
                .slice(0, 5);

            // 敵スネークの描画
            if (otherEntities && otherEntities.length > 0) {
                for (let i = 0; i < otherEntities.length; i++) {
                    const s = otherEntities[i];
                    if (s === player || s.isDead) continue;

                    const isTopEnemy = topEnemies.includes(s);

                    // 視野外の敵は描画しないが、トップエネミーの場合は遠隔表示する
                    if (!s.isVisible && !isTopEnemy) continue;

                    const drawX = radarCenter + (s.x - cx) * radarRatio;
                    const drawY = radarCenter + (s.y - cy) * radarRatio;

                    // 💡 クリップ処理(clip)を廃止し、純粋な座標判定のみで除外（GPU負荷激減）
                    if (drawX < -4 || drawX > this.radarSize + 4 || drawY < -4 || drawY > this.radarSize + 4) {
                        continue;
                    }

                    const isBigger = s.score > player.score;
                    rCtx.fillStyle = isBigger ? '#ff3366' : '#33ccff';
                    const dotRadius = (isTopEnemy && !s.isVisible) ? 1.8 : (isBigger ? 2.8 : 2.0);

                    rCtx.beginPath();
                    rCtx.arc(drawX, drawY, dotRadius, 0, Math.PI * 2);
                    rCtx.fill();
                }
            }

            // 自機の画面カメラ視野枠（白の矩形ライン）を描画
            const camRectW = viewW * radarRatio;
            const camRectH = viewH * radarRatio;
            rCtx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
            rCtx.lineWidth = 1.0;
            rCtx.strokeRect(radarCenter - camRectW / 2, radarCenter - camRectH / 2, camRectW, camRectH);

            // 自機位置（中心に白ドット ＋ シアンパルス）
            rCtx.fillStyle = '#ffffff';
            rCtx.beginPath();
            rCtx.arc(radarCenter, radarCenter, 3.2, 0, Math.PI * 2);
            rCtx.fill();

            rCtx.strokeStyle = '#00e5ff';
            rCtx.lineWidth = 1.2;
            rCtx.beginPath();
            rCtx.arc(radarCenter, radarCenter, 5.0, 0, Math.PI * 2);
            rCtx.stroke();

            // レーダー外枠
            rCtx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
            rCtx.lineWidth = 1.5;
            rCtx.strokeRect(0, 0, this.radarSize, this.radarSize);
        }

        this.radarFrameCount++;

        // ★ メインCanvasにはキャッシュされた画像を貼るだけ（負荷極小）
        ctx.drawImage(this.radarCanvas, rx, ry);
    }
}