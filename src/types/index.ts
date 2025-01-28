export interface GroupMapping {
    telegramGroupId: string;
    intercomConversationId: string;
    lastMessageId?: string;
}

export interface Message {
    id: string;
    text: string;
    sender: {
        id: string;
        type: 'telegram' | 'intercom';
        name: string;
        username?: string;
    };
    groupId: string;
    groupName: string;
    attachments?: Array<{
        type: string;
        url: string;
    }>;
    timestamp: number;
}

export interface ServiceConfig {
    telegramToken: string;
    intercomToken: string;
    redisUrl: string;
    logLevel: string;
} 