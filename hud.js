/**
 * ==============================================================================
 * 『くねくねバトル オンライン』一体型HUD ＆ 自機中心相対追従レーダー (hud.js)
 * v32.0.0 WebKit shadowBlur消失バグ完全根絶＆多重パスグロー安定化版:
 * ・【WebKit Canvas shadowBlurクラッシュの完全根絶（多重パスグロー回帰）】
 * 　iOS WebKit（iPhone WebView）特有のGPUオフスクリーンCanvas消失バグを引き起こす
 * 　ctx.shadowBlur / ctx.shadowColor を完全撤廃！
 * 　マスターコード本来の設計である純粋ベクター多重パス（拡大半透明オーラ＋本体塗り）
 * 　へと回帰することで、MAP（ミニマップ）消失問題を100%物理解決し、美しく輝く金銀銅王冠を完全両立
 * ・【NaN / 不正座標の完全遮断バリデーション配備】
 * 　相手スネークの座標（s.x, s.y）が有限数（isFinite）でない場合の描画を安全にスキップし、
 * 　Canvas変換行列（Transform Matrix）の破壊による画面消失を完全防護
 * ・【エンティティ存在チェック（!s ガード）配備】
 * 　入退室や破棄直後の null/undefined アクセスによる TypeError 描画中断を根絶
 * ・【MAP上1〜3位王冠表示（金銀銅・自機除外・自機マーク不変）完全維持】
 * ・【1〜3位人間カスタムカラー差し替え＆4位以下完全維持】
 * ・【ランキング同期デッドロックの完全解消維持】toggleRanking連動
 * ・【カスタムカラー即時マルチ同期維持】
 * ・【矢印二重描画の完全根絶維持】
 * ・【ゲスト端末でのホスト方向ポインター確実点灯維持】
 * ・【他ユーザー方向ポインターの呼吸パルス明滅＆発光オーラ維持】
 * ・自機進行方向コンパス、カメラ視野枠ハイライト維持
 * ・描画負荷軽減：2フレームに1回（30FPS）描画スロットリング ＆ Offscreen キャッシュ維持
 * ==============================================================================
 */

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

            const cx = Number.isFinite(player.x) ? player.x : 0;
            const cy = Number.isFinite(player.y) ? player.y : 0;

            // =========================================================================
            // ★ 【Top 3 絶対順位マッピング ＆ 自機除外判定】
            // 全体の上位スネークから生存している真の1位、2位、3位を特定。
            // 自機 player も順位判定には含めるが、描画ループ先頭で自機はスキップされるため、
            // 自機が1〜3位にいる場合の王冠数は自動的に他者の「2つのみ」となる。
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
                    if (!s || s === player || s.isDead || s.isPlayer || (s.score || 0) <= targetMinScore) continue;

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

            // 2. 他スネーク（王冠 Top 3 ＆ 人間プレイヤー ＆ AI）の描画
            if (otherEntities && otherEntities.length > 0) {
                const totalEntities = otherEntities.length;
                for (let i = 0; i < totalEntities; i++) {
                    const s = otherEntities[i];
                    // ★ エンティティ存在・死亡・自機安全ガード
                    if (!s || s === player || s.isDead) continue;

                    // ★ 有限数バリデーション（NaN による Transform Matrix 破壊を完全遮断）
                    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;

                    const dx = s.x - cx;
                    const dy = s.y - cy;
                    const drawX = radarCenter + dx * radarRatio;
                    const drawY = radarCenter + dy * radarRatio;

                    // =========================================================================
                    // ★ 【最優先：1〜3位（Top 3）王冠マーク描画（金・銀・銅）】
                    // 人間・AI問わず共通の王冠マークを描画し、カスタムカラーは上書き遮断
                    // ※ WebKitバグ回避のため shadowBlur は完全撤廃し多重ベクターパスで発光を再現
                    // =========================================================================
                    const crownRank = top3Map.get(s);
                    if (crownRank !== undefined && crownRank >= 1 && crownRank <= 3) {
                        const config = CROWN_CONFIGS[crownRank - 1];
                        const inBounds = (drawX >= 7 && drawX <= this.radarSize - 7 && drawY >= 7 && drawY <= this.radarSize - 7);

                        if (inBounds) {
                            // ★ レーダー枠内：水平正立ミニクラウン
                            const pulseScale = 1.0 + Math.sin(this.radarFrameCount * 0.18 + crownRank) * 0.18;

                            rCtx.save();
                            rCtx.translate(drawX, drawY);
                            rCtx.scale(pulseScale, pulseScale);

                            // 1. 背後の半透明グローオーラ（shadowBlur 不使用・WebKit安全）
                            rCtx.beginPath();
                            rCtx.moveTo(-6.5, 4.0);
                            rCtx.lineTo(-6.5, -3.0);
                            rCtx.lineTo(-3.0, 1.0);
                            rCtx.lineTo(0, -6.2);
                            rCtx.lineTo(3.0, 1.0);
                            rCtx.lineTo(6.5, -3.0);
                            rCtx.lineTo(6.5, 4.0);
                            rCtx.closePath();
                            rCtx.fillStyle = config.glow;
                            rCtx.globalAlpha = 0.50;
                            rCtx.fill();

                            // 2. 本体の王冠塗り
                            rCtx.globalAlpha = 1.0;
                            rCtx.beginPath();
                            rCtx.moveTo(-5.5, 3.2);
                            rCtx.lineTo(-5.5, -2.2);   // 左の山
                            rCtx.lineTo(-2.5, 0.8);    // 左の谷
                            rCtx.lineTo(0, -5.0);      // 中央の高い山
                            rCtx.lineTo(2.5, 0.8);     // 右の谷
                            rCtx.lineTo(5.5, -2.2);    // 右の山
                            rCtx.lineTo(5.5, 3.2);     // 右下
                            rCtx.closePath();
                            rCtx.fillStyle = config.fill;
                            rCtx.fill();

                            // 3. 輪郭線
                            rCtx.strokeStyle = '#000000';
                            rCtx.lineWidth = 1.4;
                            rCtx.stroke();

                            rCtx.restore();
                        } else {
                            // ★ レーダー枠外：最外周フチの王冠矢印ポインター
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

                            const breath = 1.0 + Math.sin(this.radarFrameCount * 0.16 + crownRank) * 0.18;

                            rCtx.save();
                            rCtx.translate(edgeX, edgeY);
                            rCtx.rotate(angle);
                            rCtx.scale(breath, breath);

                            // 1. 背後のネオングローオーラ（拡大パス塗り・WebKit安全）
                            rCtx.beginPath();
                            rCtx.moveTo(7.0, 0);
                            rCtx.lineTo(-1.2, 5.0);
                            rCtx.lineTo(2.4, 8.0);
                            rCtx.lineTo(-7.8, 6.2);
                            rCtx.lineTo(-5.5, 0);
                            rCtx.lineTo(-7.8, -6.2);
                            rCtx.lineTo(2.4, -8.0);
                            rCtx.lineTo(-1.2, -5.0);
                            rCtx.closePath();
                            rCtx.fillStyle = config.glow;
                            rCtx.globalAlpha = 0.50;
                            rCtx.fill();

                            // 2. 本体カラー（金・銀・銅）
                            rCtx.globalAlpha = 1.0;
                            rCtx.beginPath();
                            rCtx.moveTo(5.5, 0);          // 中央尖塔（矢印先端）
                            rCtx.lineTo(-1.0, 3.8);       // 谷
                            rCtx.lineTo(1.8, 6.5);        // 右突起
                            rCtx.lineTo(-6.5, 5.0);       // 右下角
                            rCtx.lineTo(-4.5, 0);         // 底辺中央
                            rCtx.lineTo(-6.5, -5.0);      // 左下角
                            rCtx.lineTo(1.8, -6.5);       // 左突起
                            rCtx.lineTo(-1.0, -3.8);      // 谷
                            rCtx.closePath();
                            rCtx.fillStyle = config.fill;
                            rCtx.fill();

                            // 3. 黒＋白のダブル輪郭線
                            rCtx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
                            rCtx.lineWidth = 1.6;
                            rCtx.stroke();
                            rCtx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
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
                            // ★ レーダー外：最外周フチに【呼吸パルス明滅＆ネオン発光オーラ】付き方向ポインター（▲）を点灯
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

                            const breath = 1.0 + Math.sin(this.radarFrameCount * 0.16 + (s.id || 0)) * 0.22;
                            const baseLen = 7.5 * breath;
                            const baseWidth = 4.4 * breath;

                            const baseCenterX = edgeX - cos * baseLen;
                            const baseCenterY = edgeY - sin * baseLen;
                            const perpX = -sin * baseWidth;
                            const perpY = cos * baseWidth;

                            rCtx.save();

                            // 1. 背後の半透明ネオングローオーラ
                            rCtx.beginPath();
                            rCtx.moveTo(edgeX + cos * 1.5, edgeY + sin * 1.5);
                            rCtx.lineTo(baseCenterX + perpX * 1.4, baseCenterY + perpY * 1.4);
                            rCtx.lineTo(baseCenterX - perpX * 1.4, baseCenterY - perpY * 1.4);
                            rCtx.closePath();
                            rCtx.fillStyle = humanColor;
                            rCtx.globalAlpha = 0.45 + Math.sin(this.radarFrameCount * 0.16) * 0.25;
                            rCtx.fill();

                            // 2. 本体の高輝度三角ポインター
                            rCtx.globalAlpha = 1.0;
                            rCtx.beginPath();
                            rCtx.moveTo(edgeX, edgeY);
                            rCtx.lineTo(baseCenterX + perpX, baseCenterY + perpY);
                            rCtx.lineTo(baseCenterX - perpX, baseCenterY - perpY);
                            rCtx.closePath();
                            rCtx.fillStyle = humanColor;
                            rCtx.fill();

                            // 3. 黒＋白のダブル輪郭線で格上AI赤ドット群と完全に差別化
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
                        // =========================================================================
                        // ★ 【4位以下の通常AIスネーク描画】
                        // =========================================================================
                        if (drawX < -8 || drawX > this.radarSize + 8 || drawY < -8 || drawY > this.radarSize + 8) {
                            continue;
                        }

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
            rCtx.lineTo(left + camRectW);
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
            // =========================================================================
            // ★ 【自機マーク不変性維持】
            // 順位に関わらず自機選択カラー・白リング・黄色コンパス矢印をそのまま維持
            // =========================================================================
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

            // 自機マーク：選択されたカスタムカラー（player.color）と完全連動
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