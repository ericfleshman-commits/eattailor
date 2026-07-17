import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

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
              window.opener.postMessage(messageData, '*');
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
app.post("/api/strava/activities", async (req, res) => {
  try {
    const { accessToken, refreshToken, expiresAt } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: "Missing access token" });
    }

    let currentAccessToken = accessToken;

    // Check if token is expired and refresh if needed
    if (Date.now() / 1000 > expiresAt) {
      const refreshResponse = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: process.env.STRAVA_CLIENT_ID,
          client_secret: process.env.STRAVA_CLIENT_SECRET,
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      });

      if (refreshResponse.ok) {
        const newTokens = await refreshResponse.json();
        currentAccessToken = newTokens.access_token;
        // Return new tokens to update in Firestore
        res.newTokens = {
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token,
          expiresAt: newTokens.expires_at
        };
      }
    }

    // Fetch activities from last 7 days for "This Week" display
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const timestamp = Math.floor(sevenDaysAgo.getTime() / 1000);

    console.log('📅 [DATE DEBUG] ========== DATE FILTERING ==========');
    console.log('📅 [DATE DEBUG] Server time:', now.toString());
    console.log('📅 [DATE DEBUG] Fetching activities from last 7 days');
    console.log('📅 [DATE DEBUG] Fetching activities after:', sevenDaysAgo.toString());

    const activitiesResponse = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${timestamp}&per_page=50`,
      {
        headers: {
          Authorization: `Bearer ${currentAccessToken}`
        }
      }
    );

    if (!activitiesResponse.ok) {
      const error = await activitiesResponse.text();
      console.error("Strava activities fetch failed:", error);
      return res.status(500).json({ error: "Failed to fetch activities" });
    }

    const activities = await activitiesResponse.json();

    console.log('🔍 [STRAVA DEBUG] ========== RAW API RESPONSE ==========');
    console.log('🔍 [STRAVA DEBUG] Number of activities returned:', activities.length);

    // Log each activity's date and compare to today
    activities.forEach((activity, index) => {
      const activityDate = new Date(activity.start_date);
      const activityLocalDate = activityDate.toLocaleDateString();
      const todayLocalDate = new Date().toLocaleDateString();

      console.log(`🔍 [ACTIVITY ${index + 1} DATE CHECK]`);
      console.log(`  - Name: ${activity.name}`);
      console.log(`  - Type: ${activity.type}`);
      console.log(`  - Start date (raw): ${activity.start_date}`);
      console.log(`  - Start date (parsed): ${activityDate.toString()}`);
      console.log(`  - Activity date (local): ${activityLocalDate}`);
      console.log(`  - Today date (local): ${todayLocalDate}`);
      console.log(`  - Is today?: ${activityLocalDate === todayLocalDate}`);
      console.log(`  - Calories: ${activity.calories || 'N/A'}`);
      console.log(`  - Kilojoules: ${activity.kilojoules || 'N/A'}`);
    });

    if (activities.length > 0) {
      console.log('🔍 [STRAVA DEBUG] Full first activity object:', JSON.stringify(activities[0], null, 2));
    }

    // Log ALL activity types to help debug missing types
    console.log('📋 [STRAVA DEBUG] All activity types returned from Strava:');
    const uniqueTypes = [...new Set(activities.map(a => a.type))];
    uniqueTypes.forEach(type => {
      const count = activities.filter(a => a.type === type).length;
      console.log(`  - ${type}: ${count} activity(ies)`);
    });

    // Filter to only include real workouts (not all-day activity tracking)
    // Workout types that should be counted
    const WORKOUT_TYPES = [
      // Cardio
      'Run', 'Ride', 'Swim', 'Walk', 'Hike', 'VirtualRide', 'VirtualRun',
      'Elliptical', 'StairStepper', 'Rowing', 'EBikeRide',

      // Strength & Fitness
      'Workout', 'WeightTraining', 'Crossfit', 'HIIT', 'Pilates',

      // Mind-Body
      'Yoga', 'Meditation', 'Stretching',

      // Climbing
      'RockClimbing', 'Climbing', 'Bouldering', 'SportClimbing', 'TraditionalClimbing',

      // Winter Sports
      'IceSkate', 'InlineSkate', 'AlpineSki', 'BackcountrySki', 'NordicSki',
      'Snowboard', 'Snowshoe', 'IceHockey',

      // Water Sports
      'Kayaking', 'Canoeing', 'Surfing', 'Windsurf', 'Kitesurf',
      'StandUpPaddling', 'Sailing', 'Swimming',

      // Racquet Sports
      'Tennis', 'Pickleball', 'Badminton', 'Squash', 'TableTennis', 'Racquetball',

      // Team Sports
      'Soccer', 'Basketball', 'Football', 'Volleyball', 'Baseball', 'Softball',
      'Hockey', 'Lacrosse', 'Rugby', 'Cricket',

      // Other Sports
      'Golf', 'Boxing', 'MartialArts', 'Dance', 'Gymnastics',
      'Handcycle', 'Skateboard', 'RollerSki'
    ];

    const workouts = activities.filter(activity => {
      const isWorkoutType = WORKOUT_TYPES.includes(activity.type);
      // Lower threshold to 25 calories to include lower-intensity workouts
      const hasCaloriesBurned = (activity.calories && activity.calories > 25) ||
                                (activity.kilojoules && activity.kilojoules > 25);
      // Also include if it has moving time over 5 minutes (300 seconds)
      const hasMovingTime = activity.moving_time && activity.moving_time > 300;

      // Debug logging for each activity
      console.log(`\n🔍 [FILTER CHECK] Activity: ${activity.name}`);
      console.log(`  - Type: ${activity.type}`);
      console.log(`  - Is workout type? ${isWorkoutType}`);
      console.log(`  - Calories: ${activity.calories || 'N/A'}`);
      console.log(`  - Kilojoules: ${activity.kilojoules || 'N/A'}`);
      console.log(`  - Moving time: ${activity.moving_time ? `${Math.round(activity.moving_time / 60)}min` : 'N/A'}`);
      console.log(`  - Has enough calories? ${hasCaloriesBurned}`);
      console.log(`  - Has moving time? ${hasMovingTime}`);
      console.log(`  - INCLUDED? ${isWorkoutType && (hasCaloriesBurned || hasMovingTime) ? 'YES ✅' : 'NO ❌'}`);

      return isWorkoutType && (hasCaloriesBurned || hasMovingTime);
    });

    console.log(`🔍 [STRAVA DEBUG] Filtered to ${workouts.length} workouts (from ${activities.length} activities)`);

    // Show what was excluded
    const excluded = activities.filter(a => !workouts.includes(a));
    if (excluded.length > 0) {
      console.log(`⏭️ [STRAVA DEBUG] Excluded ${excluded.length} activities:`);
      excluded.forEach((activity, index) => {
        const calories = activity.calories || (activity.kilojoules ? Math.round(activity.kilojoules * 0.239) : 0);
        console.log(`  - ${activity.name} (${activity.type}): ${calories} cal`);
      });
    }

    // Calculate total calories burned from WORKOUTS ONLY
    let totalCalories = 0;
    workouts.forEach((activity, index) => {
      console.log(`🔍 [WORKOUT ${index + 1}] Name: ${activity.name}`);
      console.log(`🔍 [WORKOUT ${index + 1}] Type: ${activity.type}`);
      console.log(`🔍 [WORKOUT ${index + 1}] Start: ${activity.start_date}`);
      console.log(`🔍 [WORKOUT ${index + 1}] Calories field: ${activity.calories}`);
      console.log(`🔍 [WORKOUT ${index + 1}] Kilojoules field: ${activity.kilojoules}`);

      if (activity.calories) {
        console.log(`✅ [WORKOUT ${index + 1}] Adding ${activity.calories} calories to total`);
        totalCalories += activity.calories;
      } else if (activity.kilojoules) {
        // Convert kilojoules to calories (1 kJ = 0.239 kcal)
        const cals = Math.round(activity.kilojoules * 0.239);
        console.log(`⚡ [WORKOUT ${index + 1}] Converting ${activity.kilojoules} kJ to ${cals} calories`);
        totalCalories += cals;
      } else if (activity.moving_time) {
        // Estimate calories if no calorie data but has moving time
        // Use 5 calories per minute as conservative estimate
        const estimatedCals = Math.round((activity.moving_time / 60) * 5);
        console.log(`📐 [WORKOUT ${index + 1}] Estimating ${estimatedCals} calories from ${Math.round(activity.moving_time / 60)} min of moving time`);
        totalCalories += estimatedCals;
      } else {
        console.log(`⚠️ [WORKOUT ${index + 1}] No calories, kilojoules, or moving time found`);
      }
    });

    console.log(`📊 [STRAVA DEBUG] Total calories from WORKOUTS ONLY: ${totalCalories}`);

    res.json({
      activities: workouts.map(a => {
        // Calculate calories using same logic as total calculation
        let calories = 0;
        if (a.calories) {
          calories = a.calories;
        } else if (a.kilojoules) {
          calories = Math.round(a.kilojoules * 0.239);
        } else if (a.moving_time) {
          // Estimate: 5 cal/min
          calories = Math.round((a.moving_time / 60) * 5);
        }

        return {
          id: a.id,
          name: a.name,
          type: a.type,
          distance: a.distance,
          movingTime: a.moving_time,
          calories: calories,
          startDate: a.start_date
        };
      }),
      totalCalories,
      newTokens: res.newTokens || null
    });

  } catch (error) {
    console.error("Strava activities error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy OpenAI
app.post("/api/chat", async (req, res) => {
  try {
    console.log('🔵 [OPENAI] ========== API REQUEST STARTED ==========');
    console.log('🔵 [OPENAI] Timestamp:', new Date().toISOString());

    const { messages, currentMacros, macroGoals } = req.body;

    console.log('🔵 [OPENAI] Request body received:');
    console.log('  - Messages count:', messages?.length || 0);
    console.log('  - Current macros:', currentMacros);
    console.log('  - Macro goals:', macroGoals);

    // Add system prompt for conversational responses
    const systemPrompt = {
      role: "system",
      content: `You are a friendly nutrition coach helping someone track their meals. Be conversational and encouraging, but keep it concise (2-4 sentences max).

