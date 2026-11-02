/**
 * ==============================================================================
 * 『くねくねバトル オンライン』一体型HUD ＆ 自機中心相対追従レーダー (hud.js)
 * v25.7.0 自機カスタムカラー完全連動＆高視認性ゴールド方向ポインター版:
 * ・【自機カスタムカラー完全連動】レーダー中央の自機マークコアに player.color（選択カラー）を反映
 * 　ピンク、ライム、紫など、CUSTOMメニューで選んだ本体色がミニマップ上でも直感的に一致
 * ・自機マークの外枠にクッキリとした白色リング（#ffffff）を配備し、暗い背景でも埋もれない高い視認性を両立
 * ・【AI人間誤判定根絶】マルチ有効かつ slots[s.id] が人間（!isAI）である場合のみ二重リング描画
 * ・ソロプレイ時や空き枠AI（ID: 1〜5）が誤って他ユーザー表示される不具合を100%排除
 * ・【方向マーカー】自機リングの外側へ突き出す高輝度ゴールド矢印（#fde047）＋黒輪郭線を完全維持
 * ・カメラ視野枠の極薄ハイライト＋四隅フォーカス枠（[ ]）維持
 * ・描画負荷軽減：2フレームに1回（30FPS）描画スロットリング ＆ Offscreen キャッシュ維持
 * ==============================================================================
 */

import { MAX_PLAYERS } from './constants.js';
import { NetworkManager } from './network.js';

