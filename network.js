// ==============================================================================
// 『くねくねバトル オンライン』AgentSDK公式マルチプレイ通信マネージャー (network.js)
// v24.2.0 主語バッジ統一＆入退室対通知・不要弾幕全廃版:
// ・全弾幕を「[ 名前バッジ ] + アクション（入室！ / 退室！）」へ刷新し主語を統一
// ・「ルーム作成」「合流」「ホスト昇格」「ゲーム開始」「退出」等の不要システム弾幕を完全全廃
// ・GRAVITY公式最大上限 6名スロット（0〜5）完全対応
// ・USER_JOIN および ROOM_MEMBERS_SYNC でのアバター portrait 完全伝播
// ・送信ループ・アクションキューを net_broadcaster.js へ完全分離（コード半減）
// ・AgentSDK公式ルームAPI（作成・参加・退出・一覧）の安全トランザクション排他ロック
// ・本命ルーム誤退室（自爆 exit()）の完全防止ガード配備
// ・自律ホスト昇格（Host Migration）＆ ホスト昇格時待機室UI完全再活性化
// ==============================================================================

import {
    decodeTupleToSnake,
    unpackFoodPickTuple,
    unpackDropFoodTuple,
    unpackChatTuple,
    generateClientId
} from './net_protocol.js';

import { NetBroadcaster } from './net_broadcaster.js';
import { Danmaku } from './danmaku.js';
import { Menu } from './menu.js';
import { updateLobbyGreeting } from './dom.js';
import { SNAKE_COLORS, MAX_PLAYERS } from './constants.js';

/**
 * 未入室時の exit() による無限保留（Promiseハング）および本命ルーム誤退室を防ぐ安全退出ヘルパー
 * ★ 目的の部屋（targetRoomId）に既にいる場合、exit() を絶対に呼ばない！
 */
async function safeExitCurrentRoom(targetRoomId = null) {
    if (typeof window === 'undefined' || !window.AgentSDK || !window.AgentSDK.room) return;
    try {
        if (typeof window.AgentSDK.room.getRoomId === 'function') {
            const res = await window.AgentSDK.room.getRoomId();
            const activeRoomId = (res && typeof res.room_id === 'string')
                ? res.room_id
                : (res && res.data && res.data.room_id ? res.data.room_id : '');
            
            if (!activeRoomId || activeRoomId === '') return;

            // 既に目的のルームに入室中の場合は exit() をスキップ（自爆退室防止）
            if (targetRoomId && String(activeRoomId) === String(targetRoomId)) {
                console.log(`[network.js] Already in target room #${activeRoomId}. Skipping redundant exit().`);
                return;
            }
        }
        const exitPromise = window.AgentSDK.room.exit();
        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 700));
        await Promise.race([exitPromise, timeoutPromise]);
        await new Promise(r => setTimeout(r, 200));
    } catch (e) {
        console.warn('[network.js] safeExitCurrentRoom caught:', e);
    }
}

