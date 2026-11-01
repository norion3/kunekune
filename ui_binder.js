// ==============================================================================
// 『くねくねバトル オンライン』UIイベントバインダーモジュール (ui_binder.js)
// v21.0.0 責務分離・軽量化版:
// ・main.js から各種UI操作・ボタン配線を完全外注化
// ・ズーム限界到達時の .disabled リアルタイム更新管理
// ・ロビー、待機室、リザルト画面のイベントハンドラ集約
// ==============================================================================

import { Danmaku } from './danmaku.js';
import { Menu } from './menu.js';

/**
 * ズームボタンのdisabled状態を倍率に応じて更新
 * @param {number} zoomMultiplier 
 */
export function updateZoomButtonsState(zoomMultiplier) {
    const btnIn = document.getElementById('btn-zoom-in');
    const btnOut = document.getElementById('btn-zoom-out');
    if (btnIn) {
        btnIn.classList.toggle('disabled', zoomMultiplier >= 1.39);
    }
    if (btnOut) {
        btnOut.classList.toggle('disabled', zoomMultiplier <= 0.46);
    }
}

/**
 * 全UIボタンおよびメニューイベントのバインド初期化
 * @param {Object} ctx 
 */
export function initUIBindings(ctx) {
    const {
        input,
        hud,
        Sound,
        NetworkManager,
        initGame,
        UIController,
        EntryShield,
        getPlayer
    } = ctx;

    // 1. ズーム操作ボタン
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');

    if (btnZoomIn) {
        btnZoomIn.onclick = (e) => {
            e.stopPropagation();
            input.zoomMultiplier = Math.min(1.40, input.zoomMultiplier + 0.12);
            updateZoomButtonsState(input.zoomMultiplier);
        };
    }
    if (btnZoomOut) {
        btnZoomOut.onclick = (e) => {
            e.stopPropagation();
            input.zoomMultiplier = Math.max(0.45, input.zoomMultiplier - 0.12);
            updateZoomButtonsState(input.zoomMultiplier);
        };
    }

    // 2. ランキング ＆ レーダーマップトグルボタン
    const btnToggleRanking = document.getElementById('btn-toggle-ranking');
    const btnToggleMap = document.getElementById('btn-toggle-map');

    if (btnToggleRanking) {
        btnToggleRanking.onclick = (e) => {
            e.stopPropagation();
            hud.toggleRanking();
        };
    }
    if (btnToggleMap) {
        btnToggleMap.onclick = (e) => {
            e.stopPropagation();
            hud.toggleMap();
        };
    }

    // 3. サウンドON/OFFボタン
    const soundBtn = document.getElementById('btn-sound');
    if (soundBtn) {
        soundBtn.onclick = (e) => {
            e.stopPropagation();
            const isMuted = Sound.toggleMute();
            soundBtn.classList.toggle('active', !isMuted);
            const iconOff = document.getElementById('icon-sound-off');
            const iconOn = document.getElementById('icon-sound-on');
            if (iconOff) iconOff.style.display = isMuted ? 'block' : 'none';
            if (iconOn) iconOn.style.display = isMuted ? 'none' : 'block';
        };
    }

    // 4. ロビー：ソロプレイ開始ボタン（iOS連打デバウンス付）
    const btnLobbySolo = document.getElementById('btn-lobby-solo');
    if (btnLobbySolo) {
        let lastSoloTap = 0;
        const onSoloTap = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            const now = Date.now();
            if (now - lastSoloTap < 1000) return;
            lastSoloTap = now;

            NetworkManager.isMultiplayerActive = false;
            NetworkManager.isHost = true;
            NetworkManager.mySlot = 0;
            initGame();
        };
        btnLobbySolo.addEventListener('touchend', onSoloTap, { passive: false });
        btnLobbySolo.addEventListener('click', onSoloTap);
    }

    // 5. ロビー：公開ルーム作成ボタン
    const btnLobbyPublic = document.getElementById('btn-lobby-public');
    if (btnLobbyPublic) {
        let lastPubTap = 0;
        const onPubTap = async (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            const now = Date.now();
            if (now - lastPubTap < 1000) return;
            lastPubTap = now;

            EntryShield.show('CONNECTING...', '公開ルームを作成中');
            const roomId = await NetworkManager.createRoom(false);
            EntryShield.hide();
            if (roomId) UIController.showWaitingRoom(roomId);
        };
        btnLobbyPublic.addEventListener('touchend', onPubTap, { passive: false });
        btnLobbyPublic.addEventListener('click', onPubTap);
    }

    // 6. ロビー：プライベートルーム作成ボタン
    const btnLobbyPrivate = document.getElementById('btn-lobby-private');
    if (btnLobbyPrivate) {
        let lastPrivTap = 0;
        const onPrivTap = async (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            const now = Date.now();
            if (now - lastPrivTap < 1000) return;
            lastPrivTap = now;

            EntryShield.show('CONNECTING...', 'プライベートルームを作成中');
            const roomId = await NetworkManager.createRoom(true);
            EntryShield.hide();
            if (roomId) UIController.showWaitingRoom(roomId);
        };
        btnLobbyPrivate.addEventListener('touchend', onPrivTap, { passive: false });
        btnLobbyPrivate.addEventListener('click', onPrivTap);
    }

    // 7. ロビー：公開ルーム一覧更新ボタン
    const btnRefreshRooms = document.getElementById('btn-refresh-rooms');
    if (btnRefreshRooms) {
        let lastRefTap = 0;
        const onRefTap = async (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            const now = Date.now();
            if (now - lastRefTap < 1000) return;
            lastRefTap = now;

            btnRefreshRooms.innerText = '更新中...';
            const rooms = await NetworkManager.getPublicRooms();
            btnRefreshRooms.innerText = '更新';

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
                        <span class="room-item-count">参加者: ${r.gamer_num || 1} / 4名</span>
                    </div>
                    <button type="button" class="btn-join-room" data-room="${r.room_id}">参加</button>
                </div>
            `).join('');

            container.querySelectorAll('.btn-join-room').forEach(btn => {
                let lastJoinTap = 0;
                const onJoin = async (ev) => {
                    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
                    const jnow = Date.now();
                    if (jnow - lastJoinTap < 1000) return;
                    lastJoinTap = jnow;

                    const rid = btn.dataset.room;
                    EntryShield.show(`ROOM #${rid.slice(-5)}`, '入室しています...');
                    const res = await NetworkManager.joinRoom(rid);
                    EntryShield.hide();
                    if (res.success) {
                        UIController.showWaitingRoom(rid);
                    } else {
                        Danmaku.push('エラー', res.msg, '#f43f5e', true);
                    }
                };
                btn.addEventListener('touchend', onJoin, { passive: false });
                btn.addEventListener('click', onJoin);
            });
        };
        btnRefreshRooms.addEventListener('touchend', onRefTap, { passive: false });
        btnRefreshRooms.addEventListener('click', onRefTap);
    }

    // 8. 待機室：ホスト専用ゲーム開始ボタン
    const btnWaitingStart = document.getElementById('btn-waiting-start');
    if (btnWaitingStart) {
        btnWaitingStart.onclick = () => {
            if (!NetworkManager.isHost) return;
            initGame();
        };
    }

    // 9. 待機室：退室ボタン
    const btnWaitingLeave = document.getElementById('btn-waiting-leave');
    if (btnWaitingLeave) {
        btnWaitingLeave.onclick = async () => {
            EntryShield.show('DISCONNECTING...', '退室しています...');
            await NetworkManager.exitRoom();
            EntryShield.hide();
            UIController.showLobby();
        };
    }

    // 10. メニュー着せ替えコールバック初期化
    Menu.init((face, color) => {
        const p = getPlayer();
        if (p) {
            p.face = face;
            p.color = color;
        }
        Danmaku.push('システム', 'アバターを変更しました', color, true);
    });

    // 11. リザルト画面：リトライボタン（リザルト画面即時非表示 ＆ 復帰）
    const btnRetry = document.getElementById('btn-retry');
    if (btnRetry) {
        btnRetry.onclick = () => {
            const overScreen = document.getElementById('over-screen');
            if (overScreen) {
                overScreen.style.display = 'none';
            }

            if (NetworkManager.isMultiplayerActive) {
                UIController.showWaitingRoom(NetworkManager.currentRoomId);
            } else {
                initGame();
            }
        };
    }
}