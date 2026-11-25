import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { z } from 'zod';
import {
  VOICE_EXTRACTION_PROMPT,
  executeVoiceExtractionWithSingleRetry,
} from './src/lib/voiceExtraction';
import {
  PHOTO_EXTRACTION_PROMPT,
  executePhotoExtractionWithSingleRetry,
} from './src/lib/photoExtraction';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/aac',
  'audio/x-m4a',
] as const;

type AllowedAudioMime = (typeof ALLOWED_AUDIO_MIME_TYPES)[number];

const VoiceExtractBodySchema = z.object({
  audioBase64: z.string().min(16).max(5_500_000),
  mimeType: z.string().min(5).max(80),
  language: z.enum(['hi', 'en']).default('hi'),
});

const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const PhotoExtractBodySchema = z.object({
  imageBase64: z.string().min(32).max(5_500_000),
  mimeType: z.enum(ALLOWED_IMAGE_MIME_TYPES),
  language: z.enum(['hi', 'en']).default('hi'),
});

const PHOTO_GEMINI_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    rows: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: {
            type: Type.STRING,
            nullable: true,
            description: 'Transaction date (YYYY-MM-DD) or null if illegible/missing',
          },
          customerName: {
            type: Type.STRING,
            nullable: true,
            description: 'Customer, supplier, or account name, or null if illegible',
          },
          item: {
            type: Type.STRING,
            nullable: true,
            description: 'Items or description, or null if illegible',
          },
          amount: {
            type: Type.NUMBER,
            nullable: true,
            description: 'Positive amount in INR rupees, or null if illegible/missing',
          },
          type: {
            type: Type.STRING,
            nullable: true,
            enum: ['sale', 'expense', 'udhaar_given', 'udhaar_received'],
            description: 'Ledger transaction type or null if unclear',
          },
          confidence: {
            type: Type.NUMBER,
            description: 'Confidence score between 0.0 and 1.0',
          },
          uncertainFields: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
              enum: ['date', 'customerName', 'item', 'amount', 'type'],
            },
            description: 'List of uncertain or null field names in this row',
          },
        },
        required: [
          'date',
          'customerName',
          'item',
          'amount',
          'type',
          'confidence',
          'uncertainFields',
        ],
      },
    },
    imageQuality: {
      type: Type.STRING,
      enum: ['good', 'fair', 'blurry', 'unreadable'],
      description: 'Overall sharpness and readability of the photo',
    },
  },
  required: ['rows', 'imageQuality'],
};

const VOICE_GEMINI_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    customerName: {
      type: Type.STRING,
      nullable: true,
      description: 'Customer, supplier, or expense payee name, or null if not mentioned',
    },
    amount: {
      type: Type.NUMBER,
      nullable: true,
      description: 'Amount in INR rupees (positive number), or null if not spoken',
    },
    type: {
      type: Type.STRING,
      enum: ['sale', 'expense', 'udhaar_given', 'udhaar_received'],
      description: 'Transaction category',
    },
    note: {
      type: Type.STRING,
      description: 'Short item/reason summary up to 140 chars',
    },
    confidence: {
      type: Type.NUMBER,
      description: 'Confidence score between 0.0 and 1.0',
    },
    transcript: {
      type: Type.STRING,
      description: 'Cleaned verbatim Hindi/Hinglish transcript',
    },
  },
  required: ['customerName', 'amount', 'type', 'note', 'confidence', 'transcript'],
};

