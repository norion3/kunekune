// ==============================================================================
// 『くねくねバトル オンライン』一体型HUD ＆ 自機中心相対追従レーダー (hud.js)
// v35.0.0 MAP上1〜3位王冠表示（枠内ミニクラウン大型化・視認系統一版）:
// ・【レーダー内王冠(ミニクラウン)の大幅サイズアップ】
// 　枠内に入った時の王冠サイズを従来の幅約11pxから幅16px(w=8.0, h=6.5)へ約1.5倍拡大！
// 　枠外の方向ポインターとサイズ感をシームレスに統一し、「近づいてきた時に急に小さくなる」
// 　強烈な違和感を完全払拭。線の密集・潰れが解消され、金・銀・銅のベタ塗り面積が
// 　広く確保されたことで、王者としての圧倒的な存在感と視認性を実現
// ・【王冠マークのゆらぎ（伸縮）完全撤廃維持】
// 　レーダー枠外・枠内の王冠から Math.sin によるサイズ変動を100%削除。
// 　常に固定サイズでブレなくピタッと表示させることで、目障りなチカチカ感を根絶
// ・【王冠シルエットのシンプル化＆底辺の直線(フラット)化維持】
// 　王冠の底辺のくぼみをなくして「まっすぐな直線」に変更。
// 　どっしりとした安定感のある王冠アイコンに進化！
// ・【絶対座標直描によるCanvasマトリクス破壊・MAP消失の完全根絶維持】
// 　iOS WebKitのCanvas消失を引き起こす translate/rotate/shadowBlur を一切使用せず、
// 　三角関数による絶対座標直描パスで安全に描画
// ・【NaN/Undefined絶対防護＆try-finally描画保証維持】
// ・【自機除外ルール＆王冠表示数の動的整合維持】
// ・【自機中心マークの完全不変性維持】
// ・【1〜3位人間カスタムカラー差し替え＆4位以下完全維持】
// ・【ランキング同期デッドロックの完全解消維持】toggleRanking連動
// ・【カスタムカラー即時マルチ同期維持】
// ・【矢印二重描画の完全根絶維持】
// ・【ゲスト端末でのホスト方向ポインター確実点灯維持】
// ・自機進行方向コンパス、カメラ視野枠ハイライト維持
// ・描画負荷軽減：2フレームに1回（30FPS）描画スロットリング ＆ Offscreen キャッシュ維持
// ==============================================================================

import { MAX_PLAYERS } from './constants.js';
import { NetworkManager } from './network.js';
import { resetLeaderboardCache } from './net_handlers.js';

