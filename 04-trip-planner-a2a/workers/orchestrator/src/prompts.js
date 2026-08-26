export const buildSearchPrompt = ({ destination }) =>
  `Find top tourist attractions, recommended hotels, and flight options for ${destination}. Include estimated prices.`;

export const buildBudgetPrompt = ({ destination, days, budget, people }) =>
  `You are a travel budget planning expert. Create a detailed budget breakdown for the following trip:

Destination: ${destination}
Duration: ${days} days
Total Budget: $${budget}
Number of travelers: ${people}

Provide a clear breakdown of estimated costs per person per day for:
- Accommodation
- Food & dining
- Local transportation
- Activities & entrance fees
- Miscellaneous expenses

Then summarize the total estimated cost vs the budget, and note if the budget is sufficient or not.
Be specific with dollar amounts.`;

export const buildItineraryPrompt = ({
  destination,
  days,
  budget,
  people,
  searchResults,
  budgetBreakdown,
}) =>
  `You are an expert travel itinerary planner. Create a detailed day-by-day itinerary based on the following information:

**Trip Details:**
- Destination: ${destination}
- Duration: ${days} days
- Total Budget: $${budget}
- Number of travelers: ${people}

**Research Findings:**
${searchResults}

**Budget Breakdown:**
${budgetBreakdown}

Return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "title": "Trip to [Destination]",
  "overview": "1-2 sentence trip summary",
  "accommodation": {
    "name": "Recommended hotel/hostel name",
    "pricePerNight": "$XX",
    "notes": "Why this is recommended"
  },
  "days": [
    {
      "day": 1,
      "title": "Short theme for the day",
      "morning": { "activity": "What to do", "location": "Where", "cost": "$XX" },
      "afternoon": { "activity": "What to do", "location": "Where", "cost": "$XX" },
      "evening": { "activity": "What to do", "location": "Where", "cost": "$XX" }
    }
  ],
  "budget": {
    "accommodation": 0,
    "food": 0,
    "transport": 0,
    "activities": 0,
    "misc": 0,
    "total": 0,
    "perPerson": 0,
    "verdict": "Under budget / Over budget by $XX"
  },
  "transportTips": ["tip1", "tip2", "tip3"],
  "diningTips": ["tip1", "tip2", "tip3"],
  "travelTips": ["tip1", "tip2", "tip3"]
}

Budget values must be numbers (no $ sign). Include exactly ${days} days. Be specific with real place names and realistic costs.`;