export class HUDManager {
    constructor() {
        this.showMap = true;
        this.showRanking = false;
        this.radarSize = 140; // 索敵用大型レーダーサイズ
        this.radarMargin = 14;
        
        // 描画負荷軽減: レーダー描画をキャッシュし、2フレームに1回の更新（30FPS）へスロットリングするための内部キャンバス
        this.radarCanvas = document.createElement('canvas');
        this.radarCanvas.width = this.radarSize;
        this.radarCanvas.height = this.radarSize;
        this.radarCtx = this.radarCanvas.getContext('2d', { alpha: true });
        this.radarFrameCount = 0;

        // ゼロアロケーション用トップエネミー固定参照バッファ（最大5体）
        this.topEnemiesPool = new Array(5).fill(null);
        this.topEnemyCount = 0;
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
     * 自機カラー連動・人間厳格識別・ゴールド方向ポインター・カメラ視野ハイライト版
     */
    drawRadar(ctx, canvasWidth, safeTop, player, otherEntities, cameraScale) {
        if (!this.showMap || !player) return;

        const rx = canvasWidth - this.radarSize - this.radarMargin;
        const ry = safeTop;

        // スロットリング: 2フレームに1回（30FPS）だけ内部キャンバスを更新
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

            // 1. トップエネミーの抽出（スコア上位5体）
            this.topEnemyCount = 0;
            const targetMinScore = player.score * 1.15;

            if (otherEntities && otherEntities.length > 0) {
                const len = otherEntities.length;
                for (let i = 0; i < len; i++) {
                    const s = otherEntities[i];
                    if (s === player || s.isDead || s.isPlayer || s.score <= targetMinScore) continue;

                    if (this.topEnemyCount < 5) {
                        this.topEnemiesPool[this.topEnemyCount++] = s;
                    } else {
                        let minIdx = 0;
                        let minScore = this.topEnemiesPool[0].score;
                        for (let k = 1; k < 5; k++) {
                            if (this.topEnemiesPool[k].score < minScore) {
                                minScore = this.topEnemiesPool[k].score;
                                minIdx = k;
                            }
                        }
                        if (s.score > minScore) {
                            this.topEnemiesPool[minIdx] = s;
                        }
                    }
                }
            }

            // マルチプレイ状態およびスロットの取得
            const isMultiActive = Boolean(
                NetworkManager.isMultiplayerActive || 
                (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive)
            );
            const netSlots = NetworkManager.slots || (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.slots);

            // 2. 他スネーク（人間プレイヤー ＆ AI）の描画
            if (otherEntities && otherEntities.length > 0) {
                const totalEntities = otherEntities.length;
                for (let i = 0; i < totalEntities; i++) {
                    const s = otherEntities[i];
                    if (s === player || s.isDead) continue;

                    // 人間プレイヤー厳格判定
                    let isHuman = false;
                    if (s.isPlayer) {
                        isHuman = true;
                    } else if (isMultiActive && s.id !== undefined && s.id >= 0 && s.id < MAX_PLAYERS) {
                        const slotData = netSlots ? netSlots[s.id] : null;
                        if (slotData && !slotData.isAI) {
                            isHuman = true;
                        }
                    }

                    const drawX = radarCenter + (s.x - cx) * radarRatio;
                    const drawY = radarCenter + (s.y - cy) * radarRatio;

                    // レーダー枠外クリッピング
                    if (drawX < -8 || drawX > this.radarSize + 8 || drawY < -8 || drawY > this.radarSize + 8) {
                        continue;
                    }

                    if (isHuman) {
                        // 人間プレイヤー描画：動的カスタムカラー ＋ 二重パルスリング
                        const humanColor = s.color || '#ff3366';
                        const pulseScale = 1.0 + Math.sin(this.radarFrameCount * 0.18 + (s.id || 0)) * 0.22;

                        // 外周ネオンパルスリング
                        rCtx.strokeStyle = humanColor;
                        rCtx.lineWidth = 1.4;
                        rCtx.beginPath();
                        rCtx.arc(drawX, drawY, 5.2 * pulseScale, 0, Math.PI * 2);
                        rCtx.stroke();

                        // 中心コア（クッキリ本体色）
                        rCtx.fillStyle = humanColor;
                        rCtx.beginPath();
                        rCtx.arc(drawX, drawY, 3.2, 0, Math.PI * 2);
                        rCtx.fill();

                        // コア中心のホワイトハイライト
                        rCtx.fillStyle = '#ffffff';
                        rCtx.beginPath();
                        rCtx.arc(drawX, drawY, 1.2, 0, Math.PI * 2);
                        rCtx.fill();
                    } else {
                        // AIスネーク描画：格上（赤）／格下（控えめドット）
                        const isBigger = s.score > player.score;
                        let isTopEnemy = false;
                        for (let k = 0; k < this.topEnemyCount; k++) {
                            if (this.topEnemiesPool[k] === s) {
                                isTopEnemy = true;
                                break;
                            }
                        }

                        if (isBigger || isTopEnemy) {
                            // 格上・危険AI（警告レッド）
                            rCtx.fillStyle = '#ef4444';
                            const dotRadius = isTopEnemy ? 2.8 : 2.3;
                            rCtx.beginPath();
                            rCtx.arc(drawX, drawY, dotRadius, 0, Math.PI * 2);
                            rCtx.fill();
                        } else {
                            // 格下・餌候補AI（控えめな半透明スレートシアン）
                            rCtx.fillStyle = 'rgba(56, 189, 248, 0.45)';
                            rCtx.beginPath();
                            rCtx.arc(drawX, drawY, 1.6, 0, Math.PI * 2);
                            rCtx.fill();
                        }
                    }
                }
            }

            // 3. 自機の画面カメラ視野枠（自然なカメラ画角ハイライト ＋ フォーカス枠）
            const camRectW = viewW * radarRatio;
            const camRectH = viewH * radarRatio;
            const left = radarCenter - camRectW / 2;
            const top = radarCenter - camRectH / 2;

            // 画面内エリアの極薄シアンハイライト
            rCtx.fillStyle = 'rgba(56, 189, 248, 0.07)';
            rCtx.fillRect(left, top, camRectW, camRectH);

            // 四隅のカメラフォーカスブラケット（[ ] 形状）
            const bracketLen = Math.max(3, Math.min(6, Math.min(camRectW, camRectH) * 0.25));
            rCtx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
            rCtx.lineWidth = 1.2;
            rCtx.beginPath();
            // 左上
            rCtx.moveTo(left, top + bracketLen);
            rCtx.lineTo(left, top);
            rCtx.lineTo(left + bracketLen, top);
            // 右上
            rCtx.moveTo(left + camRectW - bracketLen, top);
            rCtx.lineTo(left + camRectW, top);
            rCtx.lineTo(left + camRectW, top + bracketLen);
            // 左下
            rCtx.moveTo(left, top + camRectH - bracketLen);
            rCtx.lineTo(left, top + camRectH);
            rCtx.lineTo(left + bracketLen, top + camRectH);
            // 右下
            rCtx.moveTo(left + camRectW - bracketLen, top + camRectH);
            rCtx.lineTo(left + camRectW, top + camRectH);
            rCtx.lineTo(left + camRectW, top + camRectH - bracketLen);
            rCtx.stroke();

            // 4. 自機中心ドット ＆ 進行方向コンパスポインター（▲）
            const pAngle = (player.angle !== undefined) ? player.angle : 0;
            const arrowTipDist = 18.0;
            const arrowWingDist = 7.5;
            const arrowWingAngle = 0.45;
            const arrowBaseDist = 6.5;

            const tipX = radarCenter + Math.cos(pAngle) * arrowTipDist;
            const tipY = radarCenter + Math.sin(pAngle) * arrowTipDist;
            const wingLeftX = radarCenter + Math.cos(pAngle - arrowWingAngle) * arrowWingDist;
            const wingLeftY = radarCenter + Math.sin(pAngle - arrowWingAngle) * arrowWingDist;
            const baseNotchX = radarCenter + Math.cos(pAngle) * arrowBaseDist;
            const baseNotchY = radarCenter + Math.sin(pAngle) * arrowBaseDist;
            const wingRightX = radarCenter + Math.cos(pAngle + arrowWingAngle) * arrowWingDist;
            const wingRightY = radarCenter + Math.sin(pAngle + arrowWingAngle) * arrowWingDist;

            // ステルスコンパス形状：高輝度ゴールドイエロー ＋ 黒輪郭線
            rCtx.beginPath();
            rCtx.moveTo(tipX, tipY);
            rCtx.lineTo(wingLeftX, wingLeftY);
            rCtx.lineTo(baseNotchX, baseNotchY);
            rCtx.lineTo(wingRightX, wingRightY);
            rCtx.closePath();

            rCtx.fillStyle = '#fde047'; // 高輝度ゴールドイエロー
            rCtx.fill();

            rCtx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
            rCtx.lineWidth = 1.8;
            rCtx.lineJoin = 'round';
            rCtx.stroke();

            // ★ 自機マーク：選択されたカスタムカラー（player.color）と完全連動
            const myColor = player.color || '#00e5ff';

            // 外枠：白色の高コントラストリング（背景やカメラ枠との境界をクッキリ分離）
            rCtx.strokeStyle = '#ffffff';
            rCtx.lineWidth = 1.5;
            rCtx.beginPath();
            rCtx.arc(radarCenter, radarCenter, 4.8, 0, Math.PI * 2);
            rCtx.stroke();

            // 中心コア：選択したカスタムカラー
            rCtx.fillStyle = myColor;
            rCtx.beginPath();
            rCtx.arc(radarCenter, radarCenter, 3.4, 0, Math.PI * 2);
            rCtx.fill();

            // コア中央の微小ハイライト（ツヤ感演出）
            rCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            rCtx.beginPath();
            rCtx.arc(radarCenter, radarCenter, 1.2, 0, Math.PI * 2);
            rCtx.fill();

            // 5. レーダー外枠
            rCtx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
            rCtx.lineWidth = 1.5;
            rCtx.strokeRect(0, 0, this.radarSize, this.radarSize);
        }

        this.radarFrameCount++;

        // メインCanvasにはキャッシュされた画像を高速転送
        ctx.drawImage(this.radarCanvas, rx, ry);
    }
}