// ★ 王冠ランク別スタイル定義（ゼロアロケーション）
const CROWN_CONFIGS = [
    { rank: 1, fill: '#fde047', glow: '#eab308' }, // 1位: 金 (Gold)
    { rank: 2, fill: '#f1f5f9', glow: '#94a3b8' }, // 2位: 銀 (Silver)
    { rank: 3, fill: '#fb923c', glow: '#c2410c' }  // 3位: 銅 (Bronze)
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
                // 全体の上位スネークから生存している真の1位、2位、3位を特定。
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
                        // ★ 【最優先：1〜3位（Top 3）王冠マーク描画（金・銀・銅）】
                        // =========================================================================
                        const crownRank = top3Map.get(s);
                        if (crownRank !== undefined && crownRank >= 1 && crownRank <= 3) {
                            const config = CROWN_CONFIGS[crownRank - 1];
                            const inBounds = (drawX >= 7 && drawX <= this.radarSize - 7 && drawY >= 7 && drawY <= this.radarSize - 7);

                            if (inBounds) {
                                // ★ レーダー枠内：水平正立ミニクラウン（ゆらぎ無し・固定サイズ・大型化）
                                // 外周のポインターと同等の存在感を出すため、サイズを大幅に引き上げ
                                const w = 8.0; 
                                const h = 6.5;
                                const ow = w * 1.35;
                                const oh = h * 1.35;

                                rCtx.save();

                                // 1. 背後の静的グローオーラ（底辺直線）
                                rCtx.beginPath();
                                rCtx.moveTo(drawX - ow, drawY + oh * 0.6);
                                rCtx.lineTo(drawX - ow * 0.9, drawY - oh * 0.5);
                                rCtx.lineTo(drawX - ow * 0.4, drawY);
                                rCtx.lineTo(drawX, drawY - oh);
                                rCtx.lineTo(drawX + ow * 0.4, drawY);
                                rCtx.lineTo(drawX + ow * 0.9, drawY - oh * 0.5);
                                rCtx.lineTo(drawX + ow, drawY + oh * 0.6);
                                rCtx.closePath(); // 底辺は自動的に直線で結ばれる
                                rCtx.fillStyle = config.glow;
                                rCtx.globalAlpha = 0.45; // 透過度固定
                                rCtx.fill();

                                // 2. 本体の王冠塗り（底辺直線・シンプルシルエット）
                                rCtx.globalAlpha = 1.0;
                                rCtx.beginPath();
                                rCtx.moveTo(drawX - w, drawY + h * 0.6);        // 左下
                                rCtx.lineTo(drawX - w * 0.9, drawY - h * 0.5);  // 左の山
                                rCtx.lineTo(drawX - w * 0.4, drawY);            // 左の谷
                                rCtx.lineTo(drawX, drawY - h);                  // 中央の高い山
                                rCtx.lineTo(drawX + w * 0.4, drawY);            // 右の谷
                                rCtx.lineTo(drawX + w * 0.9, drawY - h * 0.5);  // 右の山
                                rCtx.lineTo(drawX + w, drawY + h * 0.6);        // 右下
                                rCtx.closePath(); // ★ 底辺をまっすぐな直線で結ぶ
                                rCtx.fillStyle = config.fill;
                                rCtx.fill();

                                // 3. 輪郭線
                                rCtx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
                                rCtx.lineWidth = 1.5;
                                rCtx.lineJoin = 'round';
                                rCtx.stroke();

                                rCtx.restore();
                            } else {
                                // ★ レーダー枠外：最外周フチの王冠矢印ポインター（ゆらぎ無し・固定サイズ）
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

                                // ゆらぎ撤廃、常に固定スケール。どっしりとしたサイズ感
                                const scale = 1.25; 
                                
                                // 進行軸（相手方向）と垂直軸の単位ベクトル
                                const ux = cos;
                                const uy = sin;
                                const vx = -sin;
                                const vy = cos;

                                // ★ 王冠矢印の各頂点（中央突起が最も高く先端を指す、底辺はまっすぐ）
                                const tipX = edgeX;
                                const tipY = edgeY;
                                const lValleyX = edgeX - ux * 4.0 * scale + vx * 2.5 * scale;
                                const lValleyY = edgeY - uy * 4.0 * scale + vy * 2.5 * scale;
                                const lPeakX = edgeX - ux * 2.5 * scale + vx * 5.0 * scale;
                                const lPeakY = edgeY - uy * 2.5 * scale + vy * 5.0 * scale;
                                const lBaseX = edgeX - ux * 7.5 * scale + vx * 4.5 * scale;
                                const lBaseY = edgeY - uy * 7.5 * scale + vy * 4.5 * scale;

                                const rBaseX = edgeX - ux * 7.5 * scale - vx * 4.5 * scale;
                                const rBaseY = edgeY - uy * 7.5 * scale - vy * 4.5 * scale;
                                const rPeakX = edgeX - ux * 2.5 * scale - vx * 5.0 * scale;
                                const rPeakY = edgeY - uy * 2.5 * scale - vy * 5.0 * scale;
                                const rValleyX = edgeX - ux * 4.0 * scale - vx * 2.5 * scale;
                                const rValleyY = edgeY - uy * 4.0 * scale - vy * 2.5 * scale;

                                rCtx.save();

                                // 1. 背後の静的グローオーラ
                                rCtx.beginPath();
                                rCtx.moveTo(tipX + ux * 1.5, tipY + uy * 1.5);
                                rCtx.lineTo(lValleyX + ux * 1.0 + vx * 1.5, lValleyY + uy * 1.0 + vy * 1.5);
                                rCtx.lineTo(lPeakX + vx * 1.5, lPeakY + vy * 1.5);
                                rCtx.lineTo(lBaseX - ux * 1.5 + vx * 1.5, lBaseY - uy * 1.5 + vy * 1.5);
                                rCtx.lineTo(rBaseX - ux * 1.5 - vx * 1.5, rBaseY - uy * 1.5 - vy * 1.5); // 直線底辺オーラ
                                rCtx.lineTo(rPeakX - vx * 1.5, rPeakY - vy * 1.5);
                                rCtx.lineTo(rValleyX + ux * 1.0 - vx * 1.5, rValleyY + uy * 1.0 - vy * 1.5);
                                rCtx.closePath();
                                rCtx.fillStyle = config.glow;
                                rCtx.globalAlpha = 0.45;
                                rCtx.fill();

                                // 2. 本体の王冠矢印パス
                                rCtx.globalAlpha = 1.0;
                                rCtx.beginPath();
                                rCtx.moveTo(tipX, tipY);
                                rCtx.lineTo(lValleyX, lValleyY);
                                rCtx.lineTo(lPeakX, lPeakY);
                                rCtx.lineTo(lBaseX, lBaseY);
                                rCtx.lineTo(rBaseX, rBaseY); // ★ 底辺のくぼみをなくし、まっすぐな直線で結ぶ
                                rCtx.lineTo(rPeakX, rPeakY);
                                rCtx.lineTo(rValleyX, rValleyY);
                                rCtx.closePath();
                                rCtx.fillStyle = config.fill;
                                rCtx.fill();

                                // 3. 黒＋白のダブル輪郭線
                                rCtx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
                                rCtx.lineWidth = 1.6;
                                rCtx.lineJoin = 'round';
                                rCtx.stroke();

                                rCtx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
                                rCtx.lineWidth = 0.8;
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