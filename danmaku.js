/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ニコニコ風弾幕チャットエンジン (danmaku.js)
 * v26.1.0 高空セーフ帯専用レーン配備＆自機死角完全ゼロ版:
 * ・自機（画面中央50%）に絶対に被らないよう、上空セーフ帯（18vhコンテナ内）に4分散レーンを集中配備
 * ・レーン下端でも自機頭上から140px以上のクリアランスを保ち、交戦・索敵視界を100%保護
 * ・レーンごとに ±4px の高さゆらぎ（ジッター）を付与し、自然なニコニコ動画風ライブ感を維持
 * ・animationend イベントと安全タイマーの二重回収による DOM 破棄漏れ完全防止
 * ==============================================================================
 */

export class DanmakuManager {
    constructor() {
        this.container = null;
        // ★ 自機中央（50%）に絶対に被らない高空セーフ帯（コンテナ内18vh）の4分散レーン
        this.lanes = [
            { baseTop: 6, busyUntil: 0 },   // コンテナ内最上部
            { baseTop: 28, busyUntil: 0 },  // 上段
            { baseTop: 52, busyUntil: 0 },  // 中段
            { baseTop: 74, busyUntil: 0 }   // 下段（自機から120px以上上空で安全通過）
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

        // ★ 高空セーフ帯をはみ出さない微小な「高さゆらぎ（ジッター）」を付与（±4px相当）
        const jitter = (Math.random() - 0.5) * 4;
        const computedTopPercent = Math.max(4, Math.min(84, selectedLane.baseTop + jitter));

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