function normalizeAudioMimeType(rawMime: string): AllowedAudioMime | null {
  const base = rawMime.split(';')[0]?.trim().toLowerCase() ?? '';
  if ((ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(base)) {
    return base as AllowedAudioMime;
  }
  return null;
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/voice/extract', async (req, res) => {
    const parsedBody = VoiceExtractBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_REQUEST',
        fallbackToManual: true,
        error: 'Invalid audio payload.',
      });
      return;
    }

    const normalizedMime = normalizeAudioMimeType(parsedBody.data.mimeType);
    if (!normalizedMime) {
      res.status(400).json({
        ok: false,
        code: 'UNSUPPORTED_AUDIO_FORMAT',
        fallbackToManual: true,
        error: 'Unsupported audio MIME type.',
      });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        ok: false,
        code: 'GEMINI_NOT_CONFIGURED',
        fallbackToManual: true,
        error: 'Voice AI service is not configured on the server.',
      });
      return;
    }

    let capturedTranscript = '';

    try {
      // Stage 1: Hindi/Hinglish Audio Transcription with gemini-3.5-transcribe
      const transcriptionResponse = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: normalizedMime,
                data: parsedBody.data.audioBase64,
              },
            },
            {
              text:
                parsedBody.data.language === 'hi'
                  ? 'Transcribe this Indian Kirana shopkeeper voice recording verbatim in Hindi or Hinglish. Preserve all spoken number words (like paanch sau, dhai hazaar, dedh sau, sawa sau) and customer names accurately. Return only the spoken transcript text.'
                  : 'Transcribe this Indian Kirana shopkeeper voice recording verbatim in English or Hinglish. Preserve all spoken number words and customer names accurately. Return only the spoken transcript text.',
            },
          ],
        },
      });

      capturedTranscript = (transcriptionResponse.text ?? '').trim();
      if (!capturedTranscript) {
        res.status(422).json({
          ok: false,
          code: 'EMPTY_TRANSCRIPT',
          fallbackToManual: true,
          transcript: '',
          error: 'No speech detected in the recording.',
        });
        return;
      }

      // Stage 2: Strict JSON Extraction with Zod Validation + Single Retry on Invalid JSON
      const extractionOutcome = await executeVoiceExtractionWithSingleRetry(
        async (attempt, previousError) => {
          const repairSection =
            attempt === 2 && previousError
              ? `\n\nPREVIOUS OUTPUT WAS INVALID (${previousError}). Fix it and return strictly valid JSON matching the schema.`
              : '';

          const extractionResponse = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: `${VOICE_EXTRACTION_PROMPT}${repairSection}\n\nShopkeeper transcript:\n"""${capturedTranscript}"""`,
            config: {
              responseMimeType: 'application/json',
              responseSchema: VOICE_GEMINI_RESPONSE_SCHEMA,
              thinkingConfig: {
                thinkingLevel: ThinkingLevel.LOW,
              },
            },
          });

          return extractionResponse.text ?? '';
        }
      );

      if (!extractionOutcome.ok) {
        res.status(422).json({
          ok: false,
          code: 'INVALID_EXTRACTION',
          fallbackToManual: true,
          attempts: extractionOutcome.attempts,
          transcript: capturedTranscript,
          error: 'Could not extract a valid structured entry after retrying.',
        });
        return;
      }

      res.json({
        ok: true,
        extraction: {
          ...extractionOutcome.data,
          transcript: extractionOutcome.data.transcript || capturedTranscript,
        },
        uncertainFields: extractionOutcome.uncertainFields,
        attempts: extractionOutcome.attempts,
      });
    } catch (err) {
      console.error(
        '[voice/extract] Gemini request failed:',
        err instanceof Error ? err.message : 'Unknown error'
      );
      res.status(502).json({
        ok: false,
        code: 'UPSTREAM_ERROR',
        fallbackToManual: true,
        transcript: capturedTranscript,
        error: 'Voice extraction service temporarily unavailable.',
      });
    }
  });

  app.post('/api/photo/extract', async (req, res) => {
    const parsedBody = PhotoExtractBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_REQUEST',
        error: 'Invalid photo payload or unsupported image format.',
      });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        ok: false,
        code: 'GEMINI_NOT_CONFIGURED',
        error: 'Vision AI service is not configured on the server.',
      });
      return;
    }

    try {
      const imagePart = {
        inlineData: {
          mimeType: parsedBody.data.mimeType,
          data: parsedBody.data.imageBase64,
        },
      };

      const extractionOutcome = await executePhotoExtractionWithSingleRetry(
        async (attempt, previousError) => {
          const repairSection =
            attempt === 2 && previousError
              ? `\n\nPREVIOUS OUTPUT WAS INVALID (${previousError}). Return strictly valid JSON matching the schema and never guess illegible fields.`
              : '';

          const response = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: {
              parts: [
                imagePart,
                {
                  text: `${PHOTO_EXTRACTION_PROMPT}${repairSection}`,
                },
              ],
            },
            config: {
              responseMimeType: 'application/json',
              responseSchema: PHOTO_GEMINI_RESPONSE_SCHEMA,
              thinkingConfig: {
                thinkingLevel: ThinkingLevel.LOW,
              },
            },
          });

          return response.text ?? '';
        }
      );

      if (!extractionOutcome.ok) {
        res.status(422).json({
          ok: false,
          code: 'INVALID_EXTRACTION',
          attempts: extractionOutcome.attempts,
          error: 'Could not extract structured ledger rows from this photo.',
        });
        return;
      }

      res.json({
        ok: true,
        extraction: extractionOutcome.data,
        retakeRequired: extractionOutcome.retakeRequired,
        attempts: extractionOutcome.attempts,
      });
    } catch (err) {
      console.error(
        '[photo/extract] Gemini Vision request failed:',
        err instanceof Error ? err.message : 'Unknown error'
      );
      res.status(502).json({
        ok: false,
        code: 'UPSTREAM_ERROR',
        error: 'Photo extraction service temporarily unavailable.',
      });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`VyaparMitra server listening on http://0.0.0.0:${port}`);
  });
}

void createApp();
