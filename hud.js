// ==============================================================================
// 『くねくねバトル オンライン』一体型HUD ＆ 自機中心相対追従レーダー (hud.js)
// v38.0.0 黄金比ライン王冠ピクトグラム（丸枠＋均等3山ストローク線画版）:
// ・【黄金比均等3山ライン王冠（塗りつぶしなし）】
// 　ベタ塗りやくり抜き、過大な装飾を完全撤廃！画面内の既存ボタン（MENU等）と
// 　美しく調和するミニマルな「線画（ストローク）アイコン」として再設計。
// 　幅6.0px : 高さ3.7px（黄金比 1.62 : 1）で均等な高さの3つの山と直線の谷を構築し、
// 　横の間延びや縮小解像度時のトゲ潰れを100%解消
// ・【適正スケール（直径10.4px）への最適化】
// 　自機マーカーや他走者アイコンとスケール感を1:1に統一。他の記号より浮く違和感を根絶
// ・【点滅・波紋オーラ・明滅の完全撤廃】
// 　パルス波紋やチカチカするアニメーションを全廃し、クリアな視界の完全静止表示へ
// ・【枠外ポインターのシンプルシャープ矢印化】
// 　外周ポインターの不要な装飾（ミニメダル・パルス）を排し、各ランク色のシャープな三角矢印（▲）に統一
// ・【絶対座標直描によるCanvasマトリクス破壊・MAP消失の完全根絶維持】
// ・【NaN/Undefined絶対防護＆try-finally描画保証維持】
// ・【自機除外ルール＆王冠表示数の動的整合維持】
// ・【自機中心マークの完全不変性維持】
// ・【1〜3位人間カスタムカラー差し替え＆4位以下完全維持】
// ・【ランキング同期デッドロックの完全解消維持】toggleRanking連動
// ・【カスタムカラー即時マルチ同期維持】
// ・【矢印二重描画の完全根絶維持】
// ・【ゲスト端末でのホスト方向ポインター確実点灯維持】
// ・描画負荷軽減：2フレームに1回（30FPS）描画スロットリング ＆ Offscreen キャッシュ維持
// ==============================================================================

import { MAX_PLAYERS } from './constants.js';
import { NetworkManager } from './network.js';
import { resetLeaderboardCache } from './net_handlers.js';

