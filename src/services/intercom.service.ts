import { Message } from '../types';
import { EventEmitter } from 'events';
import { IntercomClient } from 'intercom-client';
import { RedisService } from './redis.service';

interface IntercomAttachment {
    type: string;
    url: string;
}

interface ConversationMetadata {
    groupName: string;
    groupId: string;
    firstMessageTime: number;
}

interface IntercomErrorResponse {
    response?: {
        status: number;
        data: any;
    };
    message: string;
    statusCode?: number;
    body?: {
        type: string;
        request_id: string;
        errors: Array<{
            code: string;
            message: string;
        }>;
    };
}

interface MessageSender {
    id: string;
    name: string;
    username?: string;
}

interface TelegramMessage {
    id: string;
    text: string;
    sender: MessageSender;
    groupId: string;
    groupName: string;
    timestamp: number;
}

export class IntercomService extends EventEmitter {
    private client: any;
    private conversationPollingInterval: NodeJS.Timeout | null = null;
    private lastCheckedTimestamp: number = Date.now();

    constructor(
        accessToken: string,
        private redisService: RedisService
    ) {
        super();
        console.log('Initializing Intercom client...');
        try {
            this.client = new IntercomClient({ token: accessToken });
            console.log('Intercom client initialized successfully');
        } catch (error: unknown) {
            const intercomError = error as IntercomErrorResponse;
            console.error('Failed to initialize Intercom client:', intercomError.message);
            throw error;
        }
    }

    private async getOrCreateContact(
        userId: string,
        metadata: ConversationMetadata,
        userInfo: { name: string; username?: string }
    ): Promise<any> {
        try {
            // Try to get contact ID from cache first
            const cachedContactId = await this.redisService.getContactMapping(userId);
            if (cachedContactId) {
                console.log('Using cached contact:', {
                    userId,
                    contactId: cachedContactId
                });
                return { id: cachedContactId };
            }

            console.log('Creating/updating contact:', {
                userId,
                groupId: metadata.groupId,
                groupName: metadata.groupName,
                name: userInfo.name,
                username: userInfo.username
            });

            const contactData = {
                role: 'user',
                external_id: userId,
                name: userInfo.name,
                custom_attributes: {
                    telegram_user_id: userId,
                    telegram_username: userInfo.username,
                    telegram_group_name: metadata.groupName,
                    telegram_group_id: metadata.groupId,
                }
            };

            try {
                // Try to create the contact first
                console.log('Attempting to create new contact:', contactData);
                const newContact = await this.client.contacts.create(contactData);
                console.log('Successfully created new contact:', {
                    contactId: newContact.id,
                    userId,
                    username: userInfo.username,
                    groupId: metadata.groupId
                });

                // Cache the new contact ID
                await this.redisService.saveContactMapping(userId, newContact.id);
                return newContact;
            } catch (createError: unknown) {
                const intercomError = createError as IntercomErrorResponse;
                if (intercomError.statusCode === 409 || intercomError.response?.status === 409) {
                    console.log('Contact exists, searching by external_id:', userId);
                    
                    const searchResult = await this.client.contacts.search({
                        query: {
                            operator: "AND",
                            value: [
                                {
                                    field: "external_id",
                                    operator: "=",
                                    value: userId
                                },
                                {
                                    field: "role",
                                    operator: "=",
                                    value: "user"
                                }
                            ]
                        },
                        pagination: {
                            per_page: 1
                        }
                    });

                    if (searchResult.response?.total_count > 0) {
                        const existingContact = searchResult.response.data[0];
                        console.log('Found existing contact:', {
                            contactId: existingContact.id,
                            userId,
                            username: userInfo.username,
                            groupId: metadata.groupId
                        });

                        const updatedContact = await this.client.contacts.update({
                            contact_id: existingContact.id,
                            role: 'user',
                            name: userInfo.name,
                            custom_attributes: {
                                telegram_user_id: userId,
                                telegram_username: userInfo.username,
                                telegram_group_name: metadata.groupName,
                                telegram_group_id: metadata.groupId,
                            }
                        });

                        console.log('Successfully updated contact:', {
                            contactId: updatedContact.id,
                            userId,
                            username: userInfo.username,
                            groupId: metadata.groupId
                        });

                        // Cache the existing contact ID
                        await this.redisService.saveContactMapping(userId, updatedContact.id);
                        return updatedContact;
                    }
                }
                
                console.error('Error managing contact:', {
                    message: intercomError.message,
                    response: intercomError.body || intercomError.response?.data,
                    status: intercomError.statusCode || intercomError.response?.status
                });
                throw createError;
            }
        } catch (error: unknown) {
            const intercomError = error as IntercomErrorResponse;
            console.error('Error in getOrCreateContact:', {
                message: intercomError.message,
                response: intercomError.body || intercomError.response?.data,
                status: intercomError.statusCode || intercomError.response?.status
            });
            throw error;
        }
    }

