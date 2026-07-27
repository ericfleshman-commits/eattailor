import cron from "node-cron";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStravaContext } from "./strava-helper.js";
import { buildBriefPrompt, getLocalDateString } from "./chat-core.js";

if (getApps().length === 0) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = new URL('./service-account.json', import.meta.url).pathname;
  initializeApp({ projectId: "eattailor" });
}

const db = getFirestore();

async function generateMorningBriefs() {
  console.log("🌅 [CRON] Starting morning briefs generation...");
  
  try {
    const dataDocsSnap = await db.collectionGroup("data").get();
    const userIds = new Set();
    dataDocsSnap.forEach(doc => {
      if (doc.ref.parent && doc.ref.parent.parent) {
        userIds.add(doc.ref.parent.parent.id);
      }
    });
    
    for (const userId of userIds) {
      console.log(`🌅 [CRON] Processing user: ${userId}`);
      
      const userDocRef = db.collection('users').doc(userId);
      const settingsSnap = await userDocRef.collection('settings').doc('userSettings').get();
      const settings = settingsSnap.exists ? settingsSnap.data() : {};
      
      if (settings.proactiveMessages === false) {
        console.log(`🌅 [CRON] Skipping user ${userId} (proactive messages disabled)`);
        continue;
      }
      
      // Deduplication check: see if a morning brief exists for today
      const messagesSnap = await userDocRef.collection('data').doc('messages').get();
      const history = messagesSnap.exists ? messagesSnap.data().messages || [] : [];
      
      const today = getLocalDateString();
      const alreadyHasBrief = history.some(m => m.type === 'morning_brief' && new Date(m.time).toLocaleDateString() === new Date().toLocaleDateString());
      
      if (alreadyHasBrief) {
        console.log(`🌅 [CRON] Skipping user ${userId} (brief already generated today)`);
        continue;
      }

      // Gather context
      const { contextString } = await getStravaContext(userId, db);
      const currentMacrosSnap = await userDocRef.collection('data').doc('currentMacros').get();
      let currentMacros = currentMacrosSnap.exists ? currentMacrosSnap.data() : { calories: 0, protein: 0, carbs: 0, fat: 0, date: today };
      
      if (currentMacros.date !== today) {
        currentMacros = { calories: 0, protein: 0, carbs: 0, fat: 0, date: today };
      }
      
      const macroGoals = settings.macroGoals || { calories: 2000, protein: 150, carbs: 225, fat: 65 };
      
      const prompt = buildBriefPrompt(currentMacros, macroGoals, contextString, settings);
      const messages = [
        prompt,
        { role: "user", content: "Good morning! Please generate my morning brief. Mention my recent training, what I should focus on today for nutrition, and give a short, encouraging sign-off. Do NOT log any meals right now, just provide the briefing." }
      ];
      
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_BRIEF_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: messages,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        const aiMessage = data.choices[0].message.content;
        
        history.push({
          id: 'brief_' + Date.now(),
          role: "assistant",
          text: aiMessage,
          time: Date.now(),
          isProactive: true,
          type: 'morning_brief'
        });
        
        await userDocRef.collection('data').doc('messages').set({ messages: history }, { merge: true });
        console.log(`🌅 [CRON] Morning brief generated and saved for user: ${userId}`);
      } else {
        const errText = await response.text();
        console.error(`🌅 [CRON] Failed to generate brief for user ${userId}:`, response.status, errText);
      }
    }
  } catch (err) {
    console.error("🌅 [CRON] Error running morning briefs:", err);
  }
}

async function generateEveningBriefs() {
  console.log("🌙 [CRON] Starting evening briefs generation...");
  
  try {
    const dataDocsSnap = await db.collectionGroup("data").get();
    const userIds = new Set();
    dataDocsSnap.forEach(doc => {
      if (doc.ref.parent && doc.ref.parent.parent) {
        userIds.add(doc.ref.parent.parent.id);
      }
    });
    
    for (const userId of userIds) {
      console.log(`🌙 [CRON] Processing user: ${userId}`);
      
      const userDocRef = db.collection('users').doc(userId);
      const settingsSnap = await userDocRef.collection('settings').doc('userSettings').get();
      const settings = settingsSnap.exists ? settingsSnap.data() : {};
      
      if (settings.proactiveMessages === false) {
        console.log(`🌙 [CRON] Skipping user ${userId} (proactive messages disabled)`);
        continue;
      }
      
      const messagesSnap = await userDocRef.collection('data').doc('messages').get();
      const history = messagesSnap.exists ? messagesSnap.data().messages || [] : [];
      
      const today = getLocalDateString();
      const alreadyHasBrief = history.some(m => m.type === 'evening_brief' && new Date(m.time).toLocaleDateString() === new Date().toLocaleDateString());
      
      if (alreadyHasBrief) {
        console.log(`🌙 [CRON] Skipping user ${userId} (brief already generated today)`);
        continue;
      }

      const { contextString } = await getStravaContext(userId, db);
      const currentMacrosSnap = await userDocRef.collection('data').doc('currentMacros').get();
      let currentMacros = currentMacrosSnap.exists ? currentMacrosSnap.data() : { calories: 0, protein: 0, carbs: 0, fat: 0, date: today };
      
      if (currentMacros.date !== today) {
        currentMacros = { calories: 0, protein: 0, carbs: 0, fat: 0, date: today };
      }
      
      const macroGoals = settings.macroGoals || { calories: 2000, protein: 150, carbs: 225, fat: 65 };
      
      const prompt = buildBriefPrompt(currentMacros, macroGoals, contextString, settings);
      const messages = [
        prompt,
        { role: "user", content: "Good evening! Please generate my evening close-out brief. Summarize how I did today against my targets, and give a short encouraging sign-off for tomorrow. Do NOT log any meals right now, just provide the briefing." }
      ];
      
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_BRIEF_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: messages,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        const aiMessage = data.choices[0].message.content;
        
        history.push({
          id: 'brief_' + Date.now(),
          role: "assistant",
          text: aiMessage,
          time: Date.now(),
          isProactive: true,
          type: 'evening_brief'
        });
        
        await userDocRef.collection('data').doc('messages').set({ messages: history }, { merge: true });
        console.log(`🌙 [CRON] Evening brief generated and saved for user: ${userId}`);
      } else {
        const errText = await response.text();
        console.error(`🌙 [CRON] Failed to generate brief for user ${userId}:`, response.status, errText);
      }
    }
  } catch (err) {
    console.error("🌙 [CRON] Error running evening briefs:", err);
  }
}

// Run every morning at 6:00 AM
cron.schedule("0 6 * * *", () => {
  generateMorningBriefs();
});

// Run every evening at 8:30 PM
cron.schedule("30 20 * * *", () => {
  generateEveningBriefs();
});

console.log("🌅/🌙 [CRON] Morning/Evening briefs cron jobs initialized (6:00 AM & 8:30 PM).");

export { generateMorningBriefs, generateEveningBriefs };