CRITICAL FORMATTING RULE - MUST FOLLOW:
❌ NEVER use markdown formatting (**, *, _, ~, backticks, etc.)
❌ NEVER use asterisks, underscores, or any special symbols for emphasis
✅ ALWAYS write in plain text only
✅ Numbers should be plain digits: 1850 NOT **1850**
✅ Use regular text without any formatting symbols

RESPONSE STYLE:
When users log food:
1. Acknowledge in a natural, friendly way
2. Estimate ONLY the meal macros for what they just logged - MUST include all 4 macros: calories, protein, carbs, fat
3. Optional: Add a light question or comment about their day

📊 MACRO DATA YOU HAVE ACCESS TO:
You receive:
- currentMacros: {calories, protein, carbs, fat} - what they've eaten so far today
- macroGoals: {calories, protein, carbs, fat} - their daily targets

✅ WHEN USER ASKS QUESTIONS (contains "?" or asks "how much", "how many"):
DO answer questions about their progress:
- "You've had X cal so far, Y remaining to hit your Z goal"
- "You need X more grams of protein today"
- "You have Y carbs left for the day"

❌ WHEN USER LOGS NEW FOOD (no "?", just stating what they ate):
DON'T state cumulative totals after logging:
- "brings you to X cal for the day" ← FORBIDDEN
- "daily total is now X cal" ← FORBIDDEN
- "that puts you at X cal today" ← FORBIDDEN
ONLY provide macros for the meal they just logged.

