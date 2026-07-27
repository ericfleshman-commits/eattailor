import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();
import { processToolCalls, getLocalDateString, buildSystemPrompt, getChatTools } from "./chat-core.js";
import { fetchStravaActivities, getStravaContext } from "./strava-helper.js";

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

process.env.GOOGLE_APPLICATION_CREDENTIALS = new URL('./service-account.json', import.meta.url).pathname;
initializeApp({
  projectId: "eattailor"
});

const db = getFirestore();
const auth = getAuth();

// Authentication middleware
async function verifyIdToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Error verifying Firebase ID token:", error);
    res.status(401).json({ error: "Unauthorized" });
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

if (process.env.ENABLE_PROACTIVE_CRON !== 'false') {
  import('./cron.js').catch(err => console.error('Failed to load cron.js', err));
}

// Serve static files from the project directory
app.use(express.static(__dirname));

// Strava OAuth - Redirect to Strava authorization
app.get("/api/strava/authorize", (req, res) => {
  const { userId } = req.query;
  console.log('🚴 [AUTH] Authorize request received for userId:', userId);

  if (!userId) {
    console.error('❌ [AUTH] Missing userId');
    return res.status(400).json({ error: "Missing userId" });
  }

  const redirectUri = `${req.protocol}://${req.get('host')}/api/strava/callback`;
  const scope = "activity:read_all";
  const stravaAuthUrl = `https://www.strava.com/oauth/authorize?client_id=${process.env.STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${userId}`;

  console.log('🚴 [AUTH] Redirect URI:', redirectUri);
  console.log('🚴 [AUTH] Redirecting to Strava:', stravaAuthUrl);

  res.redirect(stravaAuthUrl);
});

