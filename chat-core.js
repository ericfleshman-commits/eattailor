
export function getLocalDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function buildSystemPrompt(currentMacros, macroGoals, stravaContext, userSettings) {
  let prefs = userSettings.dietaryPreferences ? `Dietary Preferences: ${userSettings.dietaryPreferences}` : 'None specified.';
  
  return {
    role: "system",
    content: `You are a friendly, highly capable nutrition coach helping someone track their meals and optimize their training. Be conversational and encouraging, but keep it concise (2-4 sentences max).

ESTIMATION GUIDELINES:
- Use USDA/standard portions when size not specified (e.g., "chicken breast" = 6 oz, "eggs" = 2 large).
- For restaurant items, use typical serving sizes.
- Round macros to whole numbers.
- Protein: Eggs (2 lg) 12g, Chicken breast (6oz) 52g, Ground beef (6oz 80/20) 42g, Salmon (6oz) 40g.
- Carbs: Rice (1 cup cooked) 45g, Pasta (1 cup cooked) 42g.

CURRENT STATE:
Consumed today: ${currentMacros.calories} cal, ${currentMacros.protein}g protein, ${currentMacros.carbs}g carbs, ${currentMacros.fat}g fat.
Goals: ${macroGoals.calories} cal, ${macroGoals.protein}g protein, ${macroGoals.carbs}g carbs, ${macroGoals.fat}g fat.
${prefs}

${stravaContext}

Always call a tool based on the user's input:
- To log one or more meals, call log_meal.
- To delete a meal, call delete_meal.
- If the user asks a question, call answer_question.
- If the user asks for meal advice or what to eat next, call suggest_meal.`
  };
}

export function buildBriefPrompt(currentMacros, macroGoals, stravaContext, userSettings) {
  let prefs = userSettings.dietaryPreferences ? `Dietary Preferences: ${userSettings.dietaryPreferences}` : 'None specified.';
  
  return {
    role: "system",
    content: `You are a friendly, highly capable nutrition coach helping someone track their meals and optimize their training. Be conversational and encouraging, but keep it concise (2-4 sentences max).

CURRENT STATE:
Consumed today: ${currentMacros.calories} cal, ${currentMacros.protein}g protein, ${currentMacros.carbs}g carbs, ${currentMacros.fat}g fat.
Goals: ${macroGoals.calories} cal, ${macroGoals.protein}g protein, ${macroGoals.carbs}g carbs, ${macroGoals.fat}g fat.
${prefs}

${stravaContext}

Generate a short, encouraging brief in plain text only. Do not use markdown blocks, JSON, or tool calls.`
  };
}

export function getChatTools() {
  return [
    {
      type: "function",
      function: {
        name: "log_meal",
        description: "Log one or more food items the user ate.",
        parameters: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  calories: { type: "integer" },
                  protein: { type: "integer" },
                  carbs: { type: "integer" },
                  fat: { type: "integer" }
                },
                required: ["name", "calories", "protein", "carbs", "fat"]
              }
            }
          },
          required: ["items"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "delete_meal",
        description: "Delete a previously logged meal.",
        parameters: {
          type: "object",
          properties: {
            description: { type: "string" }
          },
          required: ["description"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "answer_question",
        description: "Answer a user question without modifying logs.",
        parameters: {
          type: "object",
          properties: {
            response: { type: "string", description: "Your conversational answer" }
          },
          required: ["response"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "suggest_meal",
        description: "Suggest a meal when the user asks what to eat next.",
        parameters: {
          type: "object",
          properties: {
            mealName: { type: "string", description: "Name of the suggested meal" },
            reasoning: { type: "string", description: "Why this meal fits their current macros and training" },
            estimatedCalories: { type: "integer" },
            estimatedProtein: { type: "integer" }
          },
          required: ["mealName", "reasoning", "estimatedCalories", "estimatedProtein"]
        }
      }
    }
  ];
}

export async function processToolCalls(toolCalls, currentMacros, dailyTotalsMap, mealHistoryList) {
  let finalReply = "";
  let newlyLoggedMeals = [];
  const todayStr = getLocalDateString();
  
  if (currentMacros.date !== todayStr) {
    currentMacros.calories = 0;
    currentMacros.protein = 0;
    currentMacros.carbs = 0;
    currentMacros.fat = 0;
    currentMacros.date = todayStr;
  }
  
  for (const toolCall of toolCalls) {
    let args;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch(e) {
      continue;
    }
    
    if (toolCall.function.name === "log_meal") {
      for (const item of args.items) {
        currentMacros.calories += item.calories;
        currentMacros.protein += item.protein;
        currentMacros.carbs += item.carbs;
        currentMacros.fat += item.fat;
        
        if (!dailyTotalsMap[todayStr]) {
          dailyTotalsMap[todayStr] = { calories: 0, meals: [] };
        }
        const mealEntry = { ...item, timestamp: new Date().toISOString() };
        dailyTotalsMap[todayStr].calories += item.calories;
        dailyTotalsMap[todayStr].meals.push(mealEntry);
        
        mealHistoryList.unshift(mealEntry);
        if (mealHistoryList.length > 50) mealHistoryList.length = 50;
        
        newlyLoggedMeals.push(item);
      }
      if (!finalReply) {
         const descriptions = args.items.map(i => `${i.name} (${i.calories} cal, ${i.protein}g protein, ${i.carbs}g carbs, ${i.fat}g fat)`).join(', ');
         finalReply = `Got it! Logged: ${descriptions}.`;
      }
    } 
    else if (toolCall.function.name === "delete_meal") {
      let deletedMeal = null;
      if (dailyTotalsMap[todayStr] && dailyTotalsMap[todayStr].meals) {
         const meals = dailyTotalsMap[todayStr].meals;
         const descLower = args.description.toLowerCase();
         for (let i = meals.length - 1; i >= 0; i--) {
            if (meals[i].name.toLowerCase().includes(descLower)) {
               deletedMeal = meals.splice(i, 1)[0];
               break;
            }
         }
      }
      
      if (deletedMeal) {
         currentMacros.calories = Math.max(0, currentMacros.calories - deletedMeal.calories);
         currentMacros.protein = Math.max(0, currentMacros.protein - deletedMeal.protein);
         currentMacros.carbs = Math.max(0, currentMacros.carbs - deletedMeal.carbs);
         currentMacros.fat = Math.max(0, currentMacros.fat - deletedMeal.fat);
         dailyTotalsMap[todayStr].calories = Math.max(0, dailyTotalsMap[todayStr].calories - deletedMeal.calories);
         
         if (!finalReply) {
           finalReply = `I've removed ${deletedMeal.name} from today's log.`;
         }
      } else {
         if (!finalReply) {
           finalReply = `I couldn't find a meal matching "${args.description}" today.`;
         }
      }
    }
    else if (toolCall.function.name === "answer_question") {
      finalReply = args.response || finalReply;
    }
    else if (toolCall.function.name === "suggest_meal") {
      finalReply = `### Suggestion: **${args.mealName}**\n\n${args.reasoning}\n\n*Estimated: ${args.estimatedCalories} cal, ${args.estimatedProtein}g protein*`;
      // Return structured data for the UI
      return { finalReply, newlyLoggedMeals, updatedTotals: currentMacros, suggestedMeal: args };
    }
  }
  
  return { finalReply, newlyLoggedMeals, updatedTotals: currentMacros };
}