The sidebar AUTOMATICALLY shows running totals. When they LOG food, only estimate that meal. When they ASK questions, calculate and answer.

IMPORTANT: If the user logs MULTIPLE meals in one message:
- Calculate macros for EACH meal separately and list them
- DO NOT calculate or state daily totals - just the individual meal macros

Example with multiple meals:
User: "breakfast: burrito. lunch: pasta"
GOOD: "Nice combo! Burrito: around 720 cal, 25g protein, 85g carbs, 28g fat. Pasta: about 620 cal, 18g protein, 110g carbs, 8g fat. Solid fuel!"
BAD: "That adds up nicely. Brings you to 1850 cal, 65g protein, 230g carbs, 60g fat for the day." ← FORBIDDEN

Keep it conversational but concise - 2-4 sentences max. Don't be robotic, but don't write paragraphs either.

CRITICAL RULE - ALL FOUR MACROS REQUIRED:
When a user logs food, you MUST provide ALL FOUR macros in EVERY response:
1. Calories (cal)
2. Protein (g)
3. Carbs (g)
4. Fat (g)

NEVER skip any macro. NEVER say "about X cal and Y protein" without including carbs and fat.

FORMAT REQUIREMENT:
✅ CORRECT: "That's about 320 cal, 8g protein, 45g carbs, and 16g fat"
✅ CORRECT: "That handful has about 250 cal, 8g protein, 20g carbs, 15g fat"
❌ WRONG: "That adds 320 cal and 8g protein" (missing carbs and fat - UNACCEPTABLE!)
❌ WRONG: "About 250 cal, 8g protein" (missing carbs and fat - UNACCEPTABLE!)

