/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ニコニコ風弾幕チャットエンジン (danmaku.js)
 * v27.0.0 直近同一メッセージ重複排除フィルター配備版:
 * ・【直近同一メッセージ重複排除フィルター（recentMessages）配備】
 * 　直近（800ms以内）に流れたメッセージと同一の「送信者＋内容」が届いた場合、
 * 　パケットの重複や他端末からのダブル同報を安全に検知してスキップ！
 * 　敵撃破時・被撃破時・チャット連打時の二重表示を弾幕エンジン層で100%物理根絶
 * ・【高空セーフ帯専用レーン配備＆自機死角完全ゼロ維持】
 * 　自機中央（50%）に絶対に被らないよう、上空セーフ帯（18vhコンテナ内）に4分散レーンを集中配備
 * ・【レーン下端自機頭上クリアランス維持】140px以上の視界確保
 * ・【レーン高さゆらぎ（ジッター）維持】±4px
 * ・【DOM安全二重回収維持】animationend ＆ 6.8秒タイマー
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

        // ★ 直近同一メッセージ重複排除用キャッシュ (キー -> 有効期限タイムスタンプ)
        this.recentMessages = new Map();
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
        this.recentMessages.clear();
    }

    // 弾幕メッセージの投入
    push(senderName, text, badgeColor = '#00e5ff', isSystem = false) {
        if (!this.container) return;

        const now = Date.now();

        // =========================================================================
        // ★ 【直近同一メッセージ重複排除フィルター】
        // 800ms以内に同一送信者・同一内容のメッセージが届いた場合は二重表示とみなしスキップ
        // =========================================================================
        const dedupKey = `${senderName}:${text}`;
        const expireTime = this.recentMessages.get(dedupKey);
        if (expireTime && now < expireTime) {
            return;
        }
        this.recentMessages.set(dedupKey, now + 800);

        // キャッシュサイズ肥大化防止（定期的に期限切れキーを回収）
        if (this.recentMessages.size > 20) {
            for (const [k, exp] of this.recentMessages.entries()) {
                if (now >= exp) this.recentMessages.delete(k);
            }
        }

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