// Strava OAuth - Handle callback and exchange code for tokens
app.get("/api/strava/callback", async (req, res) => {
  try {
    const { code, state: userId, error } = req.query;

    console.log('🚴 [CALLBACK] Received callback');
    console.log('🚴 [CALLBACK] Code:', code ? 'present' : 'missing');
    console.log('🚴 [CALLBACK] UserId:', userId);
    console.log('🚴 [CALLBACK] Error from Strava:', error);

    if (error) {
      console.error('❌ [CALLBACK] Strava returned error:', error);
      return res.status(400).send(`Strava authorization failed: ${error}`);
    }

    if (!code || !userId) {
      console.error('❌ [CALLBACK] Missing code or userId');
      return res.status(400).send("Missing code or userId");
    }

    console.log('🚴 [CALLBACK] Exchanging code for token...');

    // Exchange code for access token
    const tokenResponse = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code: code,
        grant_type: "authorization_code"
      })
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error("❌ [CALLBACK] Token exchange failed:", error);
      return res.status(500).send("Failed to connect to Strava");
    }

    const tokenData = await tokenResponse.json();
    console.log('✅ [CALLBACK] Token exchange successful!');
    console.log('✅ [CALLBACK] Sending postMessage to popup window...');

    // Store tokens in response - frontend will save to Firestore
    res.send(`
      <html>
        <body>
          <script>
            console.log('📨 Callback page loaded, sending message to parent...');
            console.log('📨 window.opener exists:', !!window.opener);

            const messageData = {
              type: 'strava-auth-success',
              tokens: ${JSON.stringify({
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: tokenData.expires_at,
                athlete: tokenData.athlete
              })},
              userId: '${userId}'
            };

            console.log('📨 Sending message:', messageData);

            if (window.opener) {
              window.opener.postMessage(messageData, '${req.protocol}://${req.get('host')}');
              console.log('✅ Message sent to opener!');
              setTimeout(() => {
                console.log('🔒 Closing popup...');
                window.close();
              }, 1000);
            } else {
              console.error('❌ window.opener is null - cannot send message!');
            }
          </script>
          <h2 style="text-align:center; font-family:sans-serif; margin-top:50px;">✅ Connected to Strava!</h2>
          <p style="text-align:center; font-family:sans-serif;">This window will close automatically...</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Strava OAuth error:", error);
    res.status(500).send("Authentication failed");
  }
});

// Strava API - Fetch today's activities
app.post("/api/strava/activities", verifyIdToken, async (req, res) => {
  try {
    const { accessToken, refreshToken, expiresAt } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: "Missing access token" });
    }

    const { activities, totalCalories, newTokens } = await fetchStravaActivities({
      accessToken, refreshToken, expiresAt
    });

    res.json({
      activities,
      totalCalories,
      newTokens
    });

  } catch (error) {
    console.error("Strava activities error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy OpenAI
app.post("/api/chat", verifyIdToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { messages } = req.body;
    
    // Fetch data from Firestore via Admin SDK
    const userDocRef = db.collection('users').doc(userId);
    
    const [settingsSnap, currentMacrosSnap, dailyTotalsSnap, mealHistorySnap] = await Promise.all([
      userDocRef.collection('settings').doc('userSettings').get(),
      userDocRef.collection('data').doc('currentMacros').get(),
      userDocRef.collection('data').doc('dailyTotals').get(),
      userDocRef.collection('data').doc('mealHistory').get()
    ]);
    
    const settings = settingsSnap.data() || {};
    const macroGoals = settings.macroGoals || { calories: 2000, protein: 150, carbs: 225, fat: 65 };
    const currentMacros = currentMacrosSnap.data() || { calories: 0, protein: 0, carbs: 0, fat: 0, date: '' };
    const dailyTotalsMap = dailyTotalsSnap.data()?.totals || {};
    const mealHistoryList = mealHistorySnap.data()?.meals || [];
    
    
    // Fetch Strava context using helper
    const { contextString: stravaContext } = await getStravaContext(userId, db);
    
    const todayStr = getLocalDateString();
    
    // Reset daily macros if it's a new day
    if (currentMacros.date !== todayStr) {
      currentMacros.calories = 0;
      currentMacros.protein = 0;
      currentMacros.carbs = 0;
      currentMacros.fat = 0;
      currentMacros.date = todayStr;
    }

    const systemPrompt = buildSystemPrompt(currentMacros, macroGoals, stravaContext, settings);
    const tools = getChatTools();

    const messagesWithSystem = messages[0]?.role === "system" ? messages : [systemPrompt, ...messages];
    
    // Call OpenAI API
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        messages: messagesWithSystem,
        tools: tools,
        tool_choice: "auto"
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API Error (${response.status}): ${await response.text()}`);
    }

    const data = await response.json();
    const message = data.choices[0].message;
    
    let finalReply = message.content || "";
    let newlyLoggedMeals = [];
    let updatedTotals = currentMacros;
    let suggestedMeal = null;

    if (message.tool_calls) {
      const result = await processToolCalls(message.tool_calls, currentMacros, dailyTotalsMap, mealHistoryList);
      finalReply = result.finalReply || finalReply;
      newlyLoggedMeals = result.newlyLoggedMeals;
      updatedTotals = result.updatedTotals;
      suggestedMeal = result.suggestedMeal || null;
      
      const batch = db.batch();
      batch.set(userDocRef.collection('data').doc('currentMacros'), { ...updatedTotals, updatedAt: new Date().toISOString() });
      batch.set(userDocRef.collection('data').doc('dailyTotals'), { totals: dailyTotalsMap, updatedAt: new Date().toISOString() });
      batch.set(userDocRef.collection('data').doc('mealHistory'), { meals: mealHistoryList, updatedAt: new Date().toISOString() });
      await batch.commit();
    }

    res.json({
      reply: finalReply,
      totals: updatedTotals,
      meals: newlyLoggedMeals,
      suggestedMeal
    });

  } catch (err) {
    console.error('❌ [OPENAI] Error:', err);
    res.status(500).json({
      error: `Server error: ${err.message}`
    });
  }
});

