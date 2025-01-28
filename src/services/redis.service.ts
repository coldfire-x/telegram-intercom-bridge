import { createClient } from 'redis';
import { GroupMapping, Message } from '../types';

export class RedisService {
    private client;
    private readonly MAPPING_KEY = 'group_mappings';
    private readonly LOCK_KEY = 'conversation_locks';
    private readonly QUEUE_KEY = 'message_queues';
    private readonly CONTACT_KEY = 'contact_mappings';
    private readonly LOCK_TTL = 30; // Lock timeout in seconds
    private readonly CONTACT_TTL = 86400; // Contact cache TTL in seconds (24 hours)

    constructor(redisUrl: string) {
        this.client = createClient({
            url: redisUrl
        });
        this.init();
    }

    private async init() {
        await this.client.connect();
    }

    async acquireLock(telegramGroupId: string): Promise<boolean> {
        const lockKey = `${this.LOCK_KEY}:${telegramGroupId}`;
        const result = await this.client.set(lockKey, '1', {
            NX: true, // Only set if key doesn't exist
            EX: this.LOCK_TTL // Expire after TTL seconds
        });
        return result === 'OK';
    }

    async releaseLock(telegramGroupId: string): Promise<void> {
        const lockKey = `${this.LOCK_KEY}:${telegramGroupId}`;
        await this.client.del(lockKey);
    }

    async queueMessage(groupId: string, message: Message): Promise<void> {
        const queueKey = `${this.QUEUE_KEY}:${groupId}`;
        await this.client.lPush(queueKey, JSON.stringify(message));
        console.log('Message queued:', {
            groupId,
            messageId: message.id,
            queueLength: await this.client.lLen(queueKey)
        });
    }

    async getQueuedMessages(groupId: string): Promise<Message[]> {
        const queueKey = `${this.QUEUE_KEY}:${groupId}`;
        const messages: Message[] = [];
        
        // Get all messages atomically
        const results = await this.client.lRange(queueKey, 0, -1);
        
        for (const result of results) {
            try {
                messages.push(JSON.parse(result));
            } catch (error) {
                console.error('Error parsing queued message:', error);
            }
        }

        return messages;
    }

    async clearMessageQueue(groupId: string): Promise<void> {
        const queueKey = `${this.QUEUE_KEY}:${groupId}`;
        await this.client.del(queueKey);
        console.log('Message queue cleared:', { groupId });
    }

    async getQueueLength(groupId: string): Promise<number> {
        const queueKey = `${this.QUEUE_KEY}:${groupId}`;
        return await this.client.lLen(queueKey);
    }

    async saveGroupMapping(mapping: GroupMapping): Promise<void> {
        const key = `${this.MAPPING_KEY}:${mapping.telegramGroupId}`;
        await this.client.hSet(key, {
            telegramGroupId: String(mapping.telegramGroupId),
            intercomConversationId: String(mapping.intercomConversationId),
            lastMessageId: mapping.lastMessageId ? String(mapping.lastMessageId) : ''
        });
    }

    async getGroupMapping(telegramGroupId: string): Promise<GroupMapping | null> {
        const key = `${this.MAPPING_KEY}:${telegramGroupId}`;
        const mapping = await this.client.hGetAll(key);
        return Object.keys(mapping).length ? {
            telegramGroupId: mapping.telegramGroupId,
            intercomConversationId: mapping.intercomConversationId,
            lastMessageId: mapping.lastMessageId || undefined
        } : null;
    }

    async getIntercomConversation(telegramGroupId: string): Promise<string | null> {
        const mapping = await this.getGroupMapping(telegramGroupId);
        return mapping?.intercomConversationId || null;
    }

    async getTelegramGroup(intercomConversationId: string): Promise<string | null> {
        // This is a simplified implementation. In production, you might want to maintain a reverse index
        const pattern = `${this.MAPPING_KEY}:*`;
        const keys = await this.client.keys(pattern);
        
        for (const key of keys) {
            const mapping = await this.client.hGetAll(key);
            if (mapping.intercomConversationId === intercomConversationId) {
                return mapping.telegramGroupId;
            }
        }
        return null;
    }

    async updateLastMessageId(telegramGroupId: string, messageId: string): Promise<void> {
        const key = `${this.MAPPING_KEY}:${telegramGroupId}`;
        await this.client.hSet(key, 'lastMessageId', messageId);
    }

    async saveContactMapping(telegramUserId: string, intercomContactId: string): Promise<void> {
        const key = `${this.CONTACT_KEY}:${telegramUserId}`;
        await this.client.set(key, intercomContactId, {
            EX: this.CONTACT_TTL // Set expiration time
        });
        console.log('Cached contact mapping:', {
            telegramUserId,
            intercomContactId
        });
    }

    async getContactMapping(telegramUserId: string): Promise<string | null> {
        const key = `${this.CONTACT_KEY}:${telegramUserId}`;
        const contactId = await this.client.get(key);
        if (contactId) {
            console.log('Found cached contact:', {
                telegramUserId,
                intercomContactId: contactId
            });
        }
        return contactId;
    }

    async invalidateContactMapping(telegramUserId: string): Promise<void> {
        const key = `${this.CONTACT_KEY}:${telegramUserId}`;
        await this.client.del(key);
        console.log('Invalidated contact cache:', {
            telegramUserId
        });
    }

    async disconnect(): Promise<void> {
        await this.client.disconnect();
    }
} 