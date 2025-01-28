import { Telegraf, Context } from 'telegraf';
import { Message } from '../types';
import { EventEmitter } from 'events';
import { 
    Update, 
    Message as TelegramMessage,
    Chat,
    User
} from 'telegraf/types';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Define group message type
type TelegramGroupMessage = {
    message_id: number;
    date: number;
    chat: {
        id: number;
        type: 'group' | 'supergroup';
        title: string;
        username?: string;
    };
    from: {
        id: number;
        first_name: string;
        last_name?: string;
        username?: string;
    };
    text?: string;
    photo?: Array<any>;
    document?: any;
};

interface MessageContent {
    type: string;
    content: any;
    caption?: string;
}

export class TelegramService extends EventEmitter {
    private bot: Telegraf;
    
    constructor(token: string) {
        super();
        
        // Configure HTTP proxy from environment variables
        const proxyUrl = process.env.http_proxy || process.env.https_proxy;
        console.log('Using proxy:', proxyUrl);
        
        // Create proxy agent
        // @ts-ignore - Type issue with https-proxy-agent
        const agent = new HttpsProxyAgent(proxyUrl);
        
        // Initialize bot with proxy
        this.bot = new Telegraf(token, {
            telegram: {
                apiRoot: 'https://api.telegram.org',
                agent,
                testEnv: false,
                apiMode: 'bot',
                webhookReply: false
            }
        });

        // Add middleware for request logging
        this.bot.use(async (ctx, next) => {
            const startTime = Date.now();
            console.log('Telegram API Request:', {
                updateType: ctx.updateType,
                chatId: ctx.chat?.id,
                messageId: ctx.message?.message_id,
                from: ctx.message?.from
            });
            
            await next();
            
            const ms = Date.now() - startTime;
            console.log('Telegram API Response:', {
                updateType: ctx.updateType,
                processingTime: `${ms}ms`
            });
        });
        
        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        // Handle group messages
        this.bot.on('message', async (ctx) => {
            // Only process group messages
            if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') return;

            console.log('Received group message:', {
                chatId: ctx.chat.id,
                chatTitle: ctx.chat.title,
                messageId: ctx.message?.message_id,
                from: ctx.message?.from,
                content: ctx.message ? this.getMessageContent(ctx.message) : undefined
            });

            const message = this.convertToMessage(ctx);
            if (message) {
                console.log('Processed group message:', {
                    id: message.id,
                    sender: message.sender,
                    text: message.text,
                    hasAttachments: message.attachments ? message.attachments.length : 0
                });
                this.emit('message', message);
            }
        });

        // Handle errors
        this.bot.catch((err: unknown, ctx: Context<Update>) => {
            console.error('Telegram bot error:', err);
            console.error('Error context:', {
                chatId: ctx.chat?.id,
                chatType: ctx.chat?.type,
                updateType: ctx.updateType
            });
            this.emit('error', err);
        });
    }

    private getMessageContent(msg: TelegramMessage): MessageContent {
        // Check for text content
        if ('text' in msg && msg.text) {
            return { type: 'text', content: msg.text };
        }
        
        // Check for media content
        if ('photo' in msg && msg.photo && msg.photo.length > 0) {
            return { 
                type: 'photo', 
                content: msg.photo[msg.photo.length - 1],
                caption: msg.caption
            };
        }
        
        if ('document' in msg && msg.document) {
            return { 
                type: 'document', 
                content: msg.document,
                caption: msg.caption
            };
        }
        
        if ('video' in msg && msg.video) {
            return { 
                type: 'video', 
                content: msg.video,
                caption: msg.caption
            };
        }
        
        if ('audio' in msg && msg.audio) {
            return { 
                type: 'audio', 
                content: msg.audio,
                caption: msg.caption
            };
        }
        
        if ('voice' in msg && msg.voice) {
            return { 
                type: 'voice', 
                content: msg.voice,
                caption: msg.caption
            };
        }
        
        if ('sticker' in msg && msg.sticker) {
            return { 
                type: 'sticker', 
                content: msg.sticker
            };
        }

        // For system messages or other types
        if ('new_chat_member' in msg || 'left_chat_member' in msg || 'new_chat_title' in msg) {
            return { type: 'system', content: msg };
        }
        
        return { type: 'unknown', content: msg };
    }

