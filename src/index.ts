import dotenv from 'dotenv';
import { TelegramService } from './services/telegram.service';
import { IntercomService } from './services/intercom.service';
import { RedisService } from './services/redis.service';
import { BridgeService } from './services/bridge.service';

// Load environment variables
dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const INTERCOM_ACCESS_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Validate required environment variables
if (!TELEGRAM_BOT_TOKEN || !INTERCOM_ACCESS_TOKEN) {
    console.error('Missing required environment variables:');
    if (!TELEGRAM_BOT_TOKEN) console.error('- TELEGRAM_BOT_TOKEN');
    if (!INTERCOM_ACCESS_TOKEN) console.error('- INTERCOM_ACCESS_TOKEN');
    process.exit(1);
}

// After validation, we know these values are defined
const telegramToken: string = TELEGRAM_BOT_TOKEN;
const intercomToken: string = INTERCOM_ACCESS_TOKEN;

async function main() {
    try {
        console.log('Initializing services...');

        // Initialize services
        const telegramService = new TelegramService(telegramToken);
        const redisService = new RedisService(REDIS_URL);
        const intercomService = new IntercomService(intercomToken, redisService);

        // Initialize bridge service
        const bridgeService = new BridgeService(
            telegramService,
            intercomService,
            redisService
        );

        // Start the bridge service
        await bridgeService.start();

        // Handle graceful shutdown
        const shutdown = async () => {
            console.log('\nShutting down...');
            await bridgeService.stop();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        console.log('Bridge service is running...');
        console.log('Listening for messages from Telegram channels and Intercom conversations');
    } catch (error) {
        console.error('Failed to start the bridge service:', error);
        process.exit(1);
    }
}

main(); 