    async createConversation(userId: string, userName: string | undefined, message: string, metadata: ConversationMetadata): Promise<string> {
        try {
            console.log('Creating new Intercom conversation:', {
                userId: userId,
                userName: userName,
                groupName: metadata.groupName,
                groupId: metadata.groupId
            });

            // Get or create contact first
            const contact = await this.getOrCreateContact(
                userId,
                metadata,
                {
                    name: metadata.groupName,
                    username: userName
                }
            );

            console.log('Contact created/updated:', {
                contactId: contact.id,
                groupId: metadata.groupId
            });
            
            // First create a basic conversation
            const conversation = await this.client.conversations.create({
                from: {
                    type: "user",
                    id: contact.id
                },
                body: message
            });

            console.log('Basic conversation created:', {
                conversationId: conversation.conversation_id,
                groupId: metadata.groupId
            });

            // Then update it with additional attributes
            const updatedConversation = await this.client.conversations.update({
                conversation_id: conversation.conversation_id,
                custom_attributes: {
                    telegram_group_name: metadata.groupName,
                    telegram_group_id: metadata.groupId,
                    conversation_start_time: new Date(metadata.firstMessageTime).toISOString()
                }
            });

            console.log('Updated conversation with attributes:', {
                conversationId: updatedConversation.conversation_id,
                groupId: metadata.groupId
            });

            return conversation.conversation_id;
        } catch (error: unknown) {
            const intercomError = error as IntercomErrorResponse;
            console.error('Error creating Intercom conversation:', {
                message: intercomError.message,
                response: intercomError.response?.data,
                status: intercomError.response?.status
            });
            throw error;
        }
    }

    async sendMessage(conversationId: string, message: string, userId: string): Promise<void> {
        try {
            console.log('Sending message to Intercom:', {
                conversationId,
                message: message,
            });

            await this.client.conversations.reply({
                conversation_id: conversationId,
                body: {
                    type: 'user',
                    message_type: 'comment',
                    user_id: userId,
                    body: message
                }
            });

            console.log('Message sent successfully to Intercom:', {
                conversationId
            });
        } catch (error) {
            console.error('Error sending message to Intercom:', error);
            throw error;
        }
    }

    async startPolling(pollingInterval: number = 30000): Promise<void> {
        if (this.conversationPollingInterval) {
            clearInterval(this.conversationPollingInterval);
        }

        this.conversationPollingInterval = setInterval(async () => {
            try {
                const conversations = await this.client.conversations.list({
                    modifiedSince: this.lastCheckedTimestamp
                });

                for (const conversation of conversations.conversations) {
                    const lastMessage = conversation.conversation_parts.conversation_parts[
                        conversation.conversation_parts.conversation_parts.length - 1
                    ];

                    if (lastMessage && lastMessage.created_at * 1000 > this.lastCheckedTimestamp) {
                        const message: Message = {
                            id: lastMessage.id,
                            text: lastMessage.body || '',
                            sender: {
                                id: conversation.id,
                                type: 'intercom',
                                name: lastMessage.author.name || 'Intercom User'
                            },
                            groupId: conversation.id,
                            groupName: conversation.source?.name || 'Intercom Conversation',
                            timestamp: lastMessage.created_at * 1000
                        };

                        if (lastMessage.attachments && lastMessage.attachments.length > 0) {
                            message.attachments = lastMessage.attachments.map((attachment: IntercomAttachment) => ({
                                type: attachment.type,
                                url: attachment.url
                            }));
                        }

                        this.emit('message', message);
                    }
                }

                this.lastCheckedTimestamp = Date.now();
            } catch (error) {
                console.error('Error polling Intercom conversations:', error);
                this.emit('error', error);
            }
        }, pollingInterval);
    }

