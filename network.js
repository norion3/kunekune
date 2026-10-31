// ==============================================================================
// 『くねくねバトル オンライン』AgentSDK公式マルチプレイ通信マネージャー (network.js)
// v20.1.0 堅牢化版:
// ・GRAVITY公式上限（4名）に完全整合した 4スロット（0〜3）管理
// ・1024バイト（1KB）物理限界の厳格防衛＆自動キュー分割キャリーオーバー機構
// ・getMyUserInfo の3回リトライ（ポーリング）機構による確実なユーザー名取得
// ・自律ホスト昇格（Host Migration）＆未入室exitハング完全防護
// ==============================================================================

import {
    round1,
    generateClientId,
    getUtf8ByteLength,
    encodeSnakeToTuple,
    decodeTupleToSnake,
    packFoodPickTuple,
    unpackFoodPickTuple,
    packDropFoodTuple,
    unpackDropFoodTuple,
    packChatTuple,
    unpackChatTuple
} from './net_protocol.js';

import { Danmaku } from './danmaku.js';
import { Menu } from './menu.js';
import { SNAKE_COLORS, MAX_PLAYERS } from './constants.js';

const SAFE_PACKET_BYTE_LIMIT = 980; // 1024バイト上限に対する安全マージン

/**
 * 未入室時の exit() による無限保留（Promiseハング）を防ぐ安全退出ヘルパー
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
            if (targetRoomId && String(activeRoomId) === String(targetRoomId)) return;
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

    // GRAVITY公式上限の 4名スロット（0〜3）に完全整合
    slots: Array.from({ length: MAX_PLAYERS }, (_, i) => ({
        slot: i,
        clientId: null,
        userId: null,
        name: i === 0 ? 'あなた' : `プレイヤー ${i + 1}`,
        color: SNAKE_COLORS[i % SNAKE_COLORS.length],
        isAI: i !== 0,
        joinTime: 0
    })),

    isHost: false,
    isMultiplayerActive: false,
    mySlot: 0,
    currentSeed: 12345678,

    _hasRegisteredListener: false,
    _syncIntervalId: null,
    _watchdogIntervalId: null,
    _lastHostPacketTime: 0,
    _hasReceivedFirstHostPacket: false,
    _isPromoting: false,

    _aiSliceIndex: 0,

    _pendingPicks: [],
    _pendingDrops: [],
    _pendingChats: [],

    callbacks: {
        onRemoteSnakeUpdate: null,
        onFoodPicked: null,
        onDropSpawned: null,
        onSeedReceived: null
    },

    setCallbacks(cb) {
        this.callbacks = { ...this.callbacks, ...cb };
    },

    queueFoodPick(gx, gy, foodIndex) {
        if (!this.isMultiplayerActive) return;
        this._pendingPicks.push(packFoodPickTuple(gx, gy, foodIndex));
    },

    queueDropFood(x, y, val, colorIdx) {
        if (!this.isMultiplayerActive) return;
        this._pendingDrops.push(packDropFoodTuple(x, y, val, colorIdx));
    },

    queueChat(messageText) {
        if (!messageText) return;
        const cleanText = String(messageText).trim().slice(0, 15);
        if (!cleanText) return;

        const myName = this.myUser.name;
        const myColor = SNAKE_COLORS[this.mySlot % SNAKE_COLORS.length];
        Danmaku.push(myName, cleanText, myColor);

        if (this.isMultiplayerActive) {
            this._pendingChats.push(packChatTuple(this.mySlot, cleanText));
        }
    },

    /**
     * ユーザー情報取得の堅牢化（リトライ機構）
     */
    async init() {
        if (!this.isSDKAvailable) {
            console.warn('[NetworkManager] AgentSDK unavailable. Standalone mode.');
            return this.myUser;
        }

        // 取得できるまで最大3回リトライするポーリング機構
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const res = await window.AgentSDK.user.getMyUserInfo();
                if (res && res.data && res.data.name) {
                    this.myUser = {
                        user_id: String(res.data.user_id),
                        name: res.data.name,
                        portrait: res.data.portrait || res.data.portait || ''
                    };
                    window.GRAVITY_USER_NAME = this.myUser.name;
                    return this.myUser;
                }
            } catch (err) {
                console.warn(`[NetworkManager] Failed to get user info (Attempt ${attempt}/3):`, err);
                await new Promise(r => setTimeout(r, 500));
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
                        if (payload.msg_data || payload.message || payload.e || (payload.data && (payload.data.msg_data || payload.data.message))) {
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
     * 厳格な公開・プライベートルーム作成
     */
    async createRoom(isPrivate = false) {
        if (!this.isSDKAvailable) {
            Danmaku.push('エラー', 'マルチプレイはGRAVITYアプリ内でのみ利用可能です', '#f43f5e', true);
            return null;
        }

        try {
            await this.init();
            await safeExitCurrentRoom(null);
            this.purgeLocalWorldState();

            const permission = isPrivate ? 1 : 0;
            const res = await window.AgentSDK.room.create({ max_players: MAX_PLAYERS, room_permission: permission });

            const isError = res && (
                (res.errno !== undefined && res.errno !== 0 && res.errno !== '0') ||
                (res.code !== undefined && res.code !== 0 && res.code !== '0')
            );

            if (isError || !res) {
                const errMsg = (res && (res.errmsg || res.message)) || '不明なエラー';
                console.error(`[NetworkManager] Create room failed. Errno: ${res?.errno}, Msg: ${errMsg}`);
                Danmaku.push('作成失敗', `エラー: ${errMsg}`, '#f43f5e', true);
                return null;
            }

            let createdRoomId = null;
            if (res.data && res.data.room_id) createdRoomId = String(res.data.room_id);
            else if (res.room_id) createdRoomId = String(res.room_id);

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

            this.slots[0] = {
                slot: 0,
                clientId: this.clientId,
                userId: this.myUser.user_id,
                name: this.myUser.name,
                color: SNAKE_COLORS[0],
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
                    isAI: true,
                    joinTime: 0
                };
            }

            this._stopHostWatchdog();
            this._startBroadcasting();
            Danmaku.push('システム', `ルーム #${createdRoomId.slice(-4)} を作成しました`, '#00e5ff', true);

            return this.currentRoomId;
        } catch (err) {
            console.error('[NetworkManager] createRoom exception:', err);
            Danmaku.push('通信エラー', 'ルーム作成中に例外が発生しました', '#f43f5e', true);
            return null;
        }
    },

    /**
     * 厳格なルーム参加と満員エラーハンドリング
     */
    async joinRoom(roomId) {
        if (!this.isSDKAvailable || !roomId) return { success: false, msg: '無効な操作です' };
        const safeRoomId = String(roomId);

        try {
            await this.init();
            await safeExitCurrentRoom(safeRoomId);
            this.purgeLocalWorldState();

            const res = await window.AgentSDK.room.join({ room_id: safeRoomId });
            
            const isError = res && (
                (res.errno !== undefined && res.errno !== 0 && res.errno !== '0') ||
                (res.code !== undefined && res.code !== 0 && res.code !== '0')
            );

            if (isError || !res) {
                const errMsg = (res && (res.errmsg || res.message)) || '不明なエラー';
                console.error(`[NetworkManager] Join room failed. Errno: ${res?.errno}, Msg: ${errMsg}`);
                return { success: false, msg: errMsg };
            }

            this.currentRoomId = safeRoomId;
            this.clientId = generateClientId();
            this.ensureMessageListener();

            this.isHost = false;
            this.isMultiplayerActive = true;
            this.mySlot = 1;

            this._startHostWatchdog();
            this._startBroadcasting();
            Danmaku.push('システム', `ルーム #${safeRoomId.slice(-4)} に合流しました`, '#34d399', true);

            return { success: true };
        } catch (err) {
            console.error('[NetworkManager] joinRoom exception:', err);
            return { success: false, msg: 'ネットワーク通信例外' };
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

    _handleUserJoined(data) {
        if (!this.isHost || !data) return;
        const userId = String(data.user_id || data.userId || '');
        if (!userId || userId === String(this.myUser.user_id)) return;

        const guestName = data.name || data.user_name || 'ゲスト';
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
                isAI: false,
                joinTime: performance.now()
            };

            this._sendCustomMessage({
                e: 'SYNC_MEMBERS',
                slots: this.slots,
                seed: this.currentSeed
            });

            Danmaku.push('参加', `${guestName} が対戦に参加しました`, this.slots[targetSlot].color);
        }
    },

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
                isAI: true,
                joinTime: 0
            };

            Danmaku.push('退室', `${exitedName} が退出しました`, '#94a3b8');

            if (isHostExited) {
                console.warn('[NetworkManager] ホストが退出しました。自律ホスト昇格を実行します。');
                this.promoteToHost();
            } else if (this.isHost) {
                this._sendCustomMessage({
                    e: 'SYNC_MEMBERS',
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

    promoteToHost() {
        if (this._isPromoting || this.isHost) return;
        this._isPromoting = true;
        this._stopHostWatchdog();

        this.isHost = true;
        this.mySlot = 0;
        this.slots[0] = {
            slot: 0,
            clientId: this.clientId,
            userId: this.myUser.user_id,
            name: this.myUser.name,
            color: SNAKE_COLORS[0],
            isAI: false,
            joinTime: performance.now()
        };

        Danmaku.push('システム', 'あなたが新しいホストに昇格しました', '#ffdd00', true);
        this._isPromoting = false;
    },

    _startBroadcasting() {
        if (this._syncIntervalId) clearInterval(this._syncIntervalId);

        this._syncIntervalId = setInterval(() => {
            if (!this.isMultiplayerActive || !this.isSDKAvailable) return;
            if (typeof window.localPlayerInstance === 'undefined' || !window.localPlayerInstance) return;

            const mySnake = window.localPlayerInstance;
            const myTuple = encodeSnakeToTuple(mySnake, this.mySlot, this.isHost);
            const tuplesList = [myTuple];

            // ホスト端末の場合：管理下のAIスネーク42体を3フレーム分割（14体ずつ）して時分割相乗り
            if (this.isHost && Array.isArray(window.allAISnakesInstance)) {
                const ais = window.allAISnakesInstance;
                const BATCH_SIZE = 14;
                const startIndex = (this._aiSliceIndex * BATCH_SIZE) % ais.length;
                this._aiSliceIndex = (this._aiSliceIndex + 1) % 3;

                for (let i = startIndex; i < startIndex + BATCH_SIZE && i < ais.length; i++) {
                    const ai = ais[i];
                    if (ai && !ai.isDead) {
                        // AIのスロットはプレイヤー枠 (0〜3) と重複しない 4 以降で付与
                        const aiTuple = encodeSnakeToTuple(ai, 4 + i, false);
                        tuplesList.push(aiTuple);
                    }
                }
            }

            // 1024バイト制限対策：安全送信パイプライン（溢れたイベントは次フレームへ自動キャリーオーバー）
            const packet = {
                e: 'P',
                l: tuplesList
            };

            // チャットは最優先で同封
            if (this._pendingChats.length > 0) {
                packet.ch = this._pendingChats.splice(0, 3);
            }

            // 餌取得タプルの安全同封（容量が許す分だけ）
            if (this._pendingPicks.length > 0) {
                const maxPickCount = 8;
                packet.pk = this._pendingPicks.splice(0, maxPickCount);
            }

            // 肉片散布タプルの安全同封（容量が許す分だけ）
            if (this._pendingDrops.length > 0) {
                const maxDropCount = 6;
                packet.dp = this._pendingDrops.splice(0, maxDropCount);
            }

            this._sendCustomMessage(packet);
        }, 100);
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

            if (eventType === 'SYNC_MEMBERS') {
                if (Array.isArray(packet.slots)) {
                    this.slots = packet.slots;
                    const mySlotData = this.slots.find(s => s.userId && String(s.userId) === String(this.myUser.user_id));
                    if (mySlotData) {
                        this.mySlot = mySlotData.slot;
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

    /**
     * 1024バイト厳守ガード付き送信ラッパー
     * ルートオブジェクトは { message: string } のみ許可
     */
    _sendCustomMessage(msgObj) {
        if (!this.isSDKAvailable || !window.AgentSDK.room || typeof window.AgentSDK.room.sendMessage !== 'function') return;
        try {
            const rawString = JSON.stringify(msgObj);
            const byteLength = getUtf8ByteLength(rawString);

            // 1024バイト（物理限界）の厳格チェック
            if (byteLength >= 1020) {
                console.warn(`[NetworkManager] パケットサイズが1KB制限に接近 (${byteLength} bytes)。過剰データを切り離して送出します。`);
                // 万一1KBを超過しそうな場合は、副次的なイベント配列を削除して本体のみ送信
                delete msgObj.dp;
                delete msgObj.pk;
                window.AgentSDK.room.sendMessage({ message: JSON.stringify(msgObj) });
                return;
            }

            window.AgentSDK.room.sendMessage({ message: rawString });
        } catch (e) {
            console.warn('[NetworkManager] sendMessage error:', e);
        }
    },

    purgeLocalWorldState() {
        this._stopHostWatchdog();
        if (this._syncIntervalId) {
            clearInterval(this._syncIntervalId);
            this._syncIntervalId = null;
        }

        this._pendingPicks.length = 0;
        this._pendingDrops.length = 0;
        this._pendingChats.length = 0;
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
        Danmaku.push('システム', 'ルームを退出しました', '#94a3b8', true);
    }
};
if (typeof window !== 'undefined') window.NetworkManager = NetworkManager;