// ★ 王冠ランク別スタイル定義（高輝度ソリッドラインカラー）
const CROWN_CONFIGS = [
    { rank: 1, color: '#fde047' }, // 1位: 金 (レモンゴールド)
    { rank: 2, color: '#ffffff' }, // 2位: 銀 (アイシーホワイト)
    { rank: 3, color: '#f59e0b' }  // 3位: 銅 (アンバーオレンジ)
];

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

        // =========================================================================
        // ★ 【ランキング展開時のキャッシュクリア・即時再描画トリガー】
        // トロフィーボタンで開いた瞬間にキャッシュを破棄し、最新リストを100%表示
        // =========================================================================
        if (this.showRanking) {
            if (typeof resetLeaderboardCache === 'function') {
                resetLeaderboardCache();
            }
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
     */
    drawRadar(ctx, canvasWidth, safeTop, player, otherEntities, cameraScale) {
        if (!this.showMap || !player) return;

        const rx = canvasWidth - this.radarSize - this.radarMargin;
        const ry = safeTop;

        // スロットリング: 2フレームに1回（30FPS）だけ内部キャンバスを更新
        if (this.radarFrameCount % 2 === 0) {
            try {
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

                const cx = (player && Number.isFinite(player.x)) ? player.x : 0;
                const cy = (player && Number.isFinite(player.y)) ? player.y : 0;

                // =========================================================================
                // ★ 【Top 3 絶対順位マッピング ＆ 自機除外判定】
                // =========================================================================
                const top3Map = new Map();
                let rankCounter = 1;

                if (otherEntities && otherEntities.length > 0) {
                    const totalCount = otherEntities.length;
                    for (let i = 0; i < totalCount && rankCounter <= 3; i++) {
                        const s = otherEntities[i];
                        if (s && !s.isDead) {
                            top3Map.set(s, rankCounter);
                            rankCounter++;
                        }
                    }
                }

                // 1. トップエネミーの抽出（スコア上位5体）
                this.topEnemyCount = 0;
                const targetMinScore = (player.score || 0) * 1.15;

                if (otherEntities && otherEntities.length > 0) {
                    const len = otherEntities.length;
                    for (let i = 0; i < len; i++) {
                        const s = otherEntities[i];
                        if (!s || s === player || s.isPlayer || s.isDead || (s.score || 0) <= targetMinScore) continue;

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

                const isMultiActive = Boolean(
                    NetworkManager.isMultiplayerActive || 
                    (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive)
                );
                const netSlots = NetworkManager.slots || (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.slots);

                // 2. 他スネーク（王冠 Top 3 ＆ 人間プレイヤー ＆ AI）の描画
                if (otherEntities && otherEntities.length > 0) {
                    const totalEntities = otherEntities.length;
                    for (let i = 0; i < totalEntities; i++) {
                        const s = otherEntities[i];
                        if (!s || s === player || s.isPlayer || s.isDead) continue;
                        if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;

                        const dx = s.x - cx;
                        const dy = s.y - cy;
                        const drawX = radarCenter + dx * radarRatio;
                        const drawY = radarCenter + dy * radarRatio;

                        // =========================================================================
                        // ★ 【最優先：1〜3位（Top 3）黄金比ライン王冠（丸枠＋均等3山ストローク線画）】
                        // =========================================================================
                        const crownRank = top3Map.get(s);
                        if (crownRank !== undefined && crownRank >= 1 && crownRank <= 3) {
                            const config = CROWN_CONFIGS[crownRank - 1];
                            const inBounds = (drawX >= 7 && drawX <= this.radarSize - 7 && drawY >= 7 && drawY <= this.radarSize - 7);

                            if (inBounds) {
                                rCtx.save();
                                rCtx.globalAlpha = 1.0;

                                const strokeCol = config.color;
                                const circleRadius = 5.2; // 直径 10.4px（他のマーカーと揃う適正スケール）

                                // 1. 【外側の丸枠：単色ストローク（塗りつぶしなし）】
                                rCtx.strokeStyle = strokeCol;
                                rCtx.lineWidth = 1.2;
                                rCtx.beginPath();
                                rCtx.arc(drawX, drawY, circleRadius, 0, Math.PI * 2);
                                rCtx.stroke();

                                // 2. 【内側の均等3山王冠：黄金比ストローク線画（塗りつぶしなし）】
                                // 幅 6.0px : 高さ 3.7px (黄金比 1.62 : 1)
                                const halfW = 3.0;
                                const baseHalfW = 2.6; // 底辺をわずかに絞って洗練されたプロポーションに
                                const crownTopY = drawY - 1.8;
                                const crownBottomY = drawY + 1.9;
                                const valleyY = drawY + 0.5;

                                rCtx.strokeStyle = strokeCol;
                                rCtx.lineWidth = 1.2;
                                rCtx.lineCap = 'round';
                                rCtx.lineJoin = 'round';

                                rCtx.beginPath();
                                // 水平底辺
                                rCtx.moveTo(drawX - baseHalfW, crownBottomY);
                                rCtx.lineTo(drawX + baseHalfW, crownBottomY);
                                // 右壁立ち上がり -> 右の山
                                rCtx.lineTo(drawX + halfW, crownTopY);
                                // 右の谷
                                rCtx.lineTo(drawX + halfW * 0.45, valleyY);
                                // 中央の山（頂点の高さは左右と完全均等）
                                rCtx.lineTo(drawX, crownTopY);
                                // 左の谷
                                rCtx.lineTo(drawX - halfW * 0.45, valleyY);
                                // 左の山 -> 左壁
                                rCtx.lineTo(drawX - halfW, crownTopY);
                                rCtx.lineTo(drawX - baseHalfW, crownBottomY);
                                rCtx.stroke();

                                rCtx.restore();
                            } else {
                                // ★ レーダー枠外：シンプル＆シャープな単色三角矢印ポインター（▲）
                                const angle = Math.atan2(dy, dx);
                                if (!Number.isFinite(angle)) continue;

                                const cos = Math.cos(angle);
                                const sin = Math.sin(angle);
                                const halfSize = radarCenter - 6.5;

                                const denomX = Math.abs(cos) > 0.0001 ? Math.abs(cos) : 0.0001;
                                const denomY = Math.abs(sin) > 0.0001 ? Math.abs(sin) : 0.0001;
                                const t = Math.min(halfSize / denomX, halfSize / denomY);
                                const edgeX = radarCenter + cos * t;
                                const edgeY = radarCenter + sin * t;

                                rCtx.save();
                                rCtx.globalAlpha = 1.0;

                                const arrowLen = 8.5;
                                const arrowHalfW = 4.2;
                                const basePtX = edgeX - cos * arrowLen;
                                const basePtY = edgeY - sin * arrowLen;
                                const perpX = -sin * arrowHalfW;
                                const perpY = cos * arrowHalfW;

                                rCtx.fillStyle = config.color;
                                rCtx.beginPath();
                                rCtx.moveTo(edgeX, edgeY);
                                rCtx.lineTo(basePtX + perpX, basePtY + perpY);
                                rCtx.lineTo(basePtX - perpX, basePtY - perpY);
                                rCtx.closePath();
                                rCtx.fill();

                                rCtx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
                                rCtx.lineWidth = 1.5;
                                rCtx.lineJoin = 'round';
                                rCtx.stroke();

                                rCtx.restore();
                            }
                            continue; // ★ Top 3 処理完了のため、後続の人間・AI判定をバイパス
                        }

                        // =========================================================================
                        // ★ 【4位以下の人間プレイヤー判定（カスタムカラー維持）】
                        // =========================================================================
                        let isHuman = false;
                        if (s.isHumanPlayer === true) {
                            isHuman = true;
                        } else if (isMultiActive && !s.isPlayer && s.id !== undefined && s.id >= 0 && s.id < MAX_PLAYERS) {
                            // フォールバック
                            const slotData = netSlots ? netSlots[s.id] : null;
                            if (slotData && !slotData.isAI) {
                                if (s.lastPacketTime !== undefined) {
                                    isHuman = true;
                                }
                            }
                        }

                        if (isHuman) {
                            let humanColor = s.color;
                            if (isMultiActive && s.id !== undefined && netSlots && netSlots[s.id] && netSlots[s.id].color) {
                                humanColor = s.color || netSlots[s.id].color;
                            }
                            if (!humanColor) humanColor = '#ff3366';

                            const inBounds = (drawX >= 7 && drawX <= this.radarSize - 7 && drawY >= 7 && drawY <= this.radarSize - 7);

                            if (inBounds) {
                                // ★ レーダー内：人間プレイヤー専用アイコン（二重パルスリング＋コア）
                                const pulseScale = 1.0 + Math.sin(this.radarFrameCount * 0.18 + (s.id || 0)) * 0.22;

                                rCtx.strokeStyle = humanColor;
                                rCtx.lineWidth = 1.4;
                                rCtx.beginPath();
                                rCtx.arc(drawX, drawY, 5.2 * pulseScale, 0, Math.PI * 2);
                                rCtx.stroke();

                                rCtx.fillStyle = humanColor;
                                rCtx.beginPath();
                                rCtx.arc(drawX, drawY, 3.2, 0, Math.PI * 2);
                                rCtx.fill();

                                rCtx.fillStyle = '#ffffff';
                                rCtx.beginPath();
                                rCtx.arc(drawX, drawY, 1.2, 0, Math.PI * 2);
                                rCtx.fill();
                            } else {
                                // ★ レーダー外：最外周フチ方向ポインター（▲）
                                const angle = Math.atan2(dy, dx);
                                if (!Number.isFinite(angle)) continue;

                                const cos = Math.cos(angle);
                                const sin = Math.sin(angle);
                                const halfSize = radarCenter - 6.5;

                                const denomX = Math.abs(cos) > 0.0001 ? Math.abs(cos) : 0.0001;
                                const denomY = Math.abs(sin) > 0.0001 ? Math.abs(sin) : 0.0001;
                                const t = Math.min(halfSize / denomX, halfSize / denomY);
                                const edgeX = radarCenter + cos * t;
                                const edgeY = radarCenter + sin * t;

                                // 人間用は呼吸パルスを維持
                                const breath = 1.0 + Math.sin(this.radarFrameCount * 0.16 + (s.id || 0)) * 0.22;
                                const baseLen = 7.5 * breath;
                                const baseWidth = 4.4 * breath;

                                const baseCenterX = edgeX - cos * baseLen;
                                const baseCenterY = edgeY - sin * baseLen;
                                const perpX = -sin * baseWidth;
                                const perpY = cos * baseWidth;

                                rCtx.save();

                                rCtx.beginPath();
                                rCtx.moveTo(edgeX + cos * 1.5, edgeY + sin * 1.5);
                                rCtx.lineTo(baseCenterX + perpX * 1.4, baseCenterY + perpY * 1.4);
                                rCtx.lineTo(baseCenterX - perpX * 1.4, baseCenterY - perpY * 1.4);
                                rCtx.closePath();
                                rCtx.fillStyle = humanColor;
                                rCtx.globalAlpha = 0.45 + Math.sin(this.radarFrameCount * 0.16) * 0.25;
                                rCtx.fill();

                                rCtx.globalAlpha = 1.0;
                                rCtx.beginPath();
                                rCtx.moveTo(edgeX, edgeY);
                                rCtx.lineTo(baseCenterX + perpX, baseCenterY + perpY);
                                rCtx.lineTo(baseCenterX - perpX, baseCenterY - perpY);
                                rCtx.closePath();
                                rCtx.fillStyle = humanColor;
                                rCtx.fill();

                                rCtx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
                                rCtx.lineWidth = 1.8;
                                rCtx.lineJoin = 'round';
                                rCtx.stroke();

                                rCtx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
                                rCtx.lineWidth = 0.8;
                                rCtx.stroke();

                                rCtx.restore();
                            }
                        } else {
                            // AIスネーク描画：枠外はスキップ
                            if (drawX < -8 || drawX > this.radarSize + 8 || drawY < -8 || drawY > this.radarSize + 8) {
                                continue;
                            }

                            // AIスネーク描画：格上（赤）／格下（控えめドット）
                            const isBigger = (s.score || 0) > (player.score || 0);
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

                rCtx.fillStyle = 'rgba(56, 189, 248, 0.07)';
                rCtx.fillRect(left, top, camRectW, camRectH);

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
                const pAngle = (player.angle !== undefined && Number.isFinite(player.angle)) ? player.angle : 0;
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

                rCtx.beginPath();
                rCtx.moveTo(tipX, tipY);
                rCtx.lineTo(wingLeftX, wingLeftY);
                rCtx.lineTo(baseNotchX, baseNotchY);
                rCtx.lineTo(wingRightX, wingRightY);
                rCtx.closePath();

                rCtx.fillStyle = '#fde047';
                rCtx.fill();

                rCtx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
                rCtx.lineWidth = 1.8;
                rCtx.lineJoin = 'round';
                rCtx.stroke();

                const myColor = player.color || '#00e5ff';

                rCtx.strokeStyle = '#ffffff';
                rCtx.lineWidth = 1.5;
                rCtx.beginPath();
                rCtx.arc(radarCenter, radarCenter, 4.8, 0, Math.PI * 2);
                rCtx.stroke();

                rCtx.fillStyle = myColor;
                rCtx.beginPath();
                rCtx.arc(radarCenter, radarCenter, 3.4, 0, Math.PI * 2);
                rCtx.fill();

                rCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                rCtx.beginPath();
                rCtx.arc(radarCenter, radarCenter, 1.2, 0, Math.PI * 2);
                rCtx.fill();

                // 5. レーダー外枠
                rCtx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
                rCtx.lineWidth = 1.5;
                rCtx.strokeRect(0, 0, this.radarSize, this.radarSize);
                
            } catch (err) {
                console.warn('[HUD] Radar drawing exception intercepted to prevent crash:', err);
            } finally {
                this.radarFrameCount++;
                ctx.drawImage(this.radarCanvas, rx, ry);
            }
        } else {
            this.radarFrameCount++;
            ctx.drawImage(this.radarCanvas, rx, ry);
        }
    }
}