import { z } from 'zod';

const analysisSchema = z.object({
  waste_type: z.enum([
    'Plastic',
    'Paper/Cardboard',
    'Glass',
    'Metal',
    'Organic',
    'Electronic',
    'Construction',
    'Mixed Waste',
    'Other',
  ]),
  severity: z.enum(['Low', 'Medium', 'High', 'Critical']),
  priority: z.enum(['Normal', 'High', 'Urgent']),
  estimated_scale: z.enum(['Small', 'Medium', 'Large']),
  description: z.string().min(3).max(600),
  recommended_action: z.string().min(3).max(600),
});

const categoryMap = [
  ['electronic', 'Electronic'],
  ['e-waste', 'Electronic'],
  ['battery', 'Electronic'],
  ['cardboard', 'Paper/Cardboard'],
  ['paper', 'Paper/Cardboard'],
  ['glass', 'Glass'],
  ['metal', 'Metal'],
  ['scrap', 'Metal'],
  ['organic', 'Organic'],
  ['food', 'Organic'],
  ['construction', 'Construction'],
  ['rubble', 'Construction'],
  ['brick', 'Construction'],
  ['plastic', 'Plastic'],
];

function fallbackAnalysis({ description, userCategory }) {
  const text = `${userCategory || ''} ${description || ''}`.toLowerCase();
  const wasteType = userCategory || categoryMap.find(([needle]) => text.includes(needle))?.[1] || 'Mixed Waste';
  const critical = /(school|hospital|drain|water|mosquito|dengue|fire|chemical|hazard)/.test(text);
  const high = /(large|pile|road|park|public|dangerous|smell)/.test(text);

  return {
    waste_type: wasteType,
    severity: critical ? 'Critical' : high ? 'High' : 'Medium',
    priority: critical ? 'Urgent' : high ? 'High' : 'Normal',
    estimated_scale: /(large|truck|many|pile|bulk)/.test(text) ? 'Large' : /(several|multiple|bags)/.test(text) ? 'Medium' : 'Small',
    description: `Estimated ${wasteType.toLowerCase()} issue based on the report details. A cleanup team should review the original photo before acting.`,
    recommended_action: critical
      ? 'Inspect promptly, remove water-holding items where safe, and secure the area for a cleanup team.'
      : 'Review the photo, sort recoverable materials where safe, and arrange an appropriate cleanup visit.',
  };
}

function parseJsonResponse(content) {
  if (!content || typeof content !== 'string') throw new Error('AI response was empty.');
  const normalized = content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');
  const firstBrace = normalized.indexOf('{');
  const lastBrace = normalized.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) throw new Error('AI response did not contain JSON.');
  return JSON.parse(normalized.slice(firstBrace, lastBrace + 1));
}

export async function analyzeWaste({ description, userCategory, location, imageUrl }) {
  const fallback = fallbackAnalysis({ description, userCategory });
  const apiKey = process.env.HACKCLUB_API_KEY;
  if (!apiKey) return { analysis: fallback, source: 'fallback', note: 'AI key is not configured.' };

  const baseUrl = (process.env.HACKCLUB_AI_BASE_URL || 'https://ai.hackclub.com/proxy/v1').replace(/\/$/, '');
  const model = process.env.HACKCLUB_AI_MODEL || 'openai/gpt-4';
  const prompt = `You classify municipal waste reports for cleanup teams. Return only a JSON object with exactly these fields: waste_type, severity, priority, estimated_scale, description, recommended_action. Valid waste_type values: Plastic, Paper/Cardboard, Glass, Metal, Organic, Electronic, Construction, Mixed Waste, Other. Valid severity values: Low, Medium, High, Critical. Valid priority values: Normal, High, Urgent. Valid estimated_scale values: Small, Medium, Large. The assessment is an estimate, not a safety certification.\n\nDescription: ${description}\nUser category: ${userCategory || 'Not provided'}\nLocation context: ${location || 'Not provided'}\nImage uploaded: ${imageUrl ? 'Yes. Review is based on text unless this model supports images.' : 'No'}`;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a careful environmental triage assistant. Never claim certainty. Return valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) throw new Error(`AI request failed with status ${response.status}.`);
    const body = await response.json();
    const raw = body?.choices?.[0]?.message?.content;
    const analysis = analysisSchema.parse(parseJsonResponse(raw));
    return { analysis, source: 'hackclub-gpt-4', note: null, rawResponse: raw };
  } catch (error) {
    return {
      analysis: fallback,
      source: 'fallback',
      note: 'The AI service was unavailable, so CleanSpot used a transparent rules-based estimate.',
      rawResponse: error instanceof Error ? error.message : 'Unknown AI error',
    };
  }
}
