import type { ConstraintEvidence, RecoveryCandidate, StagedTransaction, ToolAuditEvent } from '@relayroom/contracts';
import type { DiscoveredTool } from '@relayroom/ui';
import type { RuntimeMode } from './orchestration';

export type RoomStage = 'ready' | 'querying' | 'simulating' | 'preview' | 'staging' | 'staged' | 'executing' | 'success' | 'rollback';

export type RoomState = {
  stage: RoomStage;
  mode: RuntimeMode;
  tools: DiscoveredTool[];
  evidence: ConstraintEvidence[];
  candidates: RecoveryCandidate[];
  selected?: RecoveryCandidate;
  transaction?: StagedTransaction;
  audit: ToolAuditEvent[];
  error?: string;
  partnerPulse?: 'buyer' | 'supplier' | 'carrier';
  failureRehearsal: boolean;
  planner?: {
    source: 'openai' | 'gemini' | 'deterministic';
    model?: string;
    narrative: string;
    fallbackReason?: string;
  };
};

export const initialRoomState: RoomState = {
  stage: 'ready', mode: 'bridge', tools: [], evidence: [], candidates: [], audit: [], failureRehearsal: false,
};

export type RoomAction =
  | { type: 'reset' }
  | { type: 'stage'; stage: RoomStage }
  | { type: 'tools'; tools: DiscoveredTool[]; mode: RuntimeMode }
  | { type: 'evidence'; evidence: ConstraintEvidence }
  | { type: 'candidates'; candidates: RecoveryCandidate[] }
  | { type: 'select'; candidate: RecoveryCandidate; transaction: StagedTransaction }
  | { type: 'transaction'; transaction: StagedTransaction }
  | { type: 'audit'; event: ToolAuditEvent }
  | { type: 'pulse'; partner?: 'buyer' | 'supplier' | 'carrier' }
  | { type: 'error'; message?: string }
  | { type: 'failure'; enabled: boolean }
  | { type: 'planner'; planner: NonNullable<RoomState['planner']> };

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case 'reset': return initialRoomState;
    case 'stage': return { ...state, stage: action.stage };
    case 'tools': return { ...state, tools: action.tools, mode: action.mode };
    case 'evidence': return { ...state, evidence: [...state.evidence.filter((item) => item.origin !== action.evidence.origin), action.evidence] };
    case 'candidates': return { ...state, candidates: action.candidates };
    case 'select': return { ...state, selected: action.candidate, transaction: action.transaction, stage: 'preview' };
    case 'transaction': return { ...state, transaction: action.transaction };
    case 'audit': return { ...state, audit: [action.event, ...state.audit] };
    case 'pulse': return { ...state, partnerPulse: action.partner };
    case 'error': return { ...state, error: action.message };
    case 'failure': return { ...state, failureRehearsal: action.enabled };
    case 'planner': return { ...state, planner: action.planner };
    default: return state;
  }
}