If you cannot estimate a macro with confidence, provide your best estimate rather than omitting it.
Trail mix, nuts, snacks ALL have fat - NEVER skip fat calculations.

REMEMBER: Only provide macros for the specific meal logged - DO NOT calculate daily totals.

EXAMPLES (ALL IN PLAIN TEXT - NO FORMATTING):

Single meal:
User: "I had scrambled eggs"
GOOD: "Nice! That's about 400 cal, 30g protein, 5g carbs, 28g fat. What else you having today?"
BAD (uses markdown): "Nice! That's about **400** cal, **30**g protein, **5**g carbs, **28**g fat."
BAD (mentions daily total): "Nice! That's 400 cal, 30g protein, 5g carbs, 28g fat. Daily total: 400 cal. What else you having today?"
BAD (too long): "Great choice! Scrambled eggs are an excellent source of protein. A typical serving contains about 400 calories, with 30g of protein from the eggs, plus healthy fats..."

Another meal:
User: "Just had a protein shake"
GOOD: "Solid choice! That shake's around 200 cal, 60g protein, 10g carbs, 3g fat. Feeling good?"
BAD (uses markdown): "Solid choice! That shake's around **200** cal with **60**g protein."
BAD (mentions daily total): "Solid choice! That's 200 cal, 60g protein, 10g carbs, 3g fat. Brings you to 1700 cal for the day."

Multiple meals at once:
User: "Breakfast: french toast. Lunch: chicken pasta. Dinner: spam with rice cakes. Snack: dried mango"
GOOD: "Got it all logged! French toast: 1290 cal, 28g protein, 180g carbs, 58g fat. Chicken pasta: 805 cal, 42g protein, 95g carbs, 28g fat. Spam with rice cakes: 620 cal, 18g protein, 78g carbs, 28g fat. Dried mango: 200 cal, 10g protein, 23g carbs, 14g fat. How was everything?"
BAD: "Got it all logged! That's a solid 2915 cal total - 98g protein, 376g carbs, 128g fat. How was everything?"

