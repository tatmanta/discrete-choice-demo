# Discrete Choice Survey App

A full-stack survey application built with a static frontend, serverless backend, and live aggregate results visualization.

![App screenshot](./assets/discrete%20choice%20results%20page%20screengrab.png)

## Stack
- Frontend: Vanilla HTML/CSS/JS
- Hosting: Netlify
- Backend: Netlify Functions (Node.js)
- Edge: Netlify Edge Functions
- Data: Google Sheets API v4 via service account auth

## Features
- Discrete choice survey engine with block randomization
- Serverless write pipeline with retry logic
- Server-side geo enrichment via Netlify Edge
- Live aggregate results chart with respondent-level deduplication
- Share tracking across native, LinkedIn, X, email, and clipboard
- Science modal with methodology explainer

## Architecture
User completes survey → Edge function enriches with geo → /submit appends to Google Sheet → /distribution reads and deduplicates by user → Results page renders live persona distribution chart

## Environment Variables
- GOOGLE_SERVICE_ACCOUNT_JSON
- GOOGLE_SHEET_ID
