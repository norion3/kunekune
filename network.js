// ==============================================================================
// 『くねくねバトル オンライン』AgentSDK公式マルチプレイ通信マネージャー (network.js)
// v35.0.0 ホスト昇格時Slot0引越し＆スプリットブレイン完全根絶版:
// ・【ホスト昇格時のSlot 0引越し＆元スロット解放】
// 　旧ホスト退室による自律ホスト昇格時（promoteToHost）、新ホストのデータを
// 　Slot 0 へ正式にコピー移行し、元いたスロット（Slot 1等）を空き枠(isAI: true)として解放！
// 　mySlot および window.localPlayerInstance.id を 0 に即時更新することで、
// 　退室と再入室を繰り返してもホスト表示・権限がねじれる現象を100%完全根絶
// ・【START_GAME ゲームオーバー中完全遮断維持】
// ・【メモリリーク完全防止維持】_recentlyExitedRoomIds の20件ローテーション破棄
// ・【被撃破判定同期(victimSlot)維持】broadcastKill 同期
// ・【リザルト画面の誤リセット完全遮断維持】waiting 状態限定
// ・【開始合図3連バースト送信維持】0ms, 60ms, 150ms 冗長送信
// ・【待機室誤脱出完全防止維持】packet.act === true 厳格判定
// ・【旧ルーム残留・ゴースト部屋完全根絶維持】safeExitCurrentRoom
// ・【ゲスト入室時ホスト枠(Slot 0)整合性保証維持】isAI: (i !== 0) 初期化
// ・【再入室時ゴースト完全パージ維持】onWorldPurged コールバック連携
// ・【餌同期の絶対座標化維持】queueFoodPick (x, y) 運用
// ・【絵文字文字化け修正維持】queueChat のサロゲートペア分断防止
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
 * 直前に退出・解散したルームIDのキャッシュ（ゴースト部屋表示防止用）
 * メモリリーク防止のため最大20件でローテーション破棄
 */
const _recentlyExitedRoomIds = new Set();
const MAX_RECENT_ROOM_CACHE = 20;

function addRecentlyExitedRoomId(roomId) {
    if (!roomId) return;
    const strId = String(roomId).trim();
    if (!strId) return;

    if (_recentlyExitedRoomIds.size >= MAX_RECENT_ROOM_CACHE) {
        // 最も古い要素を1件取り出して削除（メモリリーク防止）
        const oldest = _recentlyExitedRoomIds.values().next().value;
        if (oldest !== undefined) {
            _recentlyExitedRoomIds.delete(oldest);
        }
    }
    _recentlyExitedRoomIds.add(strId);
}

/**
 * 安全かつ確実に現在ルームを脱出・解散するヘルパー
 * 型揺らぎ（string / number / camelCase）に対応し、確実に room.exit() を完了させる
 */
async function safeExitCurrentRoom(targetRoomId = null) {
    if (typeof window === 'undefined' || !window.AgentSDK || !window.AgentSDK.room) return;
    
    try {
        let activeRoomId = null;

        // 1. 現在参加中ルームIDの取得試行（型の揺らぎを完全吸収）
        if (typeof window.AgentSDK.room.getRoomId === 'function') {
            try {
                const res = await window.AgentSDK.room.getRoomId();
                const rawId = (res && (res.room_id ?? res.roomId)) 
                    ?? (res && res.data && (res.data.room_id ?? res.data.roomId));
                if (rawId !== undefined && rawId !== null && String(rawId).trim() !== '') {
                    activeRoomId = String(rawId).trim();
                }
            } catch (idErr) {
                console.warn('[network.js] getRoomId query error:', idErr);
            }
        }

        // 目的の部屋に既にいる場合は無駄なexitをスキップ
        if (targetRoomId && activeRoomId && String(activeRoomId) === String(targetRoomId)) {
            console.log(`[network.js] Already in target room #${activeRoomId}. Skipping redundant exit().`);
            return;
        }

        // 直前の部屋IDをキャッシュに記録（一覧からのゴースト除外用・上限ローテーション付き）
        if (activeRoomId) {
            addRecentlyExitedRoomId(activeRoomId);
        }

        // 2. 確実に room.exit() を発火して完了を待機
        if (typeof window.AgentSDK.room.exit === 'function') {
            const exitPromise = window.AgentSDK.room.exit();
            const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 800));
            await Promise.race([exitPromise, timeoutPromise]);
            // サーバー側でのルーム解散・リスト除外ラグを吸収するための安定ウェイト
            await new Promise(r => setTimeout(r, 250));
        }
    } catch (e) {
        console.warn('[network.js] safeExitCurrentRoom caught:', e);
    }
}