export const NetworkManager = {
    isSDKAvailable: typeof window !== 'undefined' && !!window.AgentSDK,
    currentRoomId: null,
    clientId: generateClientId(),
    myUser: { name: 'あなた', user_id: 'local_user', portrait: '' },

    // GRAVITY公式上限の 6名スロット（0〜5）に完全整合
    slots: Array.from({ length: MAX_PLAYERS }, (_, i) => ({
        slot: i,
        clientId: null,
        userId: null,
        name: i === 0 ? 'ホスト' : `プレイヤー ${i + 1}`,
        color: SNAKE_COLORS[i % SNAKE_COLORS.length],
        portrait: '',
        isAI: i !== 0,
        joinTime: 0
    })),

    isHost: false,
    isMultiplayerActive: false,
    mySlot: 0,
    currentSeed: 12345678,

    _isCreatingRoom: false,
    _isJoiningRoom: false,

    _hasRegisteredListener: false,
    _watchdogIntervalId: null,
    _lastHostPacketTime: 0,
    _hasReceivedFirstHostPacket: false,
    _isPromoting: false,

    callbacks: {
        onRemoteSnakeUpdate: null,
        onFoodPicked: null,
        onDropSpawned: null,
        onDropClusterSpawned: null,
        onSeedReceived: null,
        onGameStart: null,
        onLeaderboardSync: null
    },

    setCallbacks(cb) {
        this.callbacks = { ...this.callbacks, ...cb };
    },

    // --- キューイングAPI（NetBroadcaster へ委譲） ---
    queueFoodPick(gx, gy, foodIndex) {
        if (!this.isMultiplayerActive) return;
        NetBroadcaster.queueFoodPick(gx, gy, foodIndex);
    },

    queueDropFood(x, y, val, colorIdx) {
        if (!this.isMultiplayerActive) return;
        NetBroadcaster.queueDropFood(x, y, val, colorIdx);
    },

    queueDropCluster(x, y, totalVal, count, colorIdx) {
        if (!this.isMultiplayerActive) return;
        NetBroadcaster.queueDropCluster(x, y, totalVal, count, colorIdx);
    },

    queueChat(messageText) {
        if (!messageText) return;
        const cleanText = String(messageText).trim().slice(0, 15);
        if (!cleanText) return;

        const myName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
            ? window.GRAVITY_USER_NAME
            : this.myUser.name;
        const myColor = SNAKE_COLORS[this.mySlot % SNAKE_COLORS.length];
        
        // ★ 主語バッジ統一チャット：[ ユーザー名 ] 本文
        Danmaku.push(myName, cleanText, myColor);

        if (this.isMultiplayerActive) {
            NetBroadcaster.queueChat(this.mySlot, cleanText);
        }
    },

    /**
     * ホスト専用：待機室から全端末へゲーム開始を一斉通知する
     * ★ 不要な「ゲームを開始します！」弾幕ログは完全撤去
     */
    broadcastStartGame() {
        if (!this.isMultiplayerActive || !this.isHost) return;
        this._sendCustomMessage({
            e: 'START_GAME',
            seed: this.currentSeed
        });
    },

    /**
     * ユーザー情報取得
     */
    async init() {
        if (!this.isSDKAvailable) {
            console.warn('[NetworkManager] AgentSDK unavailable. Standalone mode.');
            return this.myUser;
        }

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const res = await window.AgentSDK.user.getMyUserInfo();
                const uData = res && res.data ? res.data : res;
                if (uData && (uData.name || uData.user_name || uData.nickname)) {
                    const resolvedName = uData.name || uData.user_name || uData.nickname;
                    const portraitUrl = uData.portrait || uData.portait || uData.avatar || '';
                    this.myUser = {
                        user_id: String(uData.user_id || uData.uid || 'local_user'),
                        name: resolvedName,
                        portrait: portraitUrl
                    };
                    window.GRAVITY_USER_NAME = resolvedName;

                    updateLobbyGreeting(resolvedName);

                    if (window.localPlayerInstance) {
                        window.localPlayerInstance.name = resolvedName;
                    }

                    // 走者タブ・待機室用に自身のスロットのアバターを更新
                    if (this.slots[this.mySlot]) {
                        this.slots[this.mySlot].name = resolvedName;
                        this.slots[this.mySlot].portrait = portraitUrl;
                    }

                    console.log(`[NetworkManager] GRAVITY User Authenticated: ${resolvedName} (UID: ${this.myUser.user_id})`);
                    return this.myUser;
                }
            } catch (err) {
                console.warn(`[NetworkManager] Failed to get user info (Attempt ${attempt}/3):`, err);
                await new Promise(r => setTimeout(r, 400));
            }
        }
        return this.myUser;
    },

    ensureMessageListener() {
        if (!this.isSDKAvailable || this._hasRegisteredListener) return;
        this._hasRegisteredListener = true;

        try {
            window.AgentSDK.room.receiveMessage((payload) => {
                if (!payload) return;
                const type = payload.type || (payload.data && payload.data.type);
                const data = payload.data !== undefined ? payload.data : payload;

                switch (type) {
                    case 'aitools_game_joinroom':
                        this._handleUserJoined(data);
                        break;
                    case 'aitools_game_exitroom':
                        this._handleUserExited(data);
                        break;
                    case 'aitools_game_sendmsg':
                        this._handleCustomMessage(payload);
                        break;
                    default:
                        if (payload.msg_data || payload.message || payload.event || payload.e || (payload.data && (payload.data.msg_data || payload.data.message))) {
                            this._handleCustomMessage(payload);
                        }
                        break;
                }
            });
        } catch (err) {
            console.warn('[NetworkManager] receiveMessage setup failed:', err);
        }
    },

    /**
     * ルーム作成（最大6名）
     * ★ 不要な「ルームを作成しました」弾幕ログは完全撤去
     */
    async createRoom(isPrivate = false) {
        if (!this.isSDKAvailable) {
            Danmaku.push('エラー', 'マルチプレイはGRAVITYアプリ内でのみ利用可能です', '#f43f5e', true);
            return null;
        }

        if (this._isCreatingRoom || this._isJoiningRoom) {
            console.warn('[NetworkManager] Room transaction is already in progress.');
            return null;
        }
        this._isCreatingRoom = true;

        try {
            await this.init();
            await safeExitCurrentRoom(null);
            this.purgeLocalWorldState();

            const permission = isPrivate ? 1 : 0;
            const res = await window.AgentSDK.room.create({ max_players: MAX_PLAYERS, room_permission: permission });

            let isSuccess = false;
            let createdRoomId = null;

            if (res) {
                if (res.errno === 0 || res.errno === '0' || res.code === 0 || res.code === '0') {
                    isSuccess = true;
                } else if (res.data && (res.data.room_id || res.data.roomId)) {
                    isSuccess = true;
                } else if (res.room_id || res.roomId) {
                    isSuccess = true;
                }
            }

            if (res && res.data && (res.data.room_id || res.data.roomId)) {
                createdRoomId = String(res.data.room_id || res.data.roomId);
            } else if (res && (res.room_id || res.roomId)) {
                createdRoomId = String(res.room_id || res.roomId);
            }

            if (!isSuccess && res && (res.errno !== undefined || res.code !== undefined)) {
                const errMsg = res.errmsg || res.msg || res.message || '部屋の作成に失敗しました';
                console.error(`[NetworkManager] Failed to create room: ${errMsg}`);
                Danmaku.push('作成失敗', errMsg, '#f43f5e', true);
                return null;
            }

            if (!createdRoomId) {
                Danmaku.push('作成失敗', 'ルームIDが取得できませんでした', '#f43f5e', true);
                return null;
            }

            this.currentRoomId = createdRoomId;
            this.clientId = generateClientId();
            this.ensureMessageListener();

            this.isHost = true;
            this.mySlot = 0;
            this.isMultiplayerActive = true;
            this.currentSeed = Math.floor(Math.random() * 90000000) + 10000000;

            const myResolvedName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
                ? window.GRAVITY_USER_NAME
                : this.myUser.name;

            // ホスト（スロット0）の確定
            this.slots[0] = {
                slot: 0,
                clientId: this.clientId,
                userId: this.myUser.user_id,
                name: myResolvedName,
                color: SNAKE_COLORS[0],
                portrait: this.myUser.portrait || '',
                isAI: false,
                joinTime: performance.now()
            };

            // スロット1〜5を待機状態へ初期化
            for (let i = 1; i < MAX_PLAYERS; i++) {
                this.slots[i] = {
                    slot: i,
                    clientId: null,
                    userId: null,
                    name: `プレイヤー ${i + 1}`,
                    color: SNAKE_COLORS[i % SNAKE_COLORS.length],
                    portrait: '',
                    isAI: true,
                    joinTime: 0
                };
            }

            this._stopHostWatchdog();
            this._startBroadcasting();

            return this.currentRoomId;
        } catch (err) {
            console.error('[NetworkManager] createRoom exception:', err);
            Danmaku.push('通信エラー', 'ルーム作成中に例外が発生しました', '#f43f5e', true);
            return null;
        } finally {
            setTimeout(() => {
                this._isCreatingRoom = false;
            }, 600);
        }
    },

    /**
     * ルーム参加
     * ★ 不要な「ルームに合流しました」弾幕ログは完全撤去
     */
    async joinRoom(roomId) {
        if (!this.isSDKAvailable || !roomId) return { success: false, msg: '無効な操作です' };

        if (this._isCreatingRoom || this._isJoiningRoom) {
            console.warn('[NetworkManager] Room transaction is already in progress.');
            return { success: false, msg: '処理中です' };
        }
        this._isJoiningRoom = true;
        const safeRoomId = String(roomId);

        try {
            await this.init();
            await safeExitCurrentRoom(safeRoomId);
            this.purgeLocalWorldState();

            const res = await window.AgentSDK.room.join({ room_id: safeRoomId });

            let isSuccess = false;
            if (res) {
                if (res.errno === 0 || res.errno === '0' || res.code === 0 || res.code === '0') {
                    isSuccess = true;
                } else if (res.data && (res.data.room_id || res.data.roomId)) {
                    isSuccess = true;
                }
            }

            if (!isSuccess && res && (res.errno !== undefined || res.code !== undefined)) {
                const errMsg = res.errmsg || res.msg || res.message || '入室できませんでした';
                console.error(`[NetworkManager] Failed to join room: ${errMsg}`);
                Danmaku.push('エラー', errMsg, '#f43f5e', true);
                return { success: false, msg: errMsg };
            }

            this.currentRoomId = safeRoomId;
            this.clientId = generateClientId();
            this.ensureMessageListener();

            this.isHost = false;
            this.isMultiplayerActive = true;
            this.mySlot = 1;

            const myResolvedName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
                ? window.GRAVITY_USER_NAME
                : this.myUser.name;

            // 6枠のスロットをリセットし、スロット1へ仮バインド
            for (let i = 0; i < MAX_PLAYERS; i++) {
                this.slots[i] = {
                    slot: i,
                    clientId: null,
                    userId: null,
                    name: i === 0 ? 'ホスト' : `プレイヤー ${i + 1}`,
                    color: SNAKE_COLORS[i % SNAKE_COLORS.length],
                    portrait: '',
                    isAI: true,
                    joinTime: 0
                };
            }

            this.slots[1] = {
                slot: 1,
                clientId: this.clientId,
                userId: this.myUser.user_id,
                name: myResolvedName,
                color: SNAKE_COLORS[1],
                portrait: this.myUser.portrait || '',
                isAI: false,
                joinTime: performance.now()
            };

            this._startHostWatchdog();
            this._startBroadcasting();

            // 入室直後にホストへ自発参加通知
            setTimeout(() => {
                this._sendCustomMessage({
                    e: 'USER_JOIN',
                    clientId: this.clientId,
                    user_id: this.myUser.user_id,
                    name: myResolvedName,
                    portrait: this.myUser.portrait || ''
                });
            }, 100);

            return { success: true };
        } catch (err) {
            console.error('[NetworkManager] joinRoom exception:', err);
            Danmaku.push('通信エラー', '入室中に例外が発生しました', '#f43f5e', true);
            return { success: false, msg: 'ネットワーク通信例外' };
        } finally {
            setTimeout(() => {
                this._isJoiningRoom = false;
            }, 600);
        }
    },

    async getPublicRooms() {
        if (!this.isSDKAvailable) return [];
        try {
            const res = await window.AgentSDK.room.getPublicRoomList();
            let list = null;
            if (res) {
                if (Array.isArray(res)) list = res;
                else if (res.data && Array.isArray(res.data.list)) list = res.data.list;
                else if (res.data && Array.isArray(res.data)) list = res.data;
                else if (Array.isArray(res.list)) list = res.list;
            }
            if (Array.isArray(list)) {
                return list.filter(r => (Number(r.gamer_num) || 0) > 0 && (Number(r.gamer_num) || 0) < MAX_PLAYERS);
            }
        } catch (err) {
            console.warn('[NetworkManager] Failed to get public room list:', err);
        }
        return [];
    },

    /**
     * プレイヤー参加処理
     * ★ 主語バッジ統一フォーマット：[ ユーザー名 ] 入室！
     */
    _handleUserJoined(data) {
        if (!this.isHost || !data) return;
        const userId = String(data.user_id || data.userId || '');
        if (!userId || userId === String(this.myUser.user_id)) return;

        const guestName = data.name || data.user_name || 'ゲスト';
        const guestPortrait = data.portrait || data.portait || data.avatar || '';
        let targetSlot = this.slots.findIndex(s => s.userId && String(s.userId) === userId);

        if (targetSlot === -1) {
            for (let i = 1; i < this.slots.length; i++) {
                if (this.slots[i].isAI) {
                    targetSlot = i;
                    break;
                }
            }
        }

        if (targetSlot !== -1) {
            this.slots[targetSlot] = {
                slot: targetSlot,
                clientId: data.clientId || null,
                userId: userId,
                name: guestName,
                color: SNAKE_COLORS[targetSlot % SNAKE_COLORS.length],
                portrait: guestPortrait,
                isAI: false,
                joinTime: performance.now()
            };

            // 全端末へ6人スロット確定一覧を一斉同期
            this._sendCustomMessage({
                e: 'ROOM_MEMBERS_SYNC',
                slots: this.slots,
                seed: this.currentSeed
            });

            if (typeof window !== 'undefined' && window.UIController && typeof window.UIController.updateWaitingMembersList === 'function') {
                window.UIController.updateWaitingMembersList();
            }

            Menu.updateParticipants(this.slots.filter(s => !s.isAI));

            // ★ 主語バッジ統一入室通知：[ guestName ] 入室！
            Danmaku.push(guestName, '入室！', this.slots[targetSlot].color);
        }
    },

    /**
     * プレイヤー退出処理
     * ★ 主語バッジ統一フォーマット：[ ユーザー名 ] 退室！
     */
    _handleUserExited(data) {
        if (!data) return;
        const userId = String(data.user_id || data.userId || '');
        const slotIdx = this.slots.findIndex(s => s.userId && String(s.userId) === userId);

        if (slotIdx !== -1) {
            const exitedName = this.slots[slotIdx].name;
            const isHostExited = (slotIdx === 0 && !this.isHost);

            this.slots[slotIdx] = {
                slot: slotIdx,
                clientId: null,
                userId: null,
                name: `プレイヤー ${slotIdx + 1}`,
                color: SNAKE_COLORS[slotIdx % SNAKE_COLORS.length],
                portrait: '',
                isAI: true,
                joinTime: 0
            };

            // ★ 主語バッジ統一退室通知：[ exitedName ] 退室！
            Danmaku.push(exitedName, '退室！', '#64748b');

            if (typeof window !== 'undefined' && window.UIController && typeof window.UIController.updateWaitingMembersList === 'function') {
                window.UIController.updateWaitingMembersList();
            }

            Menu.updateParticipants(this.slots.filter(s => !s.isAI));

            if (isHostExited) {
                console.warn('[NetworkManager] ホストが退出しました。自律ホスト昇格を実行します。');
                this.promoteToHost();
            } else if (this.isHost) {
                this._sendCustomMessage({
                    e: 'ROOM_MEMBERS_SYNC',
                    slots: this.slots,
                    seed: this.currentSeed
                });
            }
        }
    },

    _startHostWatchdog() {
        this._stopHostWatchdog();
        this._lastHostPacketTime = performance.now();
        this._hasReceivedFirstHostPacket = false;

        this._watchdogIntervalId = setInterval(() => {
            if (!this.isMultiplayerActive || this.isHost) {
                this._stopHostWatchdog();
                return;
            }

            const elapsed = performance.now() - this._lastHostPacketTime;
            const timeoutThreshold = this._hasReceivedFirstHostPacket ? 5000 : 8000;

            if (elapsed > timeoutThreshold) {
                console.warn(`[NetworkManager] ホストからのパケット途絶検知 (${Math.round(elapsed)}ms)。自律ホスト昇格を実行`);
                this.promoteToHost();
            }
        }, 500);
    },

    _stopHostWatchdog() {
        if (this._watchdogIntervalId) {
            clearInterval(this._watchdogIntervalId);
            this._watchdogIntervalId = null;
        }
    },

    /**
     * 自律ホスト昇格
     * ★ 不要な「あなたが新しいホストに昇格しました」弾幕ログは完全撤去
     */
    promoteToHost() {
        if (this._isPromoting || this.isHost) return;
        this._isPromoting = true;
        this._stopHostWatchdog();

        this.isHost = true;
        this.mySlot = 0;

        const myResolvedName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
            ? window.GRAVITY_USER_NAME
            : this.myUser.name;

        this.slots[0] = {
            slot: 0,
            clientId: this.clientId,
            userId: this.myUser.user_id,
            name: myResolvedName,
            color: SNAKE_COLORS[0],
            portrait: this.myUser.portrait || '',
            isAI: false,
            joinTime: performance.now()
        };

        const startBtn = document.getElementById('btn-waiting-start');
        if (startBtn) {
            startBtn.style.display = 'block';
        }

        if (typeof window !== 'undefined' && window.UIController && typeof window.UIController.updateWaitingMembersList === 'function') {
            window.UIController.updateWaitingMembersList();
        }

        Menu.updateParticipants(this.slots.filter(s => !s.isAI));
        this._isPromoting = false;
    },

    _startBroadcasting() {
        NetBroadcaster.start(this);
    },

    _handleCustomMessage(data) {
        if (!data) return;
        try {
            let rawStr = '';
            if (data.data && typeof data.data.msg_data === 'string') rawStr = data.data.msg_data;
            else if (typeof data.msg_data === 'string') rawStr = data.msg_data;
            else if (data.data && typeof data.data.message === 'string') rawStr = data.data.message;
            else if (typeof data.message === 'string') rawStr = data.message;
            else if (typeof data === 'string') rawStr = data;

            let packet = null;
            if (rawStr) {
                try { packet = JSON.parse(rawStr); } catch (e) { packet = null; }
            }
            if (!packet && typeof data === 'object') {
                if (data.e || data.event) packet = data;
                else if (data.data && typeof data.data === 'object') packet = data.data;
            }
            if (!packet) return;

            const eventType = packet.e || packet.event;
            this._lastHostPacketTime = performance.now();
            this._hasReceivedFirstHostPacket = true;

            // ホストからのゲーム開始合図を受信
            if (eventType === 'START_GAME') {
                if (packet.seed && packet.seed !== this.currentSeed) {
                    this.currentSeed = packet.seed;
                }
                if (this.callbacks.onGameStart) {
                    this.callbacks.onGameStart(packet);
                }
                return;
            }

            // ゲストからの自発的参加通知を受信
            if (eventType === 'USER_JOIN' && this.isHost) {
                this._handleUserJoined(packet);
                return;
            }

            if (eventType === 'P' || eventType === 'POS') {
                const incomingList = packet.l || packet.list;
                if (Array.isArray(incomingList)) {
                    for (let i = 0; i < incomingList.length; i++) {
                        const decoded = decodeTupleToSnake(incomingList[i]);
                        if (decoded && decoded.slot !== this.mySlot && this.callbacks.onRemoteSnakeUpdate) {
                            this.callbacks.onRemoteSnakeUpdate(decoded);
                        }
                    }
                }

                // リーダーボード同期情報の受信処理
                if (packet.lb && this.callbacks.onLeaderboardSync) {
                    this.callbacks.onLeaderboardSync(packet.lb);
                }

                if (Array.isArray(packet.pk)) {
                    packet.pk.forEach(tuple => {
                        const pick = unpackFoodPickTuple(tuple);
                        if (this.callbacks.onFoodPicked) this.callbacks.onFoodPicked(pick);
                    });
                }

                if (Array.isArray(packet.dp)) {
                    packet.dp.forEach(tuple => {
                        const drop = unpackDropFoodTuple(tuple);
                        if (this.callbacks.onDropSpawned) this.callbacks.onDropSpawned(drop);
                    });
                }

                if (Array.isArray(packet.dc)) {
                    packet.dc.forEach(cluster => {
                        if (this.callbacks.onDropClusterSpawned) this.callbacks.onDropClusterSpawned(cluster);
                    });
                }

                if (Array.isArray(packet.ch)) {
                    packet.ch.forEach(tuple => {
                        const chat = unpackChatTuple(tuple);
                        if (chat && chat.slot !== this.mySlot) {
                            const senderSlot = chat.slot;
                            const senderName = this.slots[senderSlot] ? this.slots[senderSlot].name : `P${senderSlot + 1}`;
                            const badgeColor = SNAKE_COLORS[senderSlot % SNAKE_COLORS.length];
                            // 主語バッジ統一チャット
                            Danmaku.push(senderName, chat.message, badgeColor);
                        }
                    });
                }
                return;
            }

            if (eventType === 'ROOM_MEMBERS_SYNC' || eventType === 'SYNC_MEMBERS') {
                if (Array.isArray(packet.slots)) {
                    this.slots = packet.slots;

                    const mySlotData = this.slots.find(s => 
                        (s.userId && String(s.userId) === String(this.myUser.user_id)) ||
                        (s.clientId && s.clientId === this.clientId)
                    );
                    if (mySlotData) {
                        this.mySlot = mySlotData.slot;
                        if (window.localPlayerInstance) {
                            window.localPlayerInstance.color = mySlotData.color;
                        }
                    }

                    if (typeof window !== 'undefined' && window.UIController && typeof window.UIController.updateWaitingMembersList === 'function') {
                        window.UIController.updateWaitingMembersList();
                    }

                    Menu.updateParticipants(this.slots.filter(s => !s.isAI));
                }
                if (packet.seed && packet.seed !== this.currentSeed) {
                    this.currentSeed = packet.seed;
                    if (this.callbacks.onSeedReceived) this.callbacks.onSeedReceived(packet.seed);
                }
            }
        } catch (err) {
            console.warn('[NetworkManager] handleCustomMessage error:', err);
        }
    },

    _sendCustomMessage(msgObj) {
        NetBroadcaster.sendCustomMessage(msgObj);
    },

    purgeLocalWorldState() {
        this._stopHostWatchdog();
        NetBroadcaster.purge();
        this._lastHostPacketTime = 0;
        this._hasReceivedFirstHostPacket = false;
        this._isPromoting = false;
    },

    async exitRoom() {
        this.purgeLocalWorldState();
        await safeExitCurrentRoom(null);
        this.currentRoomId = null;
        this.isHost = false;
        this.isMultiplayerActive = false;
        this.mySlot = 0;
    }
};
if (typeof window !== 'undefined') window.NetworkManager = NetworkManager;