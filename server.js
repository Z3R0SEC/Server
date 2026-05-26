const express = require('express');
const { Whatsapp, RedisAdapter } = require('wa-multi-session');

const app = express();
app.use(express.json());

const REDIS_URL = process.env.REDIS_URL || "redis://red-d8b0rhpakrks73d8pm50:6379";

const whatsapp = new Whatsapp({
    adapter: new RedisAdapter({
        url: REDIS_URL,
        keyPrefix: "wa_bot:",
    }),
    onConnecting: (sessionId) => console.log(`[${sessionId}] Connecting to WhatsApp...`),
    onConnected: (sessionId) => console.log(`[${sessionId}] Connected Successfully!`),
    onDisconnected: (sessionId) => console.log(`[${sessionId}] Disconnected!`),
    onMessageReceived: async (msg) => {
        if (msg.key.fromMe || msg.key.remoteJid?.includes("status")) return;

        try {
            const sessionId = msg.sessionId;
            const fromNumber = msg.key.remoteJid;
            const pushName = msg.pushName || "Unknown";
            
            let messagePayload = {
                id: msg.key.id,
                fromName: pushName,
                number: fromNumber,
                timestamp: Date.now()
            };

            if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
                messagePayload.type = "text";
                messagePayload.text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            } 
            else if (msg.message?.imageMessage) {
                messagePayload.type = "image";
                const buffer = await msg.download?.();
                messagePayload.url = buffer ? `data:image/jpeg;base64,${buffer.toString('base64')}` : null;
                messagePayload.text = msg.message.imageMessage.caption || "";
            } 
            else if (msg.message?.videoMessage) {
                messagePayload.type = "video";
                const buffer = await msg.download?.();
                messagePayload.url = buffer ? `data:video/mp4;base64,${buffer.toString('base64')}` : null;
                messagePayload.text = msg.message.videoMessage.caption || "";
            } 
            else if (msg.message?.audioMessage) {
                messagePayload.type = "audio";
                const buffer = await msg.download?.();
                messagePayload.url = buffer ? `data:audio/mp3;base64,${buffer.toString('base64')}` : null;
            } 
            else if (msg.message?.documentMessage) {
                messagePayload.type = "document";
                const buffer = await msg.download?.();
                messagePayload.url = buffer ? `data:application/octet-stream;base64,${buffer.toString('base64')}` : null;
                messagePayload.text = msg.message.documentMessage.fileName || "Document";
            }

            if (messagePayload.type) {
                const redisClient = whatsapp.adapter.client; 
                const redisKey = `wa_history:${sessionId}`;
                await redisClient.lPush(redisKey, JSON.stringify(messagePayload));
                await redisClient.lTrim(redisKey, 0, 99);
            }

            await whatsapp.readMessage({ sessionId, key: msg.key });

        } catch (err) {
            console.error("Error processing incoming message hook:", err);
        }
    }
});

app.post('/pairing', async (req, res) => {
    const { sessionId, phoneNumber } = req.body;
    if (!sessionId || !phoneNumber) {
        return res.status(400).json({ error: "Missing sessionId or phoneNumber" });
    }

    try {
        let codeSent = false;
        
        await whatsapp.startSessionWithPairingCode(sessionId, {
            phoneNumber: phoneNumber,
            onPairingCode(code) {
                codeSent = true;
                return res.status(200).json({ 
                    success: true, 
                    message: "Pairing code generated successfully.",
                    pairingCode: code 
                });
            },
        });

        setTimeout(() => {
            if (!codeSent) {
                return res.status(500).json({ error: "Pairing timed out or phone number invalid." });
            }
        }, 20000);

    } catch (error) {
        console.error("Pairing Error:", error);
        res.status(500).json({ error: "Failed to initialize pairing process.", details: error.message });
    }
});

app.get('/checkPaired/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    try {
        const session = await whatsapp.getSessionById(sessionId);
        if (session) {
            return res.status(200).json({ 
                connected: true, 
                message: "Session is active and ready." 
            });
        } else {
            return res.status(404).json({ 
                connected: false, 
                message: "Session not found or inactive." 
            });
        }
    } catch (error) {
        console.error("Check Paired Error:", error);
        res.status(500).json({ error: "Error checking status.", details: error.message });
    }
});

app.post('/connect', async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

    try {
        await whatsapp.startSession(sessionId, { printQR: false });
        res.status(200).json({ success: true, message: `Session restoration triggered for ${sessionId}.` });
    } catch (error) {
        res.status(500).json({ error: "Failed to boot session.", details: error.message });
    }
});

app.post('/sendmessage', async (req, res) => {
    const { sessionId, to, text } = req.body;
    if (!sessionId || !to || !text) {
        return res.status(400).json({ error: "Missing required fields: sessionId, to, text" });
    }

    try {
        const recipient = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;

        await whatsapp.sendText({
            sessionId: sessionId,
            to: recipient,
            text: text
        });

        res.status(200).json({ success: true, message: "Message sent successfully." });
    } catch (error) {
        res.status(500).json({ error: "Failed to send message.", details: error.message });
    }
});

app.get('/', async (req, res) => {
    return res.status(200).json({ info: "App is running!" });
});

app.get('/getsessions', async (req, res) => {
    try {
        const sessions = await whatsapp.getSessionsIds();
        res.status(200).json({ success: true, sessions });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch active sessions.", details: error.message });
    }
});

app.get('/getmessages/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

    try {
        const redisClient = whatsapp.adapter.client;
        const redisKey = `wa_history:${sessionId}`;
        
        const rawData = await redisClient.lRange(redisKey, 0, -1);
        
        const messages = rawData.map(item => JSON.parse(item));

        res.status(200).json({
            success: true,
            sessionId: sessionId,
            total: messages.length,
            messages: messages
        });
    } catch (error) {
        console.error("Fetch Messages Error:", error);
        res.status(500).json({ error: "Failed to retrieve message logs.", details: error.message });
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API Gateway running smoothly on port ${PORT}`);
});