export const NetworkManager = {
    isSDKAvailable: typeof window !== 'undefined' && !!window.AgentSDK,
    currentRoomId: null,
    clientId: generateClientId(),
    myUser: { name: 'あなた', user_id: 'local_user', portrait: '' },

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
        onLeaderboardSync: null,
        onHostPromoted: null,
        onUserExited: null,
        onSurrenderedAsHost: null, // スプリットブレイン降格時のAIパージ用コールバック
        onWorldPurged: null,       // 再入室・ルーム遷移時のローカルゴースト走者完全消去コールバック
        onPlayerKilled: null       // 被撃破検知（相手端末によるキル確定）コールバック
    },

    setCallbacks(cb) {
        this.callbacks = { ...this.callbacks, ...cb };
    },

    // --- キューイングAPI ---
    // 餌取得同期（絶対座標 x, y）
    queueFoodPick(x, y) {
        if (!this.isMultiplayerActive) return;
        NetBroadcaster.queueFoodPick(x, y);
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
        
        // サロゲートペア（絵文字）の分断を防止する Array.from 切り詰め
        const cleanText = Array.from(String(messageText).trim()).slice(0, 15).join('');
        if (!cleanText) return;

        const myName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
            ? window.GRAVITY_USER_NAME
            : this.myUser.name;
        const myColor = SNAKE_COLORS[this.mySlot % SNAKE_COLORS.length];
        
        Danmaku.push(myName, cleanText, myColor);

        if (this.isMultiplayerActive) {
            NetBroadcaster.queueChat(this.mySlot, cleanText);
        }
    },

    // =========================================================================
    // ★ 【撃破チャット一斉同報API（被害者スロット同期対応）】
    // =========================================================================
    broadcastKill(killerName, victimName, color, victimSlot = null) {
        if (!this.isMultiplayerActive) return;
        this._sendCustomMessage({
            e: 'KILL_ALERT',
            kn: killerName,
            vn: victimName,
            col: color,
            vs: victimSlot,
            senderId: this.clientId
        });
    },

    /**
     * ブースト状態変化やリスポーン時の即時割り込み送信（Event-driven）
     */
    forceImmediateSync() {
        if (this.isMultiplayerActive) {
            NetBroadcaster.forceImmediateSync(this);
        }
    },

    // =========================================================================
    // ★ 【開始合図3連バースト送信】
    // 単発送信によるパケットロスを克服。0ms, 60ms, 150ms で3連続送信
    // =========================================================================
    broadcastStartGame() {
        if (!this.isMultiplayerActive || !this.isHost) return;
        
        const packet = {
            e: 'START_GAME',
            seed: this.currentSeed
        };

        // 1発目：即座に送信
        this._sendCustomMessage(packet);

        // 2発目：60ms後に再送（パケットロスおよびレートリミット救済）
        setTimeout(() => {
            if (this.isMultiplayerActive && this.isHost) {
                this._sendCustomMessage(packet);
            }
        }, 60);

        // 3発目：150ms後に再送（回線瞬断時のバックアップ）
        setTimeout(() => {
            if (this.isMultiplayerActive && this.isHost) {
                this._sendCustomMessage(packet);
            }
        }, 150);
    },

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
            
            if (this.currentRoomId) {
                addRecentlyExitedRoomId(this.currentRoomId);
            }
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
            _recentlyExitedRoomIds.delete(String(createdRoomId));

            this.clientId = generateClientId();
            this.ensureMessageListener();

            this.isHost = true;
            this.mySlot = 0;
            this.isMultiplayerActive = true;
            this.currentSeed = Math.floor(Math.random() * 90000000) + 10000000;

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
            if (this.currentRoomId && String(this.currentRoomId) !== safeRoomId) {
                addRecentlyExitedRoomId(this.currentRoomId);
            }
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
            _recentlyExitedRoomIds.delete(safeRoomId);
            this.clientId = generateClientId();
            this.ensureMessageListener();

            this.isHost = false;
            this.isMultiplayerActive = true;
            this.mySlot = 1;

            const myResolvedName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
                ? window.GRAVITY_USER_NAME
                : this.myUser.name;

            for (let i = 0; i < MAX_PLAYERS; i++) {
                this.slots[i] = {
                    slot: i,
                    clientId: null,
                    userId: null,
                    name: i === 0 ? 'ホスト' : `プレイヤー ${i + 1}`,
                    color: SNAKE_COLORS[i % SNAKE_COLORS.length],
                    portrait: '',
                    isAI: (i !== 0),
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
                return list.filter(r => {
                    const rId = String(r.room_id ?? r.roomId ?? '');
                    if (!rId) return false;
                    if (_recentlyExitedRoomIds.has(rId)) return false;
                    if (this.currentRoomId && String(this.currentRoomId) === rId) return false;
                    const num = Number(r.gamer_num ?? r.gamerNum ?? 0);
                    return num > 0 && num < MAX_PLAYERS;
                });
            }
        } catch (err) {
            console.warn('[NetworkManager] Failed to get public room list:', err);
        }
        return [];
    },

    _handleUserJoined(data) {
        if (!this.isHost || !data) return;
        const userId = String(data.user_id || data.userId || '');
        if (!userId || userId === String(this.myUser.user_id)) return;

        const guestName = data.name || data.user_name || 'ゲスト';
        const guestPortrait = data.portrait || data.portait || data.avatar || '';
        let targetSlot = this.slots.findIndex(s => s.userId && String(s.userId) === userId);

        if (targetSlot === -1) {
            for (let i = 0; i < this.slots.length; i++) {
                if (i === this.mySlot) continue;
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

            const isPlaying = (typeof window !== 'undefined' && window.currentGameState === 'playing');

            this._sendCustomMessage({
                e: 'ROOM_MEMBERS_SYNC',
                slots: this.slots,
                seed: this.currentSeed,
                act: isPlaying
            });

            this._sendCustomMessage({
                e: 'SYS_ALERT',
                sender: guestName,
                text: '入室！',
                col: this.slots[targetSlot].color,
                senderId: this.clientId
            });

            if (isPlaying) {
                this._sendCustomMessage({
                    e: 'START_GAME',
                    seed: this.currentSeed,
                    immediate: true
                });
            }

            if (typeof window !== 'undefined' && window.UIController && typeof window.UIController.updateWaitingMembersList === 'function') {
                window.UIController.updateWaitingMembersList();
            }

            Menu.updateParticipants(this.slots.filter(s => !s.isAI));
            Danmaku.push(guestName, '入室！', this.slots[targetSlot].color);
        }
    },

    _handleUserExited(data) {
        if (!data) return;
        const userId = String(data.user_id || data.userId || '');
        const slotIdx = this.slots.findIndex(s => s.userId && String(s.userId) === userId);

        if (slotIdx !== -1) {
            const exitedName = this.slots[slotIdx].name;
            const isHostExited = (slotIdx === 0 && !this.isHost);
            const isPlaying = (typeof window !== 'undefined' && window.currentGameState === 'playing');

            if (this.isHost && isPlaying && typeof window !== 'undefined') {
                let victimSnake = null;
                if (window.allSnakesInstance) {
                    victimSnake = window.allSnakesInstance.find(s => s.id === slotIdx);
                }
                if (victimSnake && !victimSnake.isDead) {
                    const colorIdx = SNAKE_COLORS.indexOf(victimSnake.color);
                    const safeColorIdx = colorIdx >= 0 ? colorIdx : 0;
                    const dropCount = Math.min(25, Math.max(10, Math.floor((victimSnake.historyLength || 16) / 2)));
                    const totalVal = Math.min(2000, Math.max(100, Math.floor(victimSnake.score * 0.22)));

                    this.queueDropCluster(
                        victimSnake.x,
                        victimSnake.y,
                        totalVal,
                        dropCount,
                        safeColorIdx
                    );
                }
            }

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

            if (this.callbacks.onUserExited) {
                this.callbacks.onUserExited(slotIdx);
            }

            Danmaku.push(exitedName, '退室！', '#64748b');

            if (this.isHost) {
                this._sendCustomMessage({
                    e: 'SYS_ALERT',
                    sender: exitedName,
                    text: '退室！',
                    col: '#64748b',
                    senderId: this.clientId
                });

                this._sendCustomMessage({
                    e: 'ROOM_MEMBERS_SYNC',
                    slots: this.slots,
                    seed: this.currentSeed,
                    act: isPlaying
                });
            }

            if (typeof window !== 'undefined' && window.UIController && typeof window.UIController.updateWaitingMembersList === 'function') {
                window.UIController.updateWaitingMembersList();
            }

            Menu.updateParticipants(this.slots.filter(s => !s.isAI));

            if (isHostExited) {
                console.warn('[NetworkManager] ホストが退出しました。自律ホスト昇格を実行します。');
                this.promoteToHost();
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

    // =========================================================================
    // ★ 【自律ホスト昇格（Slot 0 引越し＆スロットねじれ完全防止）】
    // =========================================================================
    promoteToHost() {
        if (this._isPromoting || this.isHost) return;
        this._isPromoting = true;
        this._stopHostWatchdog();

        this.isHost = true;

        const oldSlot = this.mySlot;

        // 1. 新ホスト（自分）のデータを Slot 0 へ正式に引越しコピー
        const myData = this.slots[oldSlot] || {
            name: this.myUser.name || 'ホスト',
            color: SNAKE_COLORS[0],
            portrait: this.myUser.portrait || ''
        };

        this.slots[0] = {
            slot: 0,
            clientId: this.clientId,
            userId: this.myUser.user_id,
            name: myData.name,
            color: myData.color || SNAKE_COLORS[0],
            portrait: myData.portrait || '',
            isAI: false,
            joinTime: myData.joinTime || performance.now()
        };

        // 2. 元いたスロット（Slot 1 等）を空き枠（AI枠）として解放
        if (oldSlot !== 0 && this.slots[oldSlot]) {
            this.slots[oldSlot] = {
                slot: oldSlot,
                clientId: null,
                userId: null,
                name: `プレイヤー ${oldSlot + 1}`,
                color: SNAKE_COLORS[oldSlot % SNAKE_COLORS.length],
                portrait: '',
                isAI: true,
                joinTime: 0
            };
        }

        // 3. 自機スロット番号を 0 に更新
        this.mySlot = 0;

        // 4. メインループ側の自機インスタンスIDも 0 に更新して世界線を統一
        if (typeof window !== 'undefined' && window.localPlayerInstance) {
            window.localPlayerInstance.id = 0;
        }

        const startBtn = document.getElementById('btn-waiting-start');
        if (startBtn) {
            startBtn.style.display = 'block';
        }

        if (typeof window !== 'undefined' && window.UIController && typeof window.UIController.updateWaitingMembersList === 'function') {
            window.UIController.updateWaitingMembersList();
        }

        Menu.updateParticipants(this.slots.filter(s => !s.isAI));

        if (this.callbacks.onHostPromoted) {
            this.callbacks.onHostPromoted();
        }

        const isPlaying = (typeof window !== 'undefined' && window.currentGameState === 'playing');
        this._sendCustomMessage({
            e: 'ROOM_MEMBERS_SYNC',
            slots: this.slots,
            seed: this.currentSeed,
            act: isPlaying
        });

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

            // =========================================================================
            // ★ 【撃破アラート受信ハンドラ（被撃破判定完全同期）】
            // 相手端末の判定で自分が倒された場合、即座に onPlayerKilled を発火！
            // =========================================================================
            if (eventType === 'KILL_ALERT') {
                if (packet.senderId !== this.clientId && packet.kn && packet.vn) {
                    Danmaku.push(packet.kn, `${packet.vn} を撃破！`, packet.col || '#ff3366');
                }

                // 被撃破判定：被害者スロット（vs）が自分自身（mySlot）であればゲームオーバーを即座に起動
                if (packet.vs !== undefined && packet.vs !== null && packet.vs === this.mySlot) {
                    console.warn(`[Sync] 撃破パケット検知: スロット ${packet.vs} (自機) の撃破宣告を受信しました。ゲームオーバー処理を実行します。`);
                    if (this.callbacks.onPlayerKilled) {
                        this.callbacks.onPlayerKilled(packet.kn);
                    }
                }
                return;
            }

            // 入退室システム通知受信ハンドラ
            if (eventType === 'SYS_ALERT') {
                if (packet.senderId !== this.clientId && packet.sender && packet.text) {
                    Danmaku.push(packet.sender, packet.text, packet.col || '#38bdf8');
                }
                return;
            }

            // =========================================================================
            // ★ 【START_GAME 受信ハンドラ（ゲームオーバー中完全遮断）】
            // 自端末がゲームオーバー中であれば、ホストからの開始合図や再送バーストを
            // 即座に破棄してリザルト画面の消去を物理遮断！
            // =========================================================================
            if (eventType === 'START_GAME') {
                if (typeof window !== 'undefined' && window.currentGameState === 'gameover') {
                    console.warn('[NetworkManager] ゲームオーバー中のため、START_GAME パケットを抑止します。');
                    return;
                }
                if (packet.seed && packet.seed !== this.currentSeed) {
                    this.currentSeed = packet.seed;
                }
                if (this.callbacks.onGameStart) {
                    this.callbacks.onGameStart(packet);
                }
                return;
            }

            if (eventType === 'USER_JOIN' && this.isHost) {
                this._handleUserJoined(packet);
                return;
            }

            if (eventType === 'P' || eventType === 'POS') {
                // =========================================================================
                // ★ 【待機画面からの自律脱出セーフティネット（誤爆完全防止強化版）】
                // ホストが実際にゲーム中（packet.act === true）かつ、自機が待機室（waiting）に
                // いる場合のみ自律脱出を発火！
                // =========================================================================
                if (!this.isHost && typeof window !== 'undefined' && window.currentGameState === 'waiting' && packet.act === true) {
                    console.warn('[Sync] ホストが対戦中(act: true)であることを検知。ゲーム画面へ安全に自律脱出します。');
                    if (this.callbacks.onGameStart) {
                        this.callbacks.onGameStart({ seed: this.currentSeed, direct: false });
                    }
                }

                const incomingList = packet.l || packet.list;
                if (Array.isArray(incomingList)) {
                    for (let i = 0; i < incomingList.length; i++) {
                        const decoded = decodeTupleToSnake(incomingList[i]);
                        if (decoded) {
                            if (this.isHost && decoded.isHost && decoded.slot !== this.mySlot) {
                                if (this.mySlot > decoded.slot) {
                                    console.warn(`[NetworkManager] スプリットブレイン検知: スロット優先度によりゲストへサレンダーします (My: ${this.mySlot} > Remote: ${decoded.slot})`);
                                    this.isHost = false;
                                    if(this.slots[this.mySlot]) this.slots[this.mySlot].isHost = false;

                                    if (this.callbacks.onSurrenderedAsHost) {
                                        this.callbacks.onSurrenderedAsHost();
                                    }
                                }
                            }

                            if (decoded.slot !== this.mySlot && this.callbacks.onRemoteSnakeUpdate) {
                                this.callbacks.onRemoteSnakeUpdate(decoded);
                            }
                        }
                    }
                }

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

                // =========================================================================
                // ★ 【リザルト画面誤リセットの完全遮断】
                // 待機室（waiting）にいる場合のみに限定。gameover 中は絶対に無視！
                // =========================================================================
                if (packet.act === true && !this.isHost) {
                    if (typeof window !== 'undefined' && window.currentGameState === 'waiting') {
                        if (this.callbacks.onGameStart) {
                            this.callbacks.onGameStart({ seed: this.currentSeed, direct: false });
                        }
                    }
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

        // 再入室時・ルーム遷移時にメインループ側の残留走者を完全パージ
        if (this.callbacks.onWorldPurged) {
            try {
                this.callbacks.onWorldPurged();
            } catch (err) {
                console.warn('[NetworkManager] onWorldPurged error:', err);
            }
        }
    },

    async exitRoom() {
        if (this.currentRoomId) {
            addRecentlyExitedRoomId(this.currentRoomId);
        }
        
        this.purgeLocalWorldState();
        await safeExitCurrentRoom(null);
        
        this.currentRoomId = null;
        this.isHost = false;
        this.isMultiplayerActive = false;
        this.mySlot = 0;
    }
};

if (typeof window !== 'undefined') window.NetworkManager = NetworkManager;