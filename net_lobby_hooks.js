// ==============================================================================
// 『くねくねバトル オンライン』ロビーDOMイベント監視＆連打防止モジュール (net_lobby_hooks.js)
// v25.0.0 DM招待完全適応＆6名対応デバウンス版:
// ・公開/プライベートルーム作成・一覧更新・入室ボタンの1秒デバウンス（連打完全抑止）
// ・参加ボタン押下時の先行待機室起動（画面フリーズ・無反応感を完全解消）
// ・最大定員6名（MAX_PLAYERS）完全準拠 ＆ EntryShield 連携
// ==============================================================================

import { NetworkManager } from './network.js';
import { EntryShield } from './dom.js';
import { MAX_PLAYERS } from './constants.js';

let lastCreateActionTime = 0;
let lastRefreshActionTime = 0;

/**
 * ロビー画面の全ネットワーク関連ボタンに安全なリスナーをフックする
 */
export function hookLobbyNetworkEvents() {
    // 1. 公開ルーム作成ボタン
    const btnCreatePublic = document.getElementById('btn-lobby-public');
    if (btnCreatePublic && !btnCreatePublic._hasNetHook) {
        btnCreatePublic._hasNetHook = true;

        const onCreatePublic = async (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const now = Date.now();
            if (now - lastCreateActionTime < 1000) return;
            lastCreateActionTime = now;

            EntryShield.show('CONNECTING...', '公開ルームを作成中');
            const roomId = await NetworkManager.createRoom(false);
            EntryShield.hide();

            if (roomId && typeof window !== 'undefined' && window.UIController) {
                window.UIController.showWaitingRoom(roomId);
            }
        };

        btnCreatePublic.addEventListener('touchend', onCreatePublic, { passive: false });
        btnCreatePublic.addEventListener('click', onCreatePublic);
    }

    // 2. プライベートルーム作成ボタン
    const btnCreatePrivate = document.getElementById('btn-lobby-private');
    if (btnCreatePrivate && !btnCreatePrivate._hasNetHook) {
        btnCreatePrivate._hasNetHook = true;

        const onCreatePrivate = async (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const now = Date.now();
            if (now - lastCreateActionTime < 1000) return;
            lastCreateActionTime = now;

            EntryShield.show('CONNECTING...', 'プライベートルームを作成中');
            const roomId = await NetworkManager.createRoom(true);
            EntryShield.hide();

            if (roomId && typeof window !== 'undefined' && window.UIController) {
                window.UIController.showWaitingRoom(roomId);
            }
        };

        btnCreatePrivate.addEventListener('touchend', onCreatePrivate, { passive: false });
        btnCreatePrivate.addEventListener('click', onCreatePrivate);
    }

    // 3. 公開ルーム一覧更新ボタン
    const btnRefresh = document.getElementById('btn-refresh-rooms');
    if (btnRefresh && !btnRefresh._hasNetHook) {
        btnRefresh._hasNetHook = true;

        const onRefresh = async (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const now = Date.now();
            if (now - lastRefreshActionTime < 1000) return;
            lastRefreshActionTime = now;

            btnRefresh.innerText = '更新中...';
            const rooms = await NetworkManager.getPublicRooms();
            btnRefresh.innerText = '更新';

            const container = document.getElementById('room-list-container');
            if (!container) return;

            if (!rooms || rooms.length === 0) {
                container.innerHTML = '<div class="room-list-empty">公開ルームはありません</div>';
                return;
            }

            container.innerHTML = rooms.map(r => `
                <div class="room-item">
                    <div class="room-item-info">
                        <span class="room-item-id">ROOM #${String(r.room_id).slice(-5)}</span>
                        <span class="room-item-count">参加者: ${r.gamer_num || 1} / ${r.max_players || MAX_PLAYERS}名</span>
                    </div>
                    <button type="button" class="btn-join-room" data-room="${r.room_id}">参加</button>
                </div>
            `).join('');

            // 各ルームへの参加ボタンに安全デバウンスと先行画面起動をバインド
            container.querySelectorAll('.btn-join-room').forEach(btn => {
                let lastJoinTime = 0;
                const onJoin = async (ev) => {
                    if (ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                    }
                    const jNow = Date.now();
                    if (jNow - lastJoinTime < 1000) return;
                    lastJoinTime = jNow;

                    const rid = String(btn.dataset.room);
                    const shortId = rid.length > 5 ? rid.slice(-5) : rid;

                    // 先行画面起動 ＆ シールド表示
                    EntryShield.show(`ROOM #${shortId}`, 'ルームへ合流中...');
                    if (typeof window !== 'undefined' && window.UIController) {
                        window.UIController.showWaitingRoom(rid);
                    }

                    const res = await NetworkManager.joinRoom(rid);
                    EntryShield.hide();

                    if (!res.success) {
                        if (typeof window !== 'undefined' && window.UIController) {
                            window.UIController.showLobby();
                        }
                    }
                };

                btn.addEventListener('touchend', onJoin, { passive: false });
                btn.addEventListener('click', onJoin);
            });
        };

        btnRefresh.addEventListener('touchend', onRefresh, { passive: false });
        btnRefresh.addEventListener('click', onRefresh);
    }
}

if (typeof window !== 'undefined') {
    window.hookLobbyNetworkEvents = hookLobbyNetworkEvents;
}

// DOMマウント直後またはDOMContentLoadedでのバインド呼び出し
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookLobbyNetworkEvents);
} else {
    hookLobbyNetworkEvents();
}