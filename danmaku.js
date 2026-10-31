/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ニコニコ風弾幕チャットエンジン (danmaku.js)
 * v20.8.0 メモリリーク防止＆タイマー安全管理版:
 * ・animationend イベントとタイマーの二重安全回収による DOM 破棄漏れ完全防止
 * ・ルーム入退室・リセット時の clear() パージ機構
 * ・画面上部（18%〜36%）視界阻害ゼロの 4レーン横断アニメーション
 * ==============================================================================
 */

export class DanmakuManager {
    constructor() {
        this.container = null;
        this.lanes = [
            { top: '18%', busyUntil: 0 },
            { top: '23%', busyUntil: 0 },
            { top: '28%', busyUntil: 0 },
            { top: '33%', busyUntil: 0 }
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

        selectedLane.busyUntil = Math.max(now, selectedLane.busyUntil) + 1200; // 同一レーンの最低間隔

        const item = document.createElement('div');
        item.className = 'danmaku-item' + (isSystem ? ' danmaku-system' : '');
        item.style.top = selectedLane.top;

        if (isSystem) {
            item.innerHTML = `<span class="danmaku-sys-text">${this.escapeHTML(text)}</span>`;
        } else {
            item.innerHTML = `
                <span class="danmaku-badge" style="background-color: ${badgeColor};">${this.escapeHTML(senderName)}</span>
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

        // フォールバック安全タイマー（4.6秒）
        setTimeout(removeElement, 4600);

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