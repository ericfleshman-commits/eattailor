import { test } from 'node:test';
import assert from 'node:assert';
import { processToolCalls, findMealIndex, getLocalDateString } from '../chat-core.js';

let dbState = {
  currentMacros: { calories: 0, protein: 0, carbs: 0, fat: 0, date: '2026-07-18' },
  dailyTotalsMap: {},
  mealHistoryList: []
};

// 10 Canned Conversations
test('Single meal logging', async () => {
  dbState = { currentMacros: { calories: 0, protein: 0, carbs: 0, fat: 0, date: '2026-07-18' }, dailyTotalsMap: {}, mealHistoryList: [] };
  const mockCalls = [
    {
      function: {
        name: 'log_meal',
        arguments: JSON.stringify({ items: [{ name: 'Oatmeal', calories: 150, protein: 5, carbs: 27, fat: 3 }] })
      }
    }
  ];
  const res = await processToolCalls(mockCalls, dbState.currentMacros, dbState.dailyTotalsMap, dbState.mealHistoryList);
  assert.strictEqual(res.newlyLoggedMeals.length, 1);
  assert.strictEqual(dbState.currentMacros.calories, 150);
  assert.strictEqual(dbState.dailyTotalsMap[dbState.currentMacros.date].meals.length, 1);
});

test('Multi meal logging', async () => {
  const mockCalls = [
    {
      function: {
        name: 'log_meal',
        arguments: JSON.stringify({ items: [
          { name: 'Apple', calories: 95, protein: 0, carbs: 25, fat: 0 },
          { name: 'Banana', calories: 105, protein: 1, carbs: 27, fat: 0 }
        ] })
      }
    }
  ];
  await processToolCalls(mockCalls, dbState.currentMacros, dbState.dailyTotalsMap, dbState.mealHistoryList);
  assert.strictEqual(dbState.currentMacros.calories, 150 + 95 + 105); // 350
  assert.strictEqual(dbState.dailyTotalsMap[dbState.currentMacros.date].meals.length, 3);
});

test('Question answering', async () => {
  const mockCalls = [
    {
      function: {
        name: 'answer_question',
        arguments: JSON.stringify({ response: "An egg has about 6g of protein." })
      }
    }
  ];
  const res = await processToolCalls(mockCalls, dbState.currentMacros, dbState.dailyTotalsMap, dbState.mealHistoryList);
  assert.strictEqual(res.finalReply, "An egg has about 6g of protein.");
  // Macros unchanged
  assert.strictEqual(dbState.currentMacros.calories, 350); 
});

test('Meal deletion', async () => {
  const mockCalls = [
    {
      function: {
        name: 'delete_meal',
        arguments: JSON.stringify({ description: "Apple" })
      }
    }
  ];
  await processToolCalls(mockCalls, dbState.currentMacros, dbState.dailyTotalsMap, dbState.mealHistoryList);
  assert.strictEqual(dbState.currentMacros.calories, 350 - 95); // 255
  assert.strictEqual(dbState.dailyTotalsMap[dbState.currentMacros.date].meals.length, 2);
});

test('Typo correction implicitly handled by LLM before calling tool', async () => {
  const mockCalls = [
    {
      function: {
        name: 'log_meal',
        arguments: JSON.stringify({ items: [{ name: 'Chicken (auto-corrected from chiken)', calories: 200, protein: 40, carbs: 0, fat: 4 }] })
      }
    }
  ];
  await processToolCalls(mockCalls, dbState.currentMacros, dbState.dailyTotalsMap, dbState.mealHistoryList);
  assert.strictEqual(dbState.currentMacros.calories, 255 + 200); 
  assert.strictEqual(dbState.dailyTotalsMap[dbState.currentMacros.date].meals.length, 3);
});

