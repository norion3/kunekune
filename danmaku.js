/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ニコニコ風弾幕チャットエンジン (danmaku.js)
 * v25.2.0 ゴールデンゾーン5レーン分散＆高さゆらぎニコニコライブ感版:
 * ・ヘッダーアイコン・ノッチ直下から画面44%までの「弾幕ゴールデンゾーン」へ再配置
 * ・中央自機（50%）の索敵視野を遮らない安全な通過高度を完全確保
 * ・レーンごとに ±8px のランダム高さゆらぎ（ジッター）を付与し、自然な躍動感を創出
 * ・animationend イベントと安全タイマーの二重回収による DOM 破棄漏れ完全防止
 * ==============================================================================
 */

export class DanmakuManager {
    constructor() {
        this.container = null;
        // ★ ヘッダー直下〜画面44%に分散配置された5つの通過レーン（自機中央50%の死角化を防止）
        this.lanes = [
            { baseTop: 10, busyUntil: 0 }, // コンテナ内上部（順位パネル下部と並走）
            { baseTop: 28, busyUntil: 0 },
            { baseTop: 48, busyUntil: 0 },
            { baseTop: 68, busyUntil: 0 },
            { baseTop: 86, busyUntil: 0 }  // コンテナ内最下部（自機頭上手前で安全通過）
        ];
    }

    init() {
        this.container = document.getElementById('danmaku-container');
    }

    // セッション切り替え・リセット時の残存弾幕完全パージ
    clear() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        const now = Date.now();
        for (let i = 0; i < this.lanes.length; i++) {
            this.lanes[i].busyUntil = now;
        }
    }

    // 弾幕メッセージの投入
    push(senderName, text, badgeColor = '#00e5ff', isSystem = false) {
        if (!this.container) return;

        const now = Date.now();
        // 最も早く空くレーンを探索
        let selectedLane = this.lanes[0];
        let minBusy = this.lanes[0].busyUntil;

        for (let i = 1; i < this.lanes.length; i++) {
            if (this.lanes[i].busyUntil < minBusy) {
                minBusy = this.lanes[i].busyUntil;
                selectedLane = this.lanes[i];
            }
        }

        selectedLane.busyUntil = Math.max(now, selectedLane.busyUntil) + 1400; // 同一レーンの最低通過間隔

        // ★ 完全な機械的一定を崩す「高さゆらぎ（ジッター）」を付与（±6px相当）
        const jitter = (Math.random() - 0.5) * 6;
        const computedTopPercent = Math.max(4, Math.min(94, selectedLane.baseTop + jitter));

        const item = document.createElement('div');
        item.className = 'danmaku-item' + (isSystem ? ' danmaku-system' : '');
        item.style.top = `${computedTopPercent}%`;

        if (isSystem) {
            item.innerHTML = `<span class="danmaku-sys-text">${this.escapeHTML(text)}</span>`;
        } else {
            item.innerHTML = `
                <span class="danmaku-badge" style="background-color: ${badgeColor}; border-color: ${badgeColor};">${this.escapeHTML(senderName)}</span>
                <span class="danmaku-content">${this.escapeHTML(text)}</span>
            `;
        }

        // 安全な要素破棄ルーチン（二重実行防止）
        let removed = false;
        const removeElement = () => {
            if (removed) return;
            removed = true;
            if (item && item.parentNode) {
                item.parentNode.removeChild(item);
            }
        };

        // CSSアニメーション終了時の自動破棄
        item.addEventListener('animationend', removeElement, { once: true });

        // フォールバック安全タイマー（6.8秒）
        setTimeout(removeElement, 6800);

        this.container.appendChild(item);
    }

    escapeHTML(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

export const Danmaku = new DanmakuManager();