    async stopPolling(): Promise<void> {
        if (this.conversationPollingInterval) {
            clearInterval(this.conversationPollingInterval);
            this.conversationPollingInterval = null;
        }
    }

    async getConversation(conversationId: string): Promise<any> {
        try {
            return await this.client.conversations.find({ id: conversationId });
        } catch (error) {
            console.error('Error fetching Intercom conversation:', error);
            throw error;
        }
    }

    async findConversationByGroupId(groupId: string): Promise<any> {
        try {
            console.log('Searching for conversation by group ID:', groupId);
            const conversations = await this.client.conversations.search({
                query: {
                    field: 'custom_attributes.telegram_group_id',
                    operator: '=',
                    value: groupId
                }
            });

            if (conversations.total_count > 0) {
                console.log('Found existing conversation:', {
                    conversationId: conversations.conversations[0].id,
                    groupId
                });
                return conversations.conversations[0];
            }

            console.log('No existing conversation found for group:', groupId);
            return null;
        } catch (error) {
            console.error('Error searching for conversation:', error);
            return null;
        }
    }

    async handleTelegramMessage(message: TelegramMessage): Promise<void> {
        try {
            console.log('Processing Telegram message:', {
                messageId: message.id,
                groupId: message.groupId,
                groupName: message.groupName,
                senderId: message.sender.id,
                senderName: message.sender.name,
                senderUsername: message.sender.username
            });

            // Try to find existing conversation for the group first
            let conversation = await this.findConversationByGroupId(message.groupId);

            // Create or update the contact with the actual sender's information
            const senderContact = await this.getOrCreateContact(
                message.sender.id,
                {
                    groupId: message.groupId,
                    groupName: message.groupName,
                    firstMessageTime: message.timestamp
                },
                {
                    name: message.sender.name,
                    username: message.sender.username
                }
            );

            if (!conversation) {
                console.log('Creating new conversation for group:', {
                    groupId: message.groupId,
                    groupName: message.groupName,
                    senderId: message.sender.id,
                    senderName: message.sender.name
                });

                const conversationId = await this.createConversation(
                    message.sender.id,
                    message.sender.username || message.sender.name || '',
                    message.text,
                    {
                        groupId: message.groupId,
                        groupName: message.groupName,
                        firstMessageTime: message.timestamp
                    }
                );
                conversation = await this.getConversation(conversationId);
            } else {
                console.log('Adding message to existing conversation:', {
                    conversationId: conversation.id,
                    messageId: message.id,
                    senderId: message.sender.id,
                    senderName: message.sender.name
                });

                try {
                    await this.client.conversations.replyById({
                        id: conversation.id,
                        type: 'customer',
                        message_type: 'comment',
                        body: this.formatMessageWithSenderInfo(message),
                        intercom_user_id: senderContact.id,
                        admin_id: null
                    });

                    console.log('Successfully added message to conversation:', {
                        conversationId: conversation.id,
                        contactId: senderContact.id,
                        senderId: message.sender.id,
                        senderName: message.sender.name
                    });
                } catch (replyError) {
                    console.error('Error adding message to conversation:', replyError);
                    console.log('Creating new conversation for sender:', {
                        senderId: message.sender.id,
                        senderName: message.sender.name,
                        groupId: message.groupId,
                        groupName: message.groupName
                    });

                    const newConversationId = await this.createConversation(
                        message.sender.id,
                        message.sender.username || message.sender.name || '',
                        message.text,
                        {
                            groupId: message.groupId,
                            groupName: message.groupName,
                            firstMessageTime: message.timestamp
                        }
                    );
                    conversation = await this.getConversation(newConversationId);
                }
            }

            console.log('Successfully processed message:', {
                messageId: message.id,
                conversationId: conversation.id,
                contactId: senderContact.id,
                senderId: message.sender.id,
                senderName: message.sender.name,
                groupId: message.groupId,
                groupName: message.groupName
            });
        } catch (error) {
            console.error('Error processing Telegram message:', error);
            throw error;
        }
    }

    private formatMessageWithSenderInfo(message: TelegramMessage): string {
        let formattedMessage = `From: ${message.sender.name}`;
        if (message.sender.username) {
            formattedMessage += ` (@${message.sender.username})`;
        }
        formattedMessage += `\nGroup: ${message.groupName}\n\n${message.text}`;
        return formattedMessage;
    }
} 