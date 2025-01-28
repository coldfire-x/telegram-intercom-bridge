# Telegram-Intercom Bridge

A Node.js service that bridges communication between Telegram channels and Intercom conversations, enabling two-way messaging between the platforms.

## Features

- Two-way message synchronization between Telegram channels and Intercom conversations
- Real-time message delivery using Intercom webhooks
- Support for text messages and file attachments
- Automatic conversation mapping and management
- Redis-based message queue for reliable message delivery
- HTML message formatting and sanitization
- Error handling and retry mechanisms
- Scalable architecture

## Prerequisites

- Node.js (v14 or higher)
- Redis server
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- Intercom Access Token
- ngrok or similar tool for webhook development

## Installation

1. Clone the repository:
   ```bash
   git clone git@github.com:coldfire-x/telegram-intercom-bridge.git
   cd telegram-intercom-bridge
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory:
   ```
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   INTERCOM_ACCESS_TOKEN=your_intercom_access_token
   REDIS_URL=redis://localhost:6379
   WEBHOOK_PORT=3000
   ```

## Usage

1. Start ngrok to create a tunnel for Intercom webhooks:
   ```bash
   ngrok http 3000
   ```
   Copy the HTTPS URL provided by ngrok (e.g., `https://your-subdomain.ngrok.io`)

2. Build the TypeScript code:
   ```bash
   npm run build
   ```

3. Start the service:
   ```bash
   npm start
   ```

The service will start listening for messages from both Telegram channels and Intercom conversations.

## Setting Up Telegram Bot

1. Create a new bot using [@BotFather](https://t.me/botfather)
2. Get the bot token
3. Add the bot to your Telegram channel as an administrator
4. Enable the following permissions for the bot:
   - Read messages
   - Send messages
   - Edit messages
   - Delete messages
   - Post messages

## Setting Up Intercom

1. Create an Intercom app or use an existing one
2. Generate an access token with the following permissions:
   - Read conversations
   - Write conversations
   - Read admins
   - Write admins
3. Set up webhooks:
   - In your Intercom app settings, go to "Webhooks" under "Developer Tools"
   - Add a new webhook with the URL: `https://your-ngrok-subdomain/webhook/intercom`
   - Subscribe to the following topics:
     - `conversation.admin.replied`
     - `conversation.admin.noted`
     - `conversation.admin.single.created`
   - Save the webhook configuration

The service will now receive real-time updates from Intercom through the webhook endpoint.

## Architecture

The service consists of the following components:

- **TelegramService**: Handles Telegram bot interactions
- **IntercomService**: Manages Intercom API communications
- **RedisService**: Handles message queuing and channel mapping
- **BridgeService**: Coordinates message flow between platforms

## Development

1. Start the service in development mode:
   ```bash
   npm run dev
   ```

2. Run tests:
   ```bash
   npm test
   ```

## Error Handling

The service implements the following error handling mechanisms:

- Automatic retry for failed message deliveries
- Error logging for debugging
- Graceful shutdown handling
- Connection error recovery

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## Support the Project

If you find this project helpful and would like to support its development, you can buy me a coffee! Your support helps maintain and improve the project.

[![Buy me a coffee](./docs/bmc_qr.png)](buymeacoffee.com/pengphy)

## License

This project is licensed under the MIT License - see the LICENSE file for details. 