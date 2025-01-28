import { TelegramService } from './telegram.service';
import { IntercomService } from './intercom.service';
import { RedisService } from './redis.service';
import { Message } from '../types';

export class BridgeService {
    constructor(
        private telegramService: TelegramService,
        private intercomService: IntercomService,
        private redisService: RedisService
    ) {
        this.setupEventHandlers();
    }

    private async processQueuedMessages(groupId: string, conversationId: string): Promise<void> {
        try {
            const messages = await this.redisService.getQueuedMessages(groupId);
            console.log('Processing queued messages:', {
                groupId,
                messageCount: messages.length
            });

            for (const message of messages) {
                try {
                    await this.intercomService.sendMessage(
                        conversationId,
                        this.formatMessageForIntercom(message),
                        message.sender.id
                    );
                } catch (error) {
                    console.error('Error processing queued message:', error);
                    // Re-queue failed message
                    await this.redisService.queueMessage(groupId, message);
                }
            }

            // Clear queue only after successful processing
            await this.redisService.clearMessageQueue(groupId);
        } catch (error) {
            console.error('Error processing message queue:', error);
        }
    }

    private async handleNewGroup(message: Message): Promise<string | null> {
        if (!message.groupId || !message.groupName) {
            console.error('Message is missing required group information:', message);
            return null;
        }

        try {
            // Try to acquire lock
            const lockAcquired = await this.redisService.acquireLock(message.groupId);
            if (!lockAcquired) {
                console.log('Lock not acquired, queuing message:', {
                    groupId: message.groupId,
                    messageId: message.id
                });
                
                // Queue the message in Redis
                await this.redisService.queueMessage(message.groupId, message);
                
                // Wait and check if conversation was created
                await new Promise(resolve => setTimeout(resolve, 1000));
                return await this.redisService.getIntercomConversation(message.groupId);
            }

            try {
                // Double-check if conversation exists after acquiring lock
                const existingConversation = await this.redisService.getIntercomConversation(message.groupId);
                if (existingConversation) {
                    return existingConversation;
                }

                // Create new conversation with group metadata
                console.log('Creating new Intercom conversation for group:', {
                    groupId: message.groupId,
                    groupName: message.groupName
                });

                const conversationId = await this.intercomService.createConversation(
                    message.sender.id,
                    message.sender.username || message.sender.name || '',
                    message.text,
                    {
                        groupName: message.groupName,
                        groupId: message.groupId,
                        firstMessageTime: message.timestamp
                    }
                );

                // Save mapping
                await this.redisService.saveGroupMapping({
                    telegramGroupId: message.groupId,
                    intercomConversationId: conversationId,
                    lastMessageId: message.id
                });

                console.log('Created and mapped new conversation:', {
                    groupId: message.groupId,
                    conversationId: conversationId
                });

                // Process any queued messages
                await this.processQueuedMessages(message.groupId, conversationId);

                return conversationId;
            } finally {
                // Release lock in finally block to ensure it's always released
                await this.redisService.releaseLock(message.groupId);
            }
        } catch (error) {
            console.error('Error creating new conversation:', error);
            // Queue the message if conversation creation fails
            await this.redisService.queueMessage(message.groupId, message);
            return null;
        }
    }

    private setupEventHandlers(): void {
        // Handle messages from Telegram
        this.telegramService.on('message', async (message: Message) => {
            try {
                console.log('Processing Telegram message:', message);

                let intercomConversationId = await this.redisService.getIntercomConversation(message.groupId);
                
                if (intercomConversationId) {
                    // Send message to existing conversation
                    console.log('Forwarding to existing Intercom conversation:', {
                        conversationId: intercomConversationId
                    });

                    try {
                        await this.intercomService.sendMessage(
                            intercomConversationId,
                            this.formatMessageForIntercom(message),
                            message.sender.id
                        );
                    } catch (error) {
                        console.error('Error sending message to Intercom, queuing for retry:', error);
                        await this.redisService.queueMessage(message.groupId, message);
                    }
                } else {
                    // Handle new group with locking mechanism
                    intercomConversationId = await this.handleNewGroup(message);
                    
                    if (!intercomConversationId) {
                        console.error('Failed to create or find conversation for group:', {
                            groupId: message.groupId
                        });
                    }
                }
            } catch (error) {
                console.error('Error handling Telegram message:', error);
                // Queue message on any unexpected error
                await this.redisService.queueMessage(message.groupId, message);
            }
        });

        // Handle messages from Intercom
        this.intercomService.on('message', async (message: Message) => {
            try {
                console.log('Processing Intercom message:', {
                    conversationId: message.sender.id
                });

                const telegramGroupId = await this.redisService.getTelegramGroup(message.sender.id);
                
                if (telegramGroupId) {
                    console.log('Forwarding to Telegram group:', {
                        groupId: telegramGroupId
                    });

                    await this.telegramService.sendMessage(
                        telegramGroupId,
                        this.formatMessageForTelegram(message)
                    );

                    if (message.attachments && message.attachments.length > 0) {
                        for (const attachment of message.attachments) {
                            await this.telegramService.sendFile(
                                telegramGroupId,
                                attachment.url,
                                attachment.type
                            );
                        }
                    }

                    console.log('Message forwarded successfully to Telegram');
                } else {
                    console.warn('No matching Telegram group found for Intercom conversation:', {
                        conversationId: message.sender.id
                    });
                }
            } catch (error) {
                console.error('Error handling Intercom message:', error);
            }
        });

        // Handle errors
        this.telegramService.on('error', (error: Error) => {
            console.error('Telegram service error:', error);
        });

        this.intercomService.on('error', (error: Error) => {
            console.error('Intercom service error:', error);
        });
    }

    private formatMessageForIntercom(message: Message): string {
        let formattedMessage = `From Telegram Group: ${message.sender.name}\n\n${message.text}`;
        
        if (message.attachments && message.attachments.length > 0) {
            formattedMessage += '\n\nAttachments:';
            message.attachments.forEach(attachment => {
                formattedMessage += `\n- ${attachment.type}: ${attachment.url}`;
            });
        }

        return formattedMessage;
    }

    private formatMessageForTelegram(message: Message): string {
        return `<b>From Intercom</b>\n${message.text}`;
    }

    async start(): Promise<void> {
        await this.telegramService.start();
        await this.intercomService.startPolling();
        console.log('Bridge service started');
    }

    async stop(): Promise<void> {
        await this.telegramService.stop();
        await this.intercomService.stopPolling();
        console.log('Bridge service stopped');
    }
} 