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
    onConnecting: (sessionId) => {
        console.log(`[${sessionId}] Connecting to WhatsApp...`);
    },
    onConnected: (sessionId) => {
        console.log(`[${sessionId}] Connected Successfully!`);
    },
    onDisconnected: (sessionId) => {
        console.log(`[${sessionId}] Disconnected!`);
    },
    onMessageReceived: async (msg) => {
        if (msg.key.fromMe || msg.key.remoteJid?.includes("status")) return;
        
        console.log(`[${msg.sessionId}] New message from ${msg.key.remoteJid}`);
        try {
            await whatsapp.readMessage({
                sessionId: msg.sessionId,
                key: msg.key,
            });
        } catch (err) {
            console.error("Error reading message:", err.message);
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

app.get('/getsessions', async (req, res) => {
    try {
        const sessions = await whatsapp.getSessionsIds();
        res.status(200).json({ success: true, sessions });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch active sessions.", details: error.message });
    }
});

app.get('/getmessages', (req, res) => {
    res.status(200).json({ 
        message: "Notice: To build a robust history archive, listen to the 'onMessageReceived' stream inside server.js and dump incoming data payloads into your own structured production DB tier." 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API Gateway running smoothly on port ${PORT}`);
});