Educational question (don't track):
User: "Is pizza healthy?"
GOOD: "Pizza can definitely fit in a balanced diet! A typical slice is about 285 cal, 12g protein, 35g carbs, 10g fat. Just watch your portions and you're good."

CALCULATION LOGIC:
- Calculate macros ONLY for the food(s) user mentioned
- DO NOT add to daily totals or mention cumulative totals
- The sidebar automatically calculates and displays daily running totals
- Be friendly and conversational, not robotic

SPELLING & TYPOS:
- Auto-correct obvious spelling mistakes and typos in food names
- Examples: "bay carrots" → "baby carrots", "chiken" → "chicken", "protien" → "protein"
- Use context clues to infer the correct food item
- Don't mention the typo - just use the corrected version naturally

🗑️ CRITICAL: DELETION REQUESTS - MUST INCLUDE MARKER:
When user asks to REMOVE/DELETE a meal:
- You MUST add [DELETE:food_name] at the very END of your response
- This is REQUIRED - not optional
- The marker must be the LAST thing in your response

Examples (COPY THIS FORMAT EXACTLY):
User: "remove the burger"
Your response: "Got it, removing the burger! [DELETE:burger]"

User: "delete the ice cream"
Your response: "No problem, taking that off. [DELETE:ice cream]"

User: "take off that pizza"
Your response: "Sure thing! [DELETE:pizza]"

IMPORTANT: The [DELETE:food] marker is REQUIRED for deletions to work!

🔬 MACRO MATH VALIDATION (CRITICAL):
Before stating ANY macros for a meal, you MUST verify the math:
- Formula: (protein × 4) + (carbs × 4) + (fat × 9) = calories
- Tolerance: ±10 calories is acceptable for rounding
- If your math doesn't validate, recalculate until it does
- Example validation:
  ✅ CORRECT: 30g protein, 5g carbs, 28g fat = (30×4) + (5×4) + (28×9) = 120 + 20 + 252 = 392 cal
  ❌ WRONG: 30g protein, 5g carbs, 28g fat = 450 cal (math doesn't work - should be 392)

ESTIMATION GUIDELINES:
- Use USDA/standard portions when size not specified (e.g., "chicken breast" = 6 oz, "eggs" = 2 large)
- For restaurant items, use typical serving sizes (not oversized portions)
- Round macros to whole numbers for simplicity
- Never fabricate precision - if uncertain, give honest estimates
- PROTEIN SOURCES - Be accurate with protein counts (users often track protein closely):
  • Eggs (2 large): 12g protein, 1g carbs, 10g fat, 142 cal
  • Chicken breast (6 oz cooked): 52g protein, 0g carbs, 6g fat, 248 cal
  • Shrimp (6 oz cooked): 36g protein, 0g carbs, 2g fat, 160 cal
  • Ground beef (6 oz, 80/20): 42g protein, 0g carbs, 32g fat, 460 cal
  • Salmon (6 oz): 40g protein, 0g carbs, 18g fat, 330 cal
  • Protein bar (typical): 20g protein, 25g carbs, 8g fat, 240 cal
  • Protein shake (standard scoop): 25g protein, 3g carbs, 2g fat, 130 cal
  • Greek yogurt (1 cup): 20g protein, 10g carbs, 5g fat, 150 cal
- CARB SOURCES:
  • Rice (1 cup cooked): 4g protein, 45g carbs, 0g fat, 206 cal
  • Pasta (2 oz dry / 1 cup cooked): 7g protein, 42g carbs, 1g fat, 200 cal
  • Bread (1 slice): 3g protein, 15g carbs, 1g fat, 80 cal

DO NOT:
❌ Write paragraphs or be overly detailed
❌ Break down every ingredient separately (just give meal total)
❌ Be overly enthusiastic with exclamation points everywhere
❌ Give nutrition lectures unless asked
❌ NEVER use markdown formatting or special symbols (**, *, _, ~, etc.)

📊 CURRENT USER DATA (use this for calculations):
Current macros consumed today:
- Calories: ${currentMacros?.calories || 0} cal
- Protein: ${currentMacros?.protein || 0}g
- Carbs: ${currentMacros?.carbs || 0}g
- Fat: ${currentMacros?.fat || 0}g

Daily macro goals:
- Calories: ${macroGoals?.calories || 2000} cal
- Protein: ${macroGoals?.protein || 150}g
- Carbs: ${macroGoals?.carbs || 225}g
- Fat: ${macroGoals?.fat || 65}g

When user asks questions, calculate remaining macros: (goal - current) = remaining`
    };

    console.log('📊 [DEBUG] Macro data injected into AI prompt:');
    console.log('  Current macros:', currentMacros);
    console.log('  Goals:', macroGoals);
    console.log('  Prompt includes:', {
      currentCals: currentMacros?.calories,
      currentProtein: currentMacros?.protein,
      currentCarbs: currentMacros?.carbs,
      goalCals: macroGoals?.calories,
      goalProtein: macroGoals?.protein,
      goalCarbs: macroGoals?.carbs
    });

    // Prepend system prompt to messages if not already present
    const messagesWithSystem = messages[0]?.role === "system"
      ? messages
      : [systemPrompt, ...messages];

    console.log('🔵 [OPENAI] Prepared messages for API:');
    console.log('  - Total messages (with system):', messagesWithSystem.length);
    console.log('  - Model:', 'gpt-4o-mini');
    console.log('  - API Key present:', !!process.env.OPENAI_API_KEY);
    console.log('  - API Key prefix:', process.env.OPENAI_API_KEY?.substring(0, 10) + '...');

    const requestBody = {
      model: "gpt-4o-mini",
      messages: messagesWithSystem
    };

    console.log('🔵 [OPENAI] Making fetch request to OpenAI API...');

    const result = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log('🔵 [OPENAI] Response received:');
    console.log('  - Status:', result.status);
    console.log('  - Status text:', result.statusText);
    console.log('  - OK:', result.ok);

    if (!result.ok) {
      const errorText = await result.text();
      console.error('❌ [OPENAI] API ERROR - Request failed:');
      console.error('  - Status:', result.status);
      console.error('  - Status text:', result.statusText);
      console.error('  - Error response:', errorText);

      // Try to parse error as JSON for better details
      try {
        const errorJson = JSON.parse(errorText);
        console.error('  - Parsed error:', JSON.stringify(errorJson, null, 2));
      } catch (e) {
        console.error('  - Raw error text:', errorText);
      }

      return res.status(500).json({
        error: `OpenAI API Error (${result.status}): ${errorText}`
      });
    }

    const data = await result.json();
    console.log('🔵 [OPENAI] Parsing response data...');
    console.log('  - Choices available:', data.choices?.length || 0);
    console.log('  - Usage:', data.usage);

    if (!data.choices || data.choices.length === 0) {
      console.error('❌ [OPENAI] No choices in response!');
      console.error('  - Full response:', JSON.stringify(data, null, 2));
      return res.status(500).json({
        error: 'OpenAI returned no response choices'
      });
    }

    const aiMessage = data.choices[0].message.content;
    console.log('✅ [OPENAI] Success! AI response received');
    console.log('  - Response length:', aiMessage.length, 'characters');
    console.log('  - Response preview:', aiMessage.substring(0, 100) + '...');
    console.log('🔵 [OPENAI] ========== API REQUEST COMPLETED ==========');

    // For now, return plain text response
    // TODO: Add JSON parsing later once basic functionality works
    res.json({
      reply: aiMessage,
      macros: null // Will implement structured parsing later
    });
  } catch (err) {
    console.error('❌ [OPENAI] ========== EXCEPTION CAUGHT ==========');
    console.error('❌ [OPENAI] Error type:', err.name);
    console.error('❌ [OPENAI] Error message:', err.message);
    console.error('❌ [OPENAI] Error stack:', err.stack);
    console.error('❌ [OPENAI] Full error object:', err);
    console.error('❌ [OPENAI] ========================================');

    res.status(500).json({
      error: `Server error: ${err.message}`,
      errorType: err.name,
      timestamp: new Date().toISOString()
    });
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
  console.log('  - STRAVA_CLIENT_ID:', process.env.STRAVA_CLIENT_ID ? '✅ Set' : '❌ NOT SET');
  console.log('  - STRAVA_CLIENT_SECRET:', process.env.STRAVA_CLIENT_SECRET ? '✅ Set' : '❌ NOT SET');
  console.log('  - PORT:', process.env.PORT || '8080 (default)');

  if (!process.env.OPENAI_API_KEY) {
    console.error('\n⚠️  WARNING: OPENAI_API_KEY is not set! AI chat will not work.');
    console.error('⚠️  Please set OPENAI_API_KEY in your environment variables or .env file\n');
  }
});