    private convertToMessage(ctx: Context): Message | null {
        const msg = ctx.message;
        if (!msg || !('message_id' in msg)) return null;

        // Only process group messages
        if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return null;

        const groupMsg = msg as TelegramGroupMessage;
        const attachments = [];
        const content = this.getMessageContent(groupMsg as unknown as TelegramMessage);
        let messageText = '';

        // Handle different message types
        if (content.type === 'text') {
            messageText = content.content;
        } else if (content.type === 'photo') {
            messageText = content.caption || '';
            attachments.push({
                type: 'image',
                url: content.content.file_id
            });
        } else if (content.type === 'document') {
            messageText = content.caption || '';
            attachments.push({
                type: 'file',
                url: content.content.file_id
            });
        } else if (content.type === 'video') {
            messageText = content.caption || '';
            attachments.push({
                type: 'video',
                url: content.content.file_id
            });
        } else if (content.type === 'audio' || content.type === 'voice') {
            messageText = content.caption || '';
            attachments.push({
                type: 'audio',
                url: content.content.file_id
            });
        } else if (content.type === 'sticker') {
            messageText = '[Sticker]';
            attachments.push({
                type: 'image',
                url: content.content.file_id
            });
        } else if (content.type === 'system') {
            messageText = this.formatSystemMessage(content.content);
        } else {
            messageText = '[Unsupported message type]';
        }

        // Get sender and chat information
        const chat = groupMsg.chat;
        const from = groupMsg.from;
        
        // Create sender information using actual user data
        const senderId = from.id.toString();
        const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ');
        const senderUsername = from.username;
        
        return {
            id: groupMsg.message_id.toString(),
            text: messageText,
            sender: {
                id: senderId,
                type: 'telegram',
                name: senderName || 'Unknown User',
                username: senderUsername
            },
            groupId: chat.id.toString(),
            groupName: chat.title || 'Unknown Group',
            attachments: attachments.length > 0 ? attachments : undefined,
            timestamp: groupMsg.date * 1000 // Convert to milliseconds
        };
    }

    private formatSystemMessage(msg: any): string {
        if ('new_chat_member' in msg) {
            const member = msg.new_chat_member;
            return `${member.first_name} joined the group`;
        }
        if ('left_chat_member' in msg) {
            const member = msg.left_chat_member;
            return `${member.first_name} left the group`;
        }
        if ('new_chat_title' in msg) {
            return `Group name changed to: ${msg.new_chat_title}`;
        }
        return '';
    }

    async sendMessage(groupId: string, text: string, replyToMessageId?: string): Promise<void> {
        try {
            console.log('Sending message to Telegram group:', {
                groupId,
                text,
                replyToMessageId
            });

            const options: any = {
                parse_mode: 'HTML'
            };
            if (replyToMessageId) {
                options.reply_to_message_id = replyToMessageId;
            }
            const result = await this.bot.telegram.sendMessage(groupId, text, options);
            console.log('Message sent successfully:', {
                messageId: result.message_id,
                groupId: result.chat.id
            });
        } catch (error) {
            console.error('Error sending message to Telegram:', error);
            throw error;
        }
    }

    async sendFile(groupId: string, fileUrl: string, caption?: string): Promise<void> {
        try {
            console.log('Sending file to Telegram group:', {
                groupId,
                fileUrl,
                caption
            });

            const result = await this.bot.telegram.sendDocument(groupId, fileUrl, {
                caption
            });
            console.log('File sent successfully:', {
                messageId: result.message_id,
                groupId: result.chat.id,
                documentId: result.document?.file_id
            });
        } catch (error) {
            console.error('Error sending file to Telegram:', error);
            throw error;
        }
    }

    async start(): Promise<void> {
        await this.bot.launch();
        console.log('Telegram bot started');
        
        const botInfo = await this.bot.telegram.getMe();
        console.log('Bot info:', {
            id: botInfo.id,
            username: botInfo.username,
            firstName: botInfo.first_name,
            isBot: botInfo.is_bot
        });
    }

    async stop(): Promise<void> {
        await this.bot.stop();
        console.log('Telegram bot stopped');
    }
} 