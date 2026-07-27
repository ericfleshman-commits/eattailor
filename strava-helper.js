import fetch from "node-fetch";

export async function fetchStravaActivities(stravaAuth) {
  const { accessToken, refreshToken, expiresAt } = stravaAuth;

  if (!accessToken) {
    throw new Error("Missing access token");
  }

  let currentAccessToken = accessToken;
  let newTokens = null;

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
      const tokens = await refreshResponse.json();
      currentAccessToken = tokens.access_token;
      newTokens = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_at,
        athlete: stravaAuth.athlete
      };
    } else {
      throw new Error("Failed to refresh Strava token");
    }
  }

  // Fetch activities from last 7 days for "This Week" display
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  const timestamp = Math.floor(sevenDaysAgo.getTime() / 1000);

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
    throw new Error("Failed to fetch activities");
  }

  const activities = await activitiesResponse.json();

  // Filter to only include real workouts
  const WORKOUT_TYPES = [
    'Run', 'Ride', 'Swim', 'Walk', 'Hike', 'VirtualRide', 'VirtualRun',
    'Elliptical', 'StairStepper', 'Rowing', 'EBikeRide',
    'Workout', 'WeightTraining', 'Crossfit', 'HIIT', 'Pilates',
    'Yoga', 'Meditation', 'Stretching',
    'RockClimbing', 'Climbing', 'Bouldering', 'SportClimbing', 'TraditionalClimbing',
    'IceSkate', 'InlineSkate', 'AlpineSki', 'BackcountrySki', 'NordicSki',
    'Snowboard', 'Snowshoe', 'IceHockey',
    'Kayaking', 'Canoeing', 'Surfing', 'Windsurf', 'Kitesurf',
    'StandUpPaddling', 'Sailing', 'Swimming',
    'Tennis', 'Pickleball', 'Badminton', 'Squash', 'TableTennis', 'Racquetball',
    'Soccer', 'Basketball', 'Football', 'Volleyball', 'Baseball', 'Softball',
    'Hockey', 'Lacrosse', 'Rugby', 'Cricket',
    'Golf', 'Boxing', 'MartialArts', 'Dance', 'Gymnastics',
    'Handcycle', 'Skateboard', 'RollerSki'
  ];

  const workouts = activities.filter(activity => {
    const isWorkoutType = WORKOUT_TYPES.includes(activity.type);
    const hasCaloriesBurned = (activity.calories && activity.calories > 25) ||
                              (activity.kilojoules && activity.kilojoules > 25);
    const hasMovingTime = activity.moving_time && activity.moving_time > 300;
    return isWorkoutType && (hasCaloriesBurned || hasMovingTime);
  });

  let totalCalories = 0;
  const processedWorkouts = workouts.map(a => {
    let calories = 0;
    if (a.calories) {
      calories = a.calories;
    } else if (a.kilojoules) {
      calories = Math.round(a.kilojoules * 0.239);
    } else if (a.moving_time) {
      calories = Math.round((a.moving_time / 60) * 5);
    }
    
    totalCalories += calories;

    return {
      id: a.id,
      name: a.name,
      type: a.type,
      distance: a.distance, // in meters
      movingTime: a.moving_time, // in seconds
      calories: calories,
      startDate: a.start_date
    };
  });

  return { activities: processedWorkouts, totalCalories, newTokens };
}

export async function getStravaContext(userId, db) {
  const userDocRef = db.collection('users').doc(userId);
  const stravaAuthSnap = await userDocRef.collection('data').doc('stravaAuth').get();
  
  if (!stravaAuthSnap.exists) {
    return { contextString: "No Strava data connected.", activities: [] };
  }

  const stravaAuth = stravaAuthSnap.data();
  if (!stravaAuth.accessToken) {
    return { contextString: "No Strava data connected.", activities: [] };
  }

  try {
    const { activities, totalCalories, newTokens } = await fetchStravaActivities(stravaAuth);
    
    // Save new tokens if they were refreshed
    if (newTokens) {
      await userDocRef.collection('data').doc('stravaAuth').set(newTokens, { merge: true });
    }

    if (activities.length === 0) {
      return { contextString: "No workouts logged in the last 7 days.", activities: [] };
    }

    let contextString = "STRAVA TRAINING HISTORY (LAST 7 DAYS):\n";
    activities.forEach(a => {
      const date = new Date(a.startDate).toLocaleDateString();
      const minutes = Math.round(a.movingTime / 60);
      const miles = a.distance ? (a.distance * 0.000621371).toFixed(1) + ' mi' : 'N/A distance';
      contextString += `- ${date}: ${a.name} (${a.type}), ${minutes} min, ${miles}, ${a.calories} cal burned.\n`;
    });
    
    return { contextString, activities };
  } catch (error) {
    console.error("Error fetching Strava context:", error);
    return { contextString: "Strava data temporarily unavailable.", activities: [] };
  }
}