// Rate proactive message
app.post("/api/rate-message", verifyIdToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { messageId, thumbs } = req.body;
    
    const userDocRef = db.collection('users').doc(userId);
    const messagesSnap = await userDocRef.collection('data').doc('messages').get();
    
    if (messagesSnap.exists) {
      let data = messagesSnap.data();
      let messages = data.messages || [];
      const msgIndex = messages.findIndex(m => m.id === messageId);
      
      if (msgIndex !== -1) {
        messages[msgIndex].thumbs = thumbs;
        await userDocRef.collection('data').doc('messages').set({ messages }, { merge: true });
        
        // Also log to a separate collection for easy querying
        await db.collection('proactiveLogs').add({
          userId,
          messageId,
          thumbs,
          timestamp: new Date().toISOString()
        });
        
        return res.json({ success: true });
      }
    }
    res.status(404).json({ error: "Message not found" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Strava Webhook Challenge
app.get("/api/strava/webhook", (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    const expectedToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || 'eattailor_strava_webhook_token';
    if (mode === 'subscribe' && token === expectedToken) {
      console.log('WEBHOOK_VERIFIED');
      res.json({ "hub.challenge": challenge });
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// Strava Webhook Event
app.post("/api/strava/webhook", async (req, res) => {
  // Strava requires 200 OK within 2 seconds
  res.status(200).send("EVENT_RECEIVED");
  
  const event = req.body;
  console.log('🚴 [WEBHOOK] Event received:', JSON.stringify(event));

  // We only care about new activities being created
  if (event.object_type !== 'activity' || event.aspect_type !== 'create') {
    return;
  }

  const athleteId = event.owner_id;
  
  try {
    // Find user by athleteId
    const usersSnap = await db.collection('users').get();
    let targetUserId = null;
    let targetAuth = null;
    
    for (const userDoc of usersSnap.docs) {
      const authSnap = await db.collection('users').doc(userDoc.id).collection('data').doc('stravaAuth').get();
      if (authSnap.exists) {
        const authData = authSnap.data();
        if (authData.athlete && authData.athlete.id === athleteId) {
          targetUserId = userDoc.id;
          targetAuth = authData;
          break;
        }
      }
    }
    
    if (!targetUserId) {
      console.log('🚴 [WEBHOOK] No user found for athlete:', athleteId);
      return;
    }

    const userDocRef = db.collection('users').doc(targetUserId);
    const settingsSnap = await userDocRef.collection('settings').doc('userSettings').get();
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    
    if (settings.proactiveMessages === false) {
      console.log('🚴 [WEBHOOK] Proactive messages disabled for user:', targetUserId);
      return;
    }

    // Process the new activity context (which triggers a fresh fetch of activities)
    const { contextString } = await getStravaContext(targetUserId, db);
    
    // Fetch current state
    const currentMacrosSnap = await userDocRef.collection('data').doc('currentMacros').get();
    const currentMacros = currentMacrosSnap.exists ? currentMacrosSnap.data() : { calories: 0, protein: 0, carbs: 0, fat: 0, date: getLocalDateString() };
    const macroGoals = settings.macroGoals || { calories: 2000, protein: 150, carbs: 225, fat: 65 };

    const prompt = buildSystemPrompt(currentMacros, macroGoals, contextString, settings);
    const messages = [
      prompt,
      { role: "user", content: "I just finished a workout! Generate a short, encouraging proactive nudge (1-2 sentences) about my updated calorie targets and what I should eat next to recover." }
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_BRIEF_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini",
        messages: messages,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const aiMessage = data.choices[0].message.content;

      // Save nudge to chat history
      const msgSnap = await userDocRef.collection('data').doc('messages').get();
      let history = msgSnap.exists ? msgSnap.data().messages || [] : [];
      
      history.push({
        id: 'nudge_' + Date.now(),
        role: "assistant",
        text: aiMessage,
        time: Date.now(),
        isProactive: true,
        type: 'webhook_nudge'
      });
      
      await userDocRef.collection('data').doc('messages').set({ messages: history }, { merge: true });
      console.log('🚴 [WEBHOOK] Nudge generated and saved for user:', targetUserId);
    }
  } catch (err) {
    console.error('🚴 [WEBHOOK] Error processing event:', err);
  }
});

// Serve auth page at /auth
app.get("/auth", (req, res) => {
  res.sendFile(path.join(__dirname, "auth.html"));
});

// Serve the main app at /app
app.get("/app", (req, res) => {
  res.sendFile(path.join(__dirname, "app.html"));
});

// Serve landing page (index.html) for everything else (catch-all)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(process.env.PORT || 8080, () => {
  console.log("Server running on port " + (process.env.PORT || 8080));

  // Validate environment variables on startup
  console.log('\n🔍 [STARTUP] Environment variable check:');
  console.log('  - OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? `✅ Set (${process.env.OPENAI_API_KEY.substring(0, 10)}...)` : '❌ NOT SET');
  console.log('  - OPENAI_MODEL:', process.env.OPENAI_MODEL ? `✅ Set (${process.env.OPENAI_MODEL})` : '❌ NOT SET (using default)');
  console.log('  - STRAVA_CLIENT_ID:', process.env.STRAVA_CLIENT_ID ? '✅ Set' : '❌ NOT SET');
  console.log('  - STRAVA_CLIENT_SECRET:', process.env.STRAVA_CLIENT_SECRET ? '✅ Set' : '❌ NOT SET');
  console.log('  - PORT:', process.env.PORT || '8080 (default)');

  if (!process.env.OPENAI_API_KEY) {
    console.error('\n⚠️  WARNING: No OPENAI_API_KEY is set! AI chat will not work.');
  }
});