test('Delete non-existent meal', async () => {
  const mockCalls = [{ function: { name: 'delete_meal', arguments: JSON.stringify({ description: "Pizza" }) } }];
  const res = await processToolCalls(mockCalls, dbState.currentMacros, dbState.dailyTotalsMap, dbState.mealHistoryList);
  assert.match(res.finalReply, /couldn't find|nothing is logged/i);
});

test('Log meal with no carbs', async () => {
  const mockCalls = [{ function: { name: 'log_meal', arguments: JSON.stringify({ items: [{ name: 'Steak', calories: 400, protein: 50, carbs: 0, fat: 20 }] }) } }];
  await processToolCalls(mockCalls, dbState.currentMacros, dbState.dailyTotalsMap, dbState.mealHistoryList);
  assert.strictEqual(dbState.currentMacros.protein, 5 + 1 + 40 + 50); // 96
});

test('Answer another question', async () => {
  const mockCalls = [{ function: { name: 'answer_question', arguments: JSON.stringify({ response: "You have 54g protein left." }) } }];
  const res = await processToolCalls(mockCalls, dbState.currentMacros, dbState.dailyTotalsMap, dbState.mealHistoryList);
  assert.strictEqual(res.finalReply, "You have 54g protein left.");
});

test('Delete latest meal', async () => {
  const mockCalls = [{ function: { name: 'delete_meal', arguments: JSON.stringify({ description: "Steak" }) } }];
  await processToolCalls(mockCalls, dbState.currentMacros, dbState.dailyTotalsMap, dbState.mealHistoryList);
  assert.strictEqual(dbState.currentMacros.protein, 46);
});

test('Log giant meal', async () => {
  const mockCalls = [{ function: { name: 'log_meal', arguments: JSON.stringify({ items: [{ name: 'Feast', calories: 2000, protein: 100, carbs: 200, fat: 100 }] }) } }];
  await processToolCalls(mockCalls, dbState.currentMacros, dbState.dailyTotalsMap, dbState.mealHistoryList);
  assert.strictEqual(dbState.currentMacros.calories, 2455);
});

test('Suggest meal', async () => {
  const mockCalls = [{ function: { name: 'suggest_meal', arguments: JSON.stringify({ mealName: 'Chicken and Rice', reasoning: 'Good for recovery.', estimatedCalories: 450, estimatedProtein: 40 }) } }];
  const res = await processToolCalls(mockCalls, dbState.currentMacros, dbState.dailyTotalsMap, dbState.mealHistoryList);
  assert.strictEqual(res.suggestedMeal.mealName, 'Chicken and Rice');
  assert.match(res.finalReply, /Suggestion: \*\*Chicken and Rice\*\*/);
});

// Deletion matching: the model passes verbose descriptions while stored names are short.
test('Delete matches a verbose model description', () => {
  const meals = [
    { name: 'Oatmeal', calories: 150 },
    { name: 'Apple (medium)', calories: 95 }
  ];
  assert.strictEqual(findMealIndex(meals, 'Apple (medium) (95 cal, 0g protein, 25g carbs, 0g fat)'), 1);
});

test('Delete matches a short partial name', () => {
  const meals = [{ name: 'Grilled Chicken Breast', calories: 280 }];
  assert.strictEqual(findMealIndex(meals, 'the chicken'), 0);
});

test('Delete falls back to the most recent meal', () => {
  const meals = [{ name: 'Oatmeal', calories: 150 }, { name: 'Banana', calories: 105 }];
  assert.strictEqual(findMealIndex(meals, 'the last thing I logged'), 1);
});

test('Delete returns no match for an unrelated food', () => {
  const meals = [{ name: 'Oatmeal', calories: 150 }];
  assert.strictEqual(findMealIndex(meals, 'pepperoni pizza'), -1);
});

test('Delete removes the right meal end to end', async () => {
  const today = getLocalDateString();
  const state = {
    currentMacros: { calories: 245, protein: 5, carbs: 52, fat: 3, date: today },
    dailyTotalsMap: {
      [today]: {
        calories: 245,
        meals: [
          { name: 'Oatmeal', calories: 150, protein: 5, carbs: 27, fat: 3 },
          { name: 'Apple (medium)', calories: 95, protein: 0, carbs: 25, fat: 0 }
        ]
      }
    },
    mealHistoryList: []
  };
  const calls = [{ function: { name: 'delete_meal', arguments: JSON.stringify({ description: 'Apple (medium) (95 cal, 0g protein, 25g carbs, 0g fat)' }) } }];
  const res = await processToolCalls(calls, state.currentMacros, state.dailyTotalsMap, state.mealHistoryList);
  assert.strictEqual(state.currentMacros.calories, 150);
  assert.strictEqual(state.dailyTotalsMap[today].meals.length, 1);
  assert.match(res.finalReply, /removed Apple/i);
});
