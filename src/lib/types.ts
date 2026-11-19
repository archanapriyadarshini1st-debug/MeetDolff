/**
 * MeetDolff core domain types.
 * Single source of truth for meeting memory schema.
 * Versioned — bump MEMORY_FORMAT_VERSION when schema changes.
 */

export const MEMORY_FORMAT_VERSION = 1;

export type MeetingId = string;

export interface TranscriptSegment {
  /** Stable segment id */
  id: string;
  /** Start time in seconds from recording start */
  start: number;
  /** End time in seconds */
  end: number;
  /** Speaker label if diarization is available, otherwise null */
  speaker: string | null;
  /** Transcribed text */
  text: string;
  /** Confidence 0..1 if provider supplies it */
  confidence?: number;
  /** True when a user corrected this segment after transcription */
  edited?: boolean;
  /** Original provider text, kept the first time a segment is edited */
  originalText?: string;
}

export interface ActionItem {
  text: string;
  owner: string | null;
  deadline: string | null;
  /** Evidence: transcript segment ids */
  evidence: string[];
}

export interface Decision {
  text: string;
  evidence: string[];
}

export interface Meeting {
  id: MeetingId;
  title: string;
  /** ISO 8601 start time */
  startedAt: string;
  /** ISO 8601 end time */
  endedAt: string;
  durationSec: number;
  participants: string[];
  /** Full transcript segments in order */
  transcript: TranscriptSegment[];
  /** Plain-text transcript joined for search */
  transcriptText: string;
  summary: string | null;
  /** True when the transcript was edited after the summary/decisions were generated */
  summaryStale?: boolean;
  topics: string[];
  decisions: Decision[];
  actionItems: ActionItem[];
  openQuestions: string[];
  commitments: string[];
  project: string | null;
  /** Audio source used: 'tab' | 'mic' | 'tab+mic' */
  audioSource: 'tab' | 'mic' | 'tab+mic';
  /** MIME type of saved audio if any */
  audioMime: string | null;
  /** Whether audio blob was persisted (IndexedDB) */
  hasAudio: boolean;
  /** Schema version for this record */
  memoryVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO 8601 start */
  startsAt: string;
  /** ISO 8601 end */
  endsAt: string;
  /** Color key: 'ink' | 'paper' | 'accent' | 'muted' — restrained palette */
  color: 'ink' | 'paper' | 'accent' | 'muted';
  notes: string;
  meetingId: MeetingId | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPlan {
  id: string;
  meetingId: MeetingId;
  title: string;
  objectives: string[];
  tasks: { text: string; owner: string | null; deadline: string | null }[];
  milestones: { text: string; date: string | null }[];
  dependencies: string[];
  risks: string[];
  approved: boolean;
  createdAt: string;
}

export interface ProviderSettings {
  /** Chat provider adapter */
  aiProvider: 'openai' | 'anthropic' | 'gemini';
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  /** Model id for chat/summarization */
  chatModel: string;
  /** Model id for transcription (if cloud) */
  transcriptionModel: string;
  /** API key — stored ONLY in chrome.storage.local (never sync, never logs) */
  apiKey: string;
  /** Anthropic / Gemini base overrides (optional) */
  anthropicBaseUrl?: string;
  geminiBaseUrl?: string;
  /** Web search provider: 'none' | 'tavily' | 'brave' */
  searchProvider: 'none' | 'tavily' | 'brave';
  searchApiKey: string;
  /** Preferred transcription: 'web-speech' | 'cloud' */
  transcriptionProvider: 'web-speech' | 'cloud';
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  aiProvider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  chatModel: 'gpt-4o-mini',
  transcriptionModel: 'whisper-1',
  apiKey: '',
  searchProvider: 'none',
  searchApiKey: '',
  transcriptionProvider: 'web-speech',
};

export type RecordingState = 'idle' | 'recording' | 'paused' | 'stopping' | 'error';

export interface RecordingSession {
  id: string;
  state: RecordingState;
  tabId: number | null;
  audioSource: 'tab' | 'mic' | 'tab+mic';
  startedAt: number | null;
  elapsedSec: number;
  error: string | null;
  /** Chunks persisted so far (for recovery) */
  chunkCount: number;
}

export interface SearchResult {
  meeting: Meeting;
  /** Snippet with matched terms highlighted via <mark> */
  snippet: string;
  score: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Source references for grounding */
  sources?: { meetingId: MeetingId; title: string; timestampSec: number | null }[];
}
