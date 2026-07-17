# EatTailor - AI Nutrition Tracking App

A full-stack nutrition tracking application that uses AI to solve the data accuracy problems in existing market solutions.

## The Problem

Existing nutrition apps (MyFitnessPal, Lose It, etc.) struggle with real-world food logging. Users either get inaccurate macro estimates or spend excessive time manually searching databases.

## The Solution

EatTailor uses a 4-layer AI prompt logic system to improve macro estimation accuracy:

1. **Food Parsing** - Natural language processing to identify ingredients from casual food descriptions
2. **Portion Normalization** - Converts vague portions ("a handful," "medium bowl") into standardized measurements  
3. **Macro Calculation** - Generates macronutrient estimates with confidence scoring
4. **Cross-Validation** - Checks calculations against nutritional baselines to catch outliers

## Tech Stack

- **Frontend:** HTML, CSS, JavaScript (PWA-enabled)
- **Backend:** Node.js
- **AI:** OpenAI API
- **Auth/Database:** Firebase (Google Sign-In, Firestore)
- **Integrations:** Strava API

## Why I Built This

I wanted to demonstrate hands-on AI development beyond using ChatGPT as a writing tool. This project showcases prompt engineering, API integration, and product thinking applied to a